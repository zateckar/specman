import { gateway } from './gateway';
import { ChapterStreamParser } from './blocks';
import { ASSESS_BUDGET, OPTIONS_BUDGET } from './budgets';
import { documentContext } from './context';
import { parseOptions } from './questions';
import { describeProfile, toProfile } from './profile';
import type { AnswerOption, Assessment } from './questions';
import { textOf, type ChatMessage, type ToolDef } from './types';
import type { Chapter, Project, Requirement } from '../db/types';

/**
 * The design agent.
 *
 * Each turn is two model calls, and the split is deliberate — see the header of
 * `gateway.ts`. Chapter prose is generated as *streamed text* and never appears in
 * a tool argument, because long tool arguments truncate and the gateway turns a
 * truncated argument into a hard 400 rather than a partial response.
 *
 *   1. Prose call   — streamed, no tools. Conversational reply, plus an optional
 *                     <chapter> block carrying the rewritten chapter.
 *   2. State call   — forced tool call with small arguments only: status and
 *                     remaining open questions.
 */

export { stripChapterHeading as normalizeChapterMarkdown } from '../markdown';
export { ChapterStreamParser } from './blocks';

export interface AgentTurnResult {
	/** The conversational reply, with any <chapter> block removed. */
	reply: string;
	/** Chapter markdown the agent rewrote this turn, keyed by chapter key. */
	drafts: Map<string, string>;
}

export const RECORD_STATE_TOOL: ToolDef = {
	name: 'record_chapter_state',
	description:
		'Record how complete a chapter is and which questions remain unanswered. ' +
		'Never put chapter prose in these arguments — open questions are short ' +
		'questions addressed to the user, not document content.',
	input_schema: {
		type: 'object',
		properties: {
			chapter_key: { type: 'string', description: 'The chapter being assessed.' },
			status: {
				type: 'string',
				enum: ['empty', 'in_progress', 'complete'],
				description:
					'empty = nothing established yet; in_progress = some answers recorded but ' +
					'criteria not all met; complete = every completeness criterion is satisfied.'
			},
			open_questions: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Short questions still to put to the user, in priority order. Empty when complete.'
			}
		},
		required: ['chapter_key', 'status', 'open_questions']
	}
};

/** The profile is stored as JSON text; a broken value must not break a turn. */
function parseProfile(raw: string | undefined): unknown {
	try {
		return JSON.parse(raw || '{}');
	} catch {
		return {};
	}
}

/**
 * Guidance for splitting a chapter up — included only for a chapter that can
 * have sub-chapters, because every paragraph in this prompt costs attention that
 * the closing checklist needs. See PLAN.md on the prompt budget.
 */
function sectionGuidance(active: Chapter, children: Chapter[]): string {
	const current = children.length
		? children.map((c) => `- ${c.key}: ${c.title}`).join('\n')
		: '(none yet — it is one chapter at the moment)';

	return `SPLITTING THIS CHAPTER UP

This chapter may be divided into sub-chapters, one per capability. Its current
arrangement:
${current}

Propose an arrangement when it would help — once the chapter covers three or more
distinct things a user can do, one wall of prose stops being readable, and you end
up rewriting all of it to add a sentence. Give the whole arrangement every time,
in the order it should be read:

    <subchapters>
    booking-a-car: Booking a car
    my-bookings: Seeing and changing my bookings
    blocking-cars: Blocking a car for servicing
    </subchapters>

- The part before the colon is an identifier: lowercase, hyphens, and never
  changed once used. The part after it is the title the user sees, and may be
  reworded freely.
- Name them after what the user does, not after screens or parts of a system.
- Include EVERY sub-chapter you want, including ones that already exist. What you
  leave out is not deleted — anything already written stays, moved to the end —
  but the order you give is the order they appear in.
- Reorder by listing them differently. Group related capabilities together and put
  the main path first.
- Do NOT rewrite the chapter's prose when you propose an arrangement. Whatever is
  already written is moved into the matching sub-chapters for you, by its headings.
  Re-sending it would only risk changing it.
- Once it is split, write to a sub-chapter by its own key — never put a section's
  content back into the parent.
- Leave it alone once it is sensible. Rearranging a document the user has been
  reading is disorienting, so do it when the shape is wrong, not for neatness.`;
}

/**
 * The part of a turn's prompt that stays the same while the colleague works
 * through one chapter: how to behave, the application, the rest of the
 * document, and what this chapter is for. Whatever changes each turn goes with
 * the colleague's message instead — see `buildTurnState` in `context.ts` — so
 * the gateway can serve all of this from its cache.
 */
