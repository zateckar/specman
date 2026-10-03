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
	messageCount,
	messagesFrom,
	projectDecisions,
	projectRequirements,
	saveDecision,
	saveRequirement,
	setChapterApplicable,
	updateChapterState,
	withChapterUnchanged,
	withDocumentRevision
} from '$lib/server/db';
import { TURN_BUDGET } from '$lib/server/llm/budgets';
import { describeFailure } from '$lib/server/llm/failures';
import { attributeDecision, effectiveStatus, toDecisionDraft, unconfirmed } from '$lib/server/llm/decisions';
import { sameStatement, toRequirementDraft } from '$lib/server/llm/requirements';
import { parseSectionPlan } from '$lib/server/llm/subchapters';
import { gateway } from '$lib/server/llm/gateway';
import {
	ChapterStreamParser,
	assessChapter,
	buildSystemPrompt,
	normalizeChapterMarkdown,
	toChatMessages
} from '$lib/server/llm/agent';
import {
	ACTIVE_LIMIT,
	READ_ROUNDS,
	READ_TOOL,
	buildTurnState,
	documentContext,
	historyWindowStart,
	mergeSection,
	readChapter,
	repairRequest,
	unwrittenMentions,
	withLastTurn
} from '$lib/server/llm/context';
import { textOf, type ChatMessage } from '$lib/server/llm/types';
import { parseOptions, reconcileAssessment } from '$lib/server/llm/questions';
import { presence } from '$lib/server/llm/presence';
import { TurnProgress } from '$lib/server/llm/progress';
import { createSink, type TurnSink } from '$lib/server/llm/sink';
import { commitDocument } from '$lib/server/proposals';
import { isDrafting, STILL_DRAFTING } from '$lib/server/drafting';
import type { Chapter } from '$lib/server/db/types';
import type { RequestHandler } from './$types';

