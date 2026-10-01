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
	projectChapters,
	projectDecisions,
	recentMessages,
	saveDecision,
	saveRequirement,
	updateChapterState,
	withDocumentRevision
} from '$lib/server/db';
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
import type { RequestHandler } from './$types';

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
					maxTokens: 6000
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
				addMessage(project.id, chapterKey, 'assistant', reply.trim(), options);
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
					for (const [key, markdown] of parser.drafts) {
						const target = getChapter(project.id, key);
						if (!target) {
							console.warn(`[chat] agent wrote unknown chapter "${key}" — ignoring`);
							continue;
						}
						const clean = normalizeChapterMarkdown(markdown, target.title);
						updateChapterState(project.id, key, { contentMd: clean });
						touched.push(key);
						send('chapter', { key, markdown: clean });
					}

					// --- Requirements the agent settled this turn. After the chapters, so a
					//     requirement can arrive alongside the prose that explains it.
					for (const block of parser.blocksOf('requirement')) {
						const draft = toRequirementDraft(block.attrs, block.body);
						if (!draft) continue;

						const key = draft.chapterKey ?? active?.key;
						if (!key || !getChapter(project.id, key)) {
							console.warn(`[chat] requirement for unknown chapter "${key}" — ignoring`);
							continue;
						}

						if (draft.remove) {
							if (draft.ref && deleteRequirement(project.id, draft.ref)) {
								send('requirement', { ref: draft.ref, chapterKey: key, removed: true });
							}
							if (!touched.includes(key)) touched.push(key);
							continue;
						}

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
						if (!key || !getChapter(project.id, key)) continue;

						const saved = saveDecision(project.id, {
							chapterKey: key,
							statement: draft.statement,
							rationale: draft.rationale,
							source: draft.source
						});
						send('decision', saved);
						if (!touched.includes(key)) touched.push(key);
					}

					// --- A chapter the agent wrote in passing is no longer empty, whatever
					//     else is true of it. Cheap correction — no extra gateway call.
					for (const key of touched) {
						if (key === active?.key) continue;
						const written = getChapter(project.id, key);
						if (written?.status === 'empty') {
							updateChapterState(project.id, key, { status: 'in_progress' });
							send('state', { key, status: 'in_progress', openQuestions: written.open_questions });
						}
					}

				});
				for (const [event, data] of documentEvents) send(event, data);

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
				send('error', {
					message:
						cause instanceof DocumentConflict ? cause.message : cause instanceof Error
							? `The assistant could not respond: ${cause.message}`
							: 'The assistant could not respond.'
				});
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