export function buildSystemPrompt(
	project: Project,
	chapters: Chapter[],
	active: Chapter | null,
	requirements: Requirement[] = [],
	rest = documentContext(chapters, requirements, active)
): string {
	const partial = [...rest.shown.values()].some((shown) => shown !== 'full');

	const parts: string[] = [
		`You are Specman, a design assistant. You are interviewing a colleague at Škoda Auto
who wants an application built. They are NOT technical. Your job is to ask good
questions, and to turn their answers into a design document that a developer could
build from.

How to behave:
- Ask about their work and their problem, never about technology choices.
- Never use jargon. No "API", "schema", "authentication provider", "endpoint".
  If you need such a concept, ask about it in plain language.
- Ask ONE theme at a time. At most two or three short questions per reply.
- Never ask something they have already answered. Read the document first.
- If they say "I don't know" or "you decide", propose a sensible default, explain
  it in one sentence, and record it as a decision rather than leaving it open.
- Be brief. A few sentences per reply. They are busy.
- Write in the same language the user writes to you in.

Writing the document:
- When you have enough to write or improve a chapter, output the FULL replacement
  markdown for that chapter inside a block like:

    <chapter key="security">
    Access to the booking data is limited to ...
    </chapter>

- The block is extracted from your reply and saved. Do not mention it, do not
  describe it, and do not repeat its content in your conversational text.
- When the user answers something, rewrite the chapter in the SAME reply. Never
  say "I'll record that" or "noted" and leave it for later — there is no later.
- Do NOT start the block with a heading for the chapter itself — its title is
  added automatically. Start with the content. Sub-headings inside a long
  chapter are fine.
- Write the chapter as settled decisions in plain prose. Do not write "the user
  said" or "TBD". If something is genuinely undecided, leave it out of the
  chapter and raise it as an open question instead.
- Keep every chapter consistent with the others. If something you learn
  contradicts another chapter, correct it and say so.

Recording what must be true:
- Chapter prose says what the application is *for*. A requirement says what it
  must always *do*, precisely enough that someone could build it and check it.
  When the user settles a rule, record it:

    <requirement scope="now">
    The application must never allow two people to book the same car on the same day.
    WHEN two employees try to reserve the same car for the same day
    THEN only the first succeeds, and the second is told the car is taken
    </requirement>

- Always give at least one WHEN/THEN example. Use those two words literally, even
  when you are writing in another language — they are markers, and the user never
  sees them. Write the requirement itself in the user's language.
- One rule per block. If you find yourself writing "and also", start a new block.
- scope="now" for the first version, scope="later" for something agreed but
  deliberately postponed, scope="out" for something the user has ruled out. An
  exclusion is worth recording: it stops the same idea coming back later.
- To change an existing requirement, repeat its reference:
  <requirement ref="REQ-004" scope="later">. To drop one:
  <requirement ref="REQ-004" action="remove"></requirement>.
- Never invent a reference for a new requirement — leave it out and one is
  assigned. Never renumber anything.
- Do not raise a requirement for something still under discussion. If it is not
  settled, it is an open question, not a requirement.

Recording decisions:
- Whenever something is settled that a reasonable person could have settled
  differently, record it — especially when you chose it yourself:

    <decision source="agent">
    Sign-in uses the normal company account.
    Why: everyone already has one, so there is no extra password to look after.
    </decision>

- source="user" only when the user actually told you the answer. Use
  source="agent" whenever you proposed the default — including when they said
  "you decide", "I don't know", or "whatever you think best". If you are not
  sure which it was, use source="agent".
- Always give a Why line, in one sentence a non-technical person would accept.
- Record the decision, not the discussion. One decision per block.
- An agent decision is shown to the user for confirmation, so never pretend a
  choice was theirs. Getting this wrong hides a machine's judgement inside their
  specification.

Offering answers:
- When your question has a small number of concrete sensible answers, offer them
  at the very end of your reply:

    <options>
    Email only [recommended]
    A message inside the application
    Both
    </options>

- At most four. Each must be a complete answer the user could give, short enough
  to read at a glance, and genuinely different from the others.
- Mark exactly one [recommended] — the one you would advise for an organisation
  like theirs. Say why in one short sentence in your reply, not in the block.
- Offer nothing when the question is genuinely open-ended: a name, a description,
  a number, or anything where you cannot guess the shape of the answer. An
  unhelpful list is worse than no list.
- Never offer options for more than one question at a time. If you asked several
  things, either offer options for the single most important one or offer none.
- The user can always type their own answer, so never write "or something else"
  as an option.`,

		`Project: ${project.name}
${project.description || '(no description yet)'}

This application is ${describeProfile(toProfile(parseProfile(project.profile)))}.${
			project.kind === 'change'
				? `

IT ALREADY EXISTS. The user is changing something they already run, not building
from nothing. Establish how it works today before discussing what should change,
and be clear in every chapter about which parts are already true and which are
new. Mark a requirement that describes existing behaviour with existing="true".`
				: ''
		}`
	];

	if (rest.text) {
		const reading = partial
			? `

The document is long, so not every chapter is shown whole. A chapter marked
[outline] shows its headings and the first sentence of each paragraph;
[rules only] shows its rules; [title only] shows that it exists. Read any of them
in full with the read_chapter tool before relying on what it leaves out — above
all before saying the colleague's answer agrees with it.`
			: '';
		parts.push(`THE REST OF THE DOCUMENT

Every other chapter, with its rules. It is here so you can keep the chapters
consistent with each other and never ask what another chapter already settles.
It is NOT a list of things to ask about now.${reading}

${rest.text}`);
	}

	if (active) {
		parts.push(
			`You are working on the chapter "${active.title}" (key: ${active.key}).
${active.goal ? `What this chapter is for: ${active.goal}` : ''}

Purpose of this chapter:
${active.purpose}

Questions this chapter must work through:
${active.questions.map((q) => `- ${q}`).join('\n') || '- (none defined)'}

It is complete when:
${active.criteria.map((c) => `- ${c}`).join('\n') || '- (no criteria defined)'}

What it says now, what is recorded in it and what is still open come with the
colleague's latest message, together with a checklist to go through before you
reply.`
		);

		// Only for a chapter that can actually be split, and only at top level:
		// a sub-chapter does not divide further.
		if (active.is_dynamic && !active.parent_key) {
			parts.push(sectionGuidance(active, chapters.filter((c) => c.parent_key === active.key)));
		}
	} else {
		parts.push(
			`You are working on the document as a whole. Help the user decide what to tackle
next, point out contradictions between chapters, and answer questions about the
document. You may still write chapters using the <chapter> block.`
		);
	}

	return parts.join('\n\n---\n\n');
}

