import { error } from '@sveltejs/kit';
import {
	addMessage,
	applySectionPlan,
	chapterRequirements,
	deleteRequirement,
	distributeSectionContent,
	documentRevision,
	DocumentConflict,
	getChapter,
	getProject,
	getRequirement,
	projectChapters,
	projectDecisions,
	recentMessages,
	saveDecision,
	saveRequirement,
	setChapterApplicable,
	updateChapterState,
	withDocumentRevision
} from '$lib/server/db';
import { describeFailure } from '$lib/server/llm/failures';
import { effectiveStatus, toDecisionDraft, unconfirmed } from '$lib/server/llm/decisions';
import { toRequirementDraft } from '$lib/server/llm/requirements';
import { parseSectionPlan } from '$lib/server/llm/subchapters';
import { gateway } from '$lib/server/llm/gateway';
import {
	ChapterStreamParser,
	assessChapter,
	buildSystemPrompt,
	normalizeChapterMarkdown,
	toChatMessages
} from '$lib/server/llm/agent';
import { parseOptions, reconcileAssessment } from '$lib/server/llm/questions';
import { presence } from '$lib/server/llm/presence';
import { createSink, type TurnSink } from '$lib/server/llm/sink';
import { commitDocument } from '$lib/server/proposals';
import type { Chapter } from '$lib/server/db/types';
import type { RequestHandler } from './$types';

/** See the comment where it is used. */
const TURN_MAX_TOKENS = 16000;

/**
 * The chapter a `<chapter>` block was meant for.
 *
 * The prompt asks for the key, and the models do not always give it: no key at
 * all means the chapter under discussion, and the title written instead of the
 * key is matched as a title. Anything else is reported rather than guessed at.
 */
function draftTarget(written: string, chapters: Chapter[], active: Chapter | null): Chapter | null {
	if (!written) return active;
	const name = written.trim().toLowerCase();
	return (
		chapters.find((c) => c.key.toLowerCase() === name) ??
		chapters.find((c) => c.title.trim().toLowerCase() === name) ??
		null
	);
}