/** Comfortably inside the idle limit of any proxy likely to sit in front. */
const HEARTBEAT_MS = 15_000;

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
 *   activity { doing, chapter }            — what the assistant is doing: thinking,
 *                                            writing, noting, replying, checking, saving
 *   drafting { chapter, delta | markdown } — a chapter as it is being written; not saved
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
	// Before the message is stored: kept, it would mark the draft as someone's
	// work over a turn that could record nothing.
	if (isDrafting(project.id)) throw error(409, STILL_DRAFTING);
	const revision = documentRevision(project.id);

	const chapters = projectChapters(project.id);
	const active = chapterKey ? (getChapter(project.id, chapterKey) ?? null) : null;
	const requirements = projectRequirements(project.id);
	const activeRequirements = active ? requirements.filter((r) => r.chapter_key === active.key) : [];

	// A window whose start moves in steps, not with every turn. See `llm/context.ts`.
	const start = historyWindowStart(messageCount(project.id, chapterKey));
	const history = messagesFrom(project.id, chapterKey, start).map((m) => ({
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
			// The model can reason for a minute before its first word, and a proxy
			// that closes quiet connections ended the stream there — which the page
			// read as a reply that had finished.
			const heartbeat = setInterval(() => live.ping(), HEARTBEAT_MS);

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

			// What the assistant is doing while nothing it writes is for the chat —
			// the chapter comes first and the reply last. See `llm/progress.ts`.
			const progress = new TurnProgress();
			const chapterFor = (attrs: Record<string, string>) =>
				draftTarget((attrs.key ?? attrs.chapter ?? '').trim(), chapters, active)?.key ?? null;
			const report = (replied: boolean) => {
				const update = progress.observe(parser.writing, parser.blocks, replied, chapterFor);
				if (update.activity) send('activity', update.activity);
				for (const draft of update.drafts) send('drafting', draft);
			};

			try {
				// As stored, and as the completeness check reads it. Only the request
				// carries the chapter's state, wrapped around the last turn — which may
				// hold an earlier message a failed turn left unanswered.
				const conversation = toChatMessages(history, message);
				const lastSaid = textOf(conversation.at(-1)?.content ?? message);
				const rest = documentContext(chapters, requirements, active);
				const system = buildSystemPrompt(project, chapters, active, requirements, rest);
				// Reading is offered only when something is shown in part: with the
				// whole document in view a read is a round trip that learns nothing.
				const reading =
					[...rest.shown.values()].some((shown) => shown !== 'full') ||
					(active?.content_md.length ?? 0) > ACTIVE_LIMIT;
				const tools = reading ? [READ_TOOL] : undefined;
				// The request as it grows: each round of reading adds the call and its answer.
				const sent: ChatMessage[] = withLastTurn(
					conversation,
					buildTurnState({ chapters, active, activeRequirements, message: lastSaid })
				);

				// One reply, which may stop to read a chapter and then go on. Each stop
				// is a new request whose start the gateway has just seen, so it is
				// served from the cache. The last read a turn may make says so, and a
				// call after it ends the reply with whatever it has written.
				for (let round = 0; round <= READ_ROUNDS; round++) {
					let said = '';
					const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
					for await (const event of gateway.streamChat({
						system,
						// A copy: the request is what was asked, not what it later grew into.
						messages: [...sent],
						tools,
						// One reply carries the chapter or its changed sections, its
						// requirements and decisions, and the model's reasoning before any
						// of it — all from this one budget. See `llm/budgets.ts`.
						maxTokens: TURN_BUDGET
					})) {
						if (event.type === 'text') {
							said += event.text;
							const visible = parser.push(event.text);
							if (visible) {
								reply += visible;
								send('text', { delta: visible });
							}
							report(visible.trim().length > 0);
						} else if (event.type === 'tool_call') {
							calls.push({ id: event.id, name: event.name, input: event.input });
						}
						// `thinking` events are intentionally dropped — reasoning output is
						// never shown to the user, and never stored in the transcript.
					}
					if (calls.length === 0) break;
					if (round === READ_ROUNDS) {
						console.warn(`[chat] the assistant was still reading after ${READ_ROUNDS} rounds; its reply ends here`);
						break;
					}

					const lastRead = round === READ_ROUNDS - 1;
					const answers = calls.map((call) => {
						if (call.name !== READ_TOOL.name) return { call, text: `There is no tool called ${call.name}.` };
						const read = readChapter(call.input, chapters, requirements);
						send('activity', progress.announce('reading', read.chapter?.key ?? null));
						console.info(`[chat] the assistant read ${read.chapter?.key ?? `nothing (${JSON.stringify(call.input)})`}`);
						return {
							call,
							text: lastRead ? `${read.text}\n\n(That was the last reading this turn. Write your reply now, with what you have.)` : read.text
						};
					});
					sent.push(
						{
							role: 'assistant',
							content: [
								...(said.trim() ? [{ type: 'text' as const, text: said }] : []),
								...calls.map(({ id, name, input }) => ({ type: 'tool_use' as const, id, name, input }))
							]
						},
						{
							role: 'user',
							content: answers.map(({ call, text }) => ({ type: 'tool_result' as const, tool_use_id: call.id, content: text }))
						}
					);
				}

				const tail = parser.end();
				if (tail) {
					reply += tail;
					send('text', { delta: tail });
				}
				report(tail.trim().length > 0);

				// --- A reply that names another chapter it did not write may be saying
				//     it changed one, which nothing has. Asked once, for the blocks only.
				const written = [
					...parser.drafts.keys(),
					...parser.blocksOf('section').map((block) => block.attrs.chapter ?? block.attrs.key ?? '')
				]
					.map((k) => draftTarget(k, chapters, active)?.key)
					.filter((k): k is string => Boolean(k));
				const named = unwrittenMentions(reply, chapters, written, active?.key ?? null);
				if (named.length > 0) {
					send('activity', { doing: 'writing', chapter: named[0].key });
					const repair = new ChapterStreamParser();
					try {
						for await (const event of gateway.streamChat({
							system,
							messages: [
								...sent,
								{ role: 'assistant', content: reply.trim() || '(blocks only)' },
								{ role: 'user', content: repairRequest(named) }
							],
							// Offered only because a request that read must still describe the
							// tool; a call to it here is not answered.
							tools,
							maxTokens: TURN_BUDGET
						})) {
							if (event.type === 'text') repair.push(event.text);
						}
						repair.end();
					} catch (cause) {
						console.warn('[chat] could not ask for the chapters a reply named:', cause);
					}
					const got: string[] = [];
					const asked = (key: string) => {
						const target = draftTarget(key, chapters, null);
						return target && named.includes(target) ? target : null;
					};
					for (const [key, markdown] of repair.drafts) {
						const target = asked(key);
						if (target && !parser.drafts.has(target.key)) {
							parser.drafts.set(target.key, markdown);
							got.push(target.key);
						}
					}
					for (const block of repair.blocksOf('section')) {
						const target = asked(block.attrs.chapter ?? block.attrs.key ?? '');
						if (target) {
							parser.blocks.push(block);
							if (!got.includes(target.key)) got.push(target.key);
						}
					}
					console.info(
						`[chat] reply named ${named.map((c) => c.key).join(', ')} without writing it;` +
							` asked again, ${got.length ? `got ${got.join(', ')}` : 'got nothing'}`
					);
				}

				// Answers the agent offered for the question it just asked. Stored with
				// the message so they survive a reload, not just this stream.
				const options = parseOptions(parser.optionsBlock);
				const writes =
					parser.drafts.size > 0 ||
					(['section', 'subchapters', 'requirement', 'decision'] as const).some((tag) => parser.blocksOf(tag).length > 0);

				// A gateway that answers successfully with nothing at all used to end
				// the turn as though it had worked: no reply, no error, and the
				// answer apparently taken in.
				if (!reply.trim() && options.length === 0 && !writes) {
					send('error', {
						message:
							'The assistant sent nothing back this time. Your message is saved — send it again, ' +
							'or put it another way.'
					});
					send('done', {});
					return;
				}

				// --- An arrangement of sub-chapters, if the agent proposed one. Applied
				//     before the chapter drafts so a section created by this reply can be
				//     written by the same reply. It used to run last, which is what the
				//     comment claimed it did not, and any such write was dropped.
				const touched: string[] = [];
				const documentEvents: Array<[string, unknown]> = [];
				// A reply that writes nothing has nothing to check against a newer
				// document, so a colleague's change in the meantime is no conflict.
				if (writes) withDocumentRevision(project.id, revision, () => {
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

					// --- Parts of long chapters, each put in by its heading, in code. After
					//     the whole chapters, so a part lands in what this reply wrote.
					for (const block of parser.blocksOf('section')) {
						const target = draftTarget((block.attrs.chapter ?? block.attrs.key ?? '').trim(), current, active);
						// A part with no heading attribute at all is not the text before the
						// first heading by default: read that way, a forgotten attribute
						// would replace the chapter's opening with whatever part was meant.
						const heading = block.attrs.heading ?? /^#{1,6}\s+(.+)$/m.exec(block.body.split('\n')[0] ?? '')?.[1];
						if (!target || heading === undefined) {
							console.warn(`[chat] section for "${block.attrs.chapter ?? ''}" headed "${heading ?? '(none)'}" — not saved`);
							unfiled = true;
							continue;
						}
						const before = getChapter(project.id, target.key)?.content_md ?? '';
						const merged = mergeSection(before, heading, block.body, block.attrs.action === 'remove');
						if (merged.outcome === 'unchanged') continue;
						updateChapterState(project.id, target.key, { contentMd: merged.markdown });
						reopen(target);
						if (!touched.includes(target.key)) touched.push(target.key);
						send('chapter', { key: target.key, markdown: merged.markdown });
					}

					// --- Requirements the agent settled this turn. After the chapters, so a
					//     requirement can arrive alongside the prose that explains it.
					for (const block of parser.blocksOf('requirement')) {
						const draft = toRequirementDraft(block.attrs, block.body);
						if (!draft) continue;

						// Restating a requirement by reference changes its wording, not where
						// it lives: it stays in its own chapter unless one is named. A named
						// chapter is matched as a chapter block's is, by key or by title.
						const recorded = draft.ref ? getRequirement(project.id, draft.ref) : undefined;
						const owner = draft.chapterKey
							? draftTarget(draft.chapterKey, current, null)
							: recorded
								? (getChapter(project.id, recorded.chapter_key) ?? null)
								: active;
						if (!owner) {
							// Dropped without a word, this read as recorded and was not.
							console.warn(`[chat] requirement for unknown chapter "${draft.chapterKey ?? ''}" — not saved`);
							unfiled = true;
							continue;
						}
						const key = owner.key;

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

						// The same rule written again without its reference is that rule,
						// not a second copy of it.
						const restated = draft.ref
							? undefined
							: chapterRequirements(project.id, key).find((r) => sameStatement(r.statement, draft.statement));

						const saved = saveRequirement(project.id, {
							ref: draft.ref ?? restated?.ref,
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

						const owner = draft.chapterKey ? draftTarget(draft.chapterKey, current, null) : active;
						if (!owner) {
							console.warn(`[chat] decision for unknown chapter "${draft.chapterKey ?? ''}" — not saved`);
							unfiled = true;
							continue;
						}
						const key = owner.key;
						reopen(owner);

						const saved = saveDecision(project.id, {
							chapterKey: key,
							statement: draft.statement,
							rationale: draft.rationale,
							source: attributeDecision(draft.source, message)
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

				// Stored only once what it describes has been. Before, a reply saying
				// "I've recorded that" stayed in the transcript over an empty chapter
				// whenever the changes behind it were refused — and was replayed to the
				// model as though they had been made.
				//
				// A reply that was nothing but blocks has no words to keep, and an
				// empty turn replayed to the gateway is a request it refuses.
				if (reply.trim() || options.length > 0) {
					addMessage(project.id, chapterKey, 'assistant', reply.trim(), options);
				}
				if (options.length > 0) send('options', { options });

				for (const [event, data] of documentEvents) send(event, data);
				if (unfiled) {
					send('error', {
						message:
							'Part of that answer could not be filed into a chapter, so it was not saved. ' +
							'Ask the assistant to write it again.'
					});
				}

				// --- Re-assess completeness against the chapter as it reads now. The
				//     verdict is kept only if the chapter still reads that way when it
				//     arrives; a change elsewhere in the document does not make it stale.
				const assessKey = active?.key ?? touched[0];
				if (assessKey) {
					const chapter = getChapter(project.id, assessKey);
					if (chapter) {
						// A second model call, after the reply has finished: without a
						// word, the reply looked done and the box stayed locked.
						send('activity', { doing: 'checking', chapter: assessKey });
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
								.map((c) => c.title),
							chapter.content_md.trim().length > 0
						);

						if (assessment) {
							// Store the assessor's verdict; the status the user sees is derived
							// from it, so confirming an assumption takes effect at once.
							try {
								withChapterUnchanged(project.id, chapter, () => updateChapterState(project.id, assessKey, {
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
					send('activity', { doing: 'saving', chapter: null });
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
						// Except when there is no history to record it in: then the next
						// change will not pick it up either, and saying so would be untrue.
						send('error', {
							message:
								gitError instanceof Error && gitError.name === 'RepositoryMissing'
									? describeFailure(gitError)
									: 'Your answers are saved, but this change has not been added to the ' +
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
				clearInterval(heartbeat);
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