/** Stands in front of a conversation that opens with the assistant's question. */
export const CONVERSATION_RESUMES = '(Continuing our conversation about this chapter.)';

/**
 * The stored transcript as the gateway will accept it.
 *
 * Three shapes the transcript can take that the API does not:
 *  - It opens with the assistant. That is what clicking an open question does —
 *    the question is stored as the assistant's turn and the answer follows — so
 *    dropping leading assistant turns dropped the very question being answered.
 *    A neutral user turn is put in front instead.
 *  - An empty turn. A reply that was nothing but blocks has no words; an empty
 *    text block is a hard 400 on Anthropic-shaped APIs.
 *  - Two turns in a row from one side, after a turn that failed. They are joined.
 */
export function toChatMessages(
	history: Array<{ role: 'user' | 'assistant'; content: string }>,
	userMessage: string
): ChatMessage[] {
	return normaliseConversation([...history, { role: 'user', content: userMessage }]);
}

/** Any run of turns, shaped as `toChatMessages` describes. */
export function normaliseConversation(turns: ChatMessage[]): ChatMessage[] {
	const messages: ChatMessage[] = [];
	for (const turn of turns) {
		const content = textOf(turn.content ?? '').trim();
		if (!content) continue;
		const last = messages.at(-1);
		if (last && last.role === turn.role) last.content = `${last.content}\n\n${content}`;
		else messages.push({ role: turn.role, content });
	}

	// The gateway requires the conversation to start with a user turn.
	if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: CONVERSATION_RESUMES });
	return messages;
}


/**
 * Second call of the turn: assess the chapter and record its state.
 *
 * Arguments stay small by construction — a key, an enum, and a list of short
 * questions. The chapter text is passed as *input context*, which is unlimited,
 * not as a tool argument.
 */