/**
 * One agent turn, streamed to the browser as SSE.
 *
 * Events:
 *   text     { delta }                     — conversational reply, token by token
 *   chapter  { key, markdown }             — a chapter the agent rewrote
 *   requirement { ... }                    — a rule the agent settled
 *   decision { ... }                       — something settled, and by whom
 *   options  { options }                   — answers offered for the question asked
 *   state    { key, status, openQuestions } — updated completeness
 *   commit   { hash }                      — changes recorded on the proposal branch
 *   error    { message }
 *   done     {}
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId, chapterKey, message } = (await request.json()) as {
		projectId: number;
		chapterKey: string | null;
		message: string;
	};

	if (!message?.trim()) throw error(400, 'Empty message');

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	const revision = documentRevision(project.id);

	const chapters = projectChapters(project.id);
	const active = chapterKey ? (getChapter(project.id, chapterKey) ?? null) : null;
	const activeRequirements = active ? chapterRequirements(project.id, active.key) : [];

	const history = recentMessages(project.id, chapterKey, 16).map((m) => ({
		role: m.role,
		content: m.content
	}));

	addMessage(project.id, chapterKey, 'user', message);

	// Presence explains ongoing work; the revision guard prevents stale writes.
	const watcher = locals.user;
	presence.setWriting(project.id, watcher.id, true, Date.now());

	const encoder = new TextEncoder();

	// Held out here so `cancel` can reach it. Everything below writes through the
	// sink rather than the controller, so the turn finishes whether or not anyone
	// is still reading it — see `llm/sink.ts`.
	let sink: TurnSink | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			const live = createSink((frame) => controller.enqueue(encoder.encode(frame)));
			sink = live;
			const send = (event: string, data: unknown) => live.send(event, data);

			const parser = new ChapterStreamParser();
			let reply = '';
			/** A chapter block that named no chapter this document has. */
			let unfiled = false;

			/**
			 * A chapter the triage set aside, written into anyway, applies after all.
			 * Left set aside, its prose and requirements were reported as belonging to
			 * a chapter that no longer exists, and the export called it "nothing to
			 * build" while counting its requirements as in scope.
			 */
			const reopen = (chapter: Chapter) => {
				if (chapter.applicable === 0) setChapterApplicable(project.id, chapter.key, true);
			};

			try {
				const conversation = toChatMessages(history, message);

				for await (const event of gateway.streamChat({
					system: buildSystemPrompt(
						project,
						chapters,
						active,
						activeRequirements
					),
					messages: conversation,
					// One reply carries the whole chapter rewritten, its requirements and
					// decisions, and the model's reasoning before any of it — all from this
					// one budget. At 6000 a chapter of a few thousand words could not be
					// written at all, and every retry failed the same way.
					maxTokens: TURN_MAX_TOKENS
				})) {
					if (event.type === 'text') {
						const visible = parser.push(event.text);
						if (visible) {
							reply += visible;
							send('text', { delta: visible });
						}
					}
					// `thinking` events are intentionally dropped — reasoning output is
					// never shown to the user, and never stored in the transcript.
				}

				const tail = parser.end();
				if (tail) {
					reply += tail;
					send('text', { delta: tail });
				}

				// Answers the agent offered for the question it just asked. Stored with
				// the message so they survive a reload, not just this stream.
				const options = parseOptions(parser.optionsBlock);
				// A reply that was nothing but blocks has no words to keep, and an empty
				// turn replayed to the gateway is a request it refuses.
				if (reply.trim() || options.length > 0) {
					addMessage(project.id, chapterKey, 'assistant', reply.trim(), options);
				}
				if (options.length > 0) send('options', { options });

				// --- An arrangement of sub-chapters, if the agent proposed one. Applied
				//     before the chapter drafts so a section created by this reply can be
				//     written by the same reply. It used to run last, which is what the
				//     comment claimed it did not, and any such write was dropped.
				const touched: string[] = [];
				const documentEvents: Array<[string, unknown]> = [];
				withDocumentRevision(project.id, revision, () => {
					const send = (event: string, data: unknown) => documentEvents.push([event, data]);
					let splitParent: string | null = null;

					const plan = parser.blocksOf('subchapters').at(-1);
					if (plan && active && active.is_dynamic && !active.parent_key) {
						const planned = parseSectionPlan(plan.body);
						if (planned.length > 0) {
							const result = applySectionPlan(project.id, active, planned);
							splitParent = active.key;
							if (result.changed) {
								send('sections', { parent: active.key, created: result.created });
								if (!touched.includes(active.key)) touched.push(active.key);
							}
						}
					}

					// --- Persist any chapters the agent rewrote.
					const current = projectChapters(project.id);
					for (const [written, markdown] of parser.drafts) {
						const target = draftTarget(written, current, active);
						if (!target) {
							console.warn(`[chat] agent wrote unknown chapter "${written}" — not saved`);
							unfiled = true;
							continue;
						}
						const clean = normalizeChapterMarkdown(markdown, target.title);
						if (!clean.trim()) continue; // nobody means to erase a chapter by writing nothing
						const key = target.key;
						updateChapterState(project.id, key, { contentMd: clean });
						reopen(target);
						if (!touched.includes(key)) touched.push(key);
						send('chapter', { key, markdown: clean });

						// Once split, a chapter's content is its sections. Prose written
						// back into it under a section's heading is filed there — only into
						// an empty section, as at split time, so nothing written is lost.
						if (key !== splitParent && current.some((c) => c.parent_key === key)) {
							const moved = distributeSectionContent(project.id, key);
							for (const section of moved.filled) {
								send('chapter', { key: section.key, markdown: section.markdown });
								if (!touched.includes(section.key)) touched.push(section.key);
							}
							if (moved.parentMd !== null) send('chapter', { key, markdown: moved.parentMd });
						}
					}

					// --- Requirements the agent settled this turn. After the chapters, so a
					//     requirement can arrive alongside the prose that explains it.
					for (const block of parser.blocksOf('requirement')) {
						const draft = toRequirementDraft(block.attrs, block.body);
						if (!draft) continue;

						// Restating a requirement by reference changes its wording, not where
						// it lives: it stays in its own chapter unless one is named.
						const recorded = draft.ref ? getRequirement(project.id, draft.ref) : undefined;
						const key = draft.chapterKey ?? recorded?.chapter_key ?? active?.key;
						const owner = key ? getChapter(project.id, key) : undefined;
						if (!key || !owner) {
							console.warn(`[chat] requirement for unknown chapter "${key}" — ignoring`);
							continue;
						}

						if (draft.remove) {
							// A company standard is the organisation's rule, not this
							// conversation's to delete. Deviating from one is recorded by
							// restating it as out of scope, which stays visible in review.
							if (recorded?.source === 'standard') {
								console.warn(`[chat] agent tried to remove company standard ${recorded.ref} — kept`);
								continue;
							}
							if (draft.ref && deleteRequirement(project.id, draft.ref)) {
								send('requirement', { ref: draft.ref, chapterKey: key, removed: true });
							}
							if (!touched.includes(key)) touched.push(key);
							continue;
						}
						reopen(owner);

						const saved = saveRequirement(project.id, {
							ref: draft.ref,
							chapterKey: key,
							statement: draft.statement,
							scope: draft.scope,
							scenarios: draft.scenarios,
							existing: draft.existing
						});
						send('requirement', { ...saved, removed: false });
						if (!touched.includes(key)) touched.push(key);
					}

					// --- A chapter that has just been split still holds everything that was
					//     written before it was split, so the prose is filed into the sections
					//     that now own it. After the drafts, so it is whatever the chapter says
					//     now that gets filed, not what it said when the turn began.
					if (splitParent) {
						const moved = distributeSectionContent(project.id, splitParent);
						for (const section of moved.filled) {
							send('chapter', { key: section.key, markdown: section.markdown });
							if (!touched.includes(section.key)) touched.push(section.key);
						}
						if (moved.parentMd !== null) {
							send('chapter', { key: splitParent, markdown: moved.parentMd });
						}
					}

					// --- Decisions settled this turn, with who settled them.
					for (const block of parser.blocksOf('decision')) {
						const draft = toDecisionDraft(block.attrs, block.body);
						if (!draft) continue;

						const key = draft.chapterKey ?? active?.key;
						const owner = key ? getChapter(project.id, key) : undefined;
						if (!key || !owner) continue;
						reopen(owner);

						const saved = saveDecision(project.id, {
							chapterKey: key,
							statement: draft.statement,
							rationale: draft.rationale,
							source: draft.source
						});
						send('decision', saved);
						if (!touched.includes(key)) touched.push(key);
					}

					// --- A chapter that has just been written is no longer empty, whatever
					//     else is true of it — including the active one, whose assessment
					//     can fail and would otherwise leave it reading "not started".
					//     Cheap correction — no extra gateway call.
					for (const key of touched) {
						const written = getChapter(project.id, key);
						if (written?.status === 'empty') {
							updateChapterState(project.id, key, { status: 'in_progress' });
							send('state', { key, status: 'in_progress', openQuestions: written.open_questions });
						}
					}

				});
				for (const [event, data] of documentEvents) send(event, data);
				if (unfiled) {
					send('error', {
						message:
							'Part of that answer could not be filed into a chapter, so it was not saved. ' +
							'Ask the assistant to write it again.'
					});
				}

				// --- Re-assess completeness against its own captured revision.
				const assessKey = active?.key ?? touched[0];
				if (assessKey) {
					const chapter = getChapter(project.id, assessKey);
					const assessmentRevision = documentRevision(project.id);
					if (chapter) {
						const assessment = reconcileAssessment(
							await assessChapter({
								chapter,
								chapterContent: chapter.content_md,
								conversation: [...conversation, { role: 'assistant', content: reply.trim() }],
								latestReply: reply
							}),
							reply,
							// Read now, not at the start of the turn: a split this turn adds titles.
							projectChapters(project.id)
								.filter((c) => c.key !== assessKey)
								.map((c) => c.title)
						);

						if (assessment) {
							// Store the assessor's verdict; the status the user sees is derived
							// from it, so confirming an assumption takes effect at once.
							try {
								withDocumentRevision(project.id, assessmentRevision, () => updateChapterState(project.id, assessKey, {
									status: assessment.status,
									openQuestions: assessment.openQuestions
								}));
								if (!touched.includes(assessKey)) touched.push(assessKey);

								const pending = unconfirmed(
									projectDecisions(project.id).filter((d) => d.chapter_key === assessKey)
								).length;

								send('state', {
									key: assessKey,
									status: effectiveStatus(assessment.status, pending),
									openQuestions: assessment.openQuestions
								});
							} catch (cause) {
								if (!(cause instanceof DocumentConflict)) throw cause;
								send('error', { message: 'The document changed during completeness checking. The newer chapter state was kept.' });
							}
						}
					}
				}

				// --- Record the change on the proposal branch.
				if (touched.length > 0) {
					try {
						const titles = touched
							.map((k) => getChapter(project.id, k)?.title ?? k)
							.join(', ');
						const hash = await commitDocument(project, `Update ${titles}`);
						if (hash) send('commit', { hash: hash.slice(0, 8), chapters: touched });
					} catch (gitError) {
						// A git failure must not lose the conversation or the chapter text,
						// both of which are already safely in the database.
						//
						// It must not be reported as harmless either. Until it is recorded
						// the change is not on the proposal, so it is not in what anyone
						// reviews or approves. It is not lost: the next commit writes the
						// whole document out of the database and picks this up with it —
						// which is what the message should say, rather than asking for a
						// turn to be repeated that is already stored.
						console.error('[chat] failed to record changes in git:', gitError);
						send('error', {
							message:
								'Your answers are saved, but this change has not been added to the ' +
								'application’s history yet, so it will not appear for review until ' +
								'the next change is recorded.'
						});
					}
				}

				send('done', {});
			} catch (cause) {
				console.error('[chat] turn failed:', cause);
				send('error', { message: describeFailure(cause) });
			} finally {
				// Cleared here rather than when the connection drops: the turn goes on
				// writing after the tab closes, and it is the writing that matters to
				// anyone else in the document.
				presence.setWriting(project.id, watcher.id, false, Date.now());

				if (live.connected) {
					// Still guarded: the stream can be cancelled between the last event
					// and here, and closing a cancelled one throws.
					try {
						controller.close();
					} catch {
						live.disconnect();
					}
				} else {
					// Worth a line: it is the difference between a turn nobody saw and a
					// turn that did not happen, and only the log can tell them apart.
					console.info(
						`[chat] turn for project ${project.id} finished after the browser left` +
							` — ${live.dropped} events not delivered, everything recorded`
					);
				}
			}
		},

		/**
		 * The browser went away. `adapter-node` cancels the reader on the response's
		 * `close` event, so this fires as the tab does.
		 *
		 * It stops delivery and nothing else. The turn keeps running: the user's
		 * message is already stored, and the chapter written from it, the
		 * requirements settled in it and the commit recording them all still have
		 * to happen, or their answer is lost and they are asked the same thing again.
		 */
		cancel() {
			sink?.disconnect();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