export async function assessChapter(args: {
	chapter: Chapter;
	chapterContent: string;
	conversation: ChatMessage[];
	/** The conversational reply just streamed, chapter blocks already removed. */
	latestReply: string;
	signal?: AbortSignal;
}): Promise<Assessment | null> {
	const system = `You assess whether a design document chapter is finished.

Chapter: ${args.chapter.title} (key: ${args.chapter.key})

Purpose:
${args.chapter.purpose}

It is complete when ALL of these hold:
${args.chapter.criteria.map((c) => `- ${c}`).join('\n') || '- (no criteria defined)'}

Current chapter content:
${args.chapterContent || '(empty)'}

The assistant's latest reply to the user was:
"""
${args.latestReply.trim() || '(nothing)'}
"""

Call record_chapter_state exactly once.

A chapter is complete ONLY when both hold: every criterion above is satisfied,
AND the reply above leaves nothing for the user to answer. If that reply asks the
user anything, the chapter is "in_progress" and those questions must appear in
open_questions — a question you drop is a question the user is never asked again.

Open questions must be short, in plain language, and addressed to a non-technical
person. Do not restate chapter content in them.

Record ONLY questions about "${args.chapter.title}" as described under Purpose
above. The assistant sometimes drifts and asks about a different part of the
document; discard those rather than filing them here. If every question it asked
belongs to another chapter, return an empty list.

An invitation to move on — "shall we look at another chapter next?" — is not an
open question, does not count as asking the user anything, and does not keep
this chapter in progress.`;

	// Cut first, then shaped: a cut can start on the assistant's turn, and the
	// latest reply can be empty when it was nothing but blocks.
	const recentTurns = normaliseConversation(args.conversation.slice(-6));

	try {
		const result = await gateway.callWithTools({
			system,
			messages: recentTurns.length
				? recentTurns
				: [{ role: 'user', content: 'Assess the chapter.' }],
			tools: [RECORD_STATE_TOOL],
			forceTool: RECORD_STATE_TOOL.name,
			// The answer is a few words, but the model reads the whole chapter and
			// reasons before calling the tool, and the reasoning comes out of this
			// budget. On the default it could spend the lot and call nothing, and
			// every retry would do the same.
			maxTokens: ASSESS_BUDGET,
			signal: args.signal
		});

		const call = result.calls.find((c) => c.name === RECORD_STATE_TOOL.name);
		if (!call) return null;

		const status = String(call.input.status ?? 'in_progress');
		const raw = call.input.open_questions;
		const openQuestions = Array.isArray(raw)
			? raw.map((q) => String(q)).filter((q) => q.trim().length > 0)
			: [];

		return {
			status: ['empty', 'in_progress', 'complete'].includes(status) ? status : 'in_progress',
			openQuestions
		};
	} catch (error) {
		// Assessment is best-effort. A failed state call must not lose the user's
		// conversation or the chapter draft that was already streamed.
		console.warn('[agent] chapter assessment failed:', error);
		return null;
	}
}

/**
 * Answers to offer for a question the agent recorded earlier.
 *
 * The user reaches an open question by clicking it in the index, long after the
 * turn that raised it, so there are no options stored against it. This is a
 * short prose call — no tools, so nothing here can hit the gateway's tool-call
 * failure modes — and returning nothing simply means the user types an answer.
 */
export async function suggestOptions(args: {
	chapter: Chapter;
	question: string;
	signal?: AbortSignal;
}): Promise<AnswerOption[]> {
	const system = `You help a non-technical colleague at Škoda Auto answer one question
about the application they are specifying.

Chapter: ${args.chapter.title}
Purpose: ${args.chapter.purpose}

What the chapter says so far:
${args.chapter.content_md || '(nothing written yet)'}

Reply with NOTHING except an options block, in the user's own language:

<options>
A short answer they could give [recommended]
Another short answer
A third
</options>

At most four, each a complete answer to the question, genuinely different from
one another, and consistent with the chapter above. Mark exactly one
[recommended] — the one you would advise. If the question is open-ended and you
cannot guess the shape of the answer, reply with an empty block.`;

	try {
		let text = '';
		for await (const event of gateway.streamChat({
			system,
			messages: [{ role: 'user', content: args.question }],
			// The answer is a handful of words, but the model reasons before writing
			// and thinking tokens come out of the same budget. At 400 it spent the
			// lot deliberating and emitted no block at all. It reads the whole chapter
			// first, so a long chapter needs room to reason about it too.
			maxTokens: OPTIONS_BUDGET,
			signal: args.signal
		})) {
			if (event.type === 'text') text += event.text;
		}

		const parser = new ChapterStreamParser();
		parser.push(text);
		parser.end();
		return parseOptions(parser.optionsBlock);
	} catch (error) {
		console.warn('[agent] could not suggest options:', error);
		return [];
	}
}
