/**
 * Drafting a whole document with nobody to ask.
 *
 * The interview is the way to a document someone will build from. A draft is
 * the way to see what such a document would say before answering a dozen
 * chapters of questions: the assistant writes every chapter that applies from
 * the name, the description and the triage answers, and records each choice it
 * made as an assumption awaiting confirmation.
 *
 * This module decides what may be drafted, what a drafting call is asked, what
 * a reply is allowed to change, and when a drafted application still counts as
 * nobody's work but the assistant's. The job that runs the calls is
 * `server/drafting.ts`.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

/** A chapter as this module needs to see it. */
export interface DraftableChapter {
	key: string;
	title: string;
	goal?: string;
	purpose: string;
	questions: string[];
	criteria: string[];
	applicable: number;
	parent_key: string;
	content_md: string;
}

/** What a person has already put into one chapter. */
export interface ChapterHoldings {
	/**
	 * Messages a person sent in its conversation. Not the assistant's: an open
	 * question clicked in an empty chapter is not anyone's work, and counted, it
	 * made the drafter drop its reply. The same rule as `isUntouchedDraft`.
	 */
	messages: number;
	decisions: number;
	/** Rules of its own; company standards are inherited, not anyone's work. */
	rules: number;
}

/**
 * The chapters a draft should write, in the order to write them.
 *
 * Only what applies, only leaves — a chapter split into sections is its sections
 * — and only what nobody has put anything into: a draft never writes over a
 * person's work, including a conversation that has not produced prose yet. The
 * Overview goes first because every other chapter is written against it.
 */
export function chaptersToDraft<T extends DraftableChapter>(
	chapters: T[],
	holdings: Map<string, ChapterHoldings>
): T[] {
	const parents = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
	const open = chapters.filter(
		(c) =>
			c.applicable !== 0 &&
			!parents.has(c.key) &&
			!c.content_md.trim() &&
			untouchedChapter(holdings.get(c.key))
	);
	return [...open.filter((c) => c.key === 'overview'), ...open.filter((c) => c.key !== 'overview')];
}

function untouchedChapter(held: ChapterHoldings | undefined): boolean {
	return !held || (held.messages === 0 && held.decisions === 0 && held.rules === 0);
}

/** Everything that says whether a drafted application is still only the assistant's. */
export interface DraftEvidence {
	origin: string;
	documentRevision: number;
	/** The revision the draft left the document at; null when it was never drafted. */
	draftedRevision: number | null;
	/** Messages a person sent in any of its conversations. */
	userMessages: number;
	/**
	 * Proposals sent for review or approved, and approvals begun. The journal row is
	 * written before the proposal reads as merged, so it is the earlier sign.
	 */
	reviewed: number;
}

/**
 * Drafted by the assistant, and nothing of anyone's in it since.
 *
 * Derived, never stored: a flag cleared by every path through which a person
 * changes a document is a rule in the memory of whoever adds the next path. The
 * document revision is moved by every such write already — prose, rules,
 * decisions, a chapter included, the project's details — and the draft only
 * keeps up with it while nothing else has written. A message that changed
 * nothing and an approval do not move it, so they are read separately.
 */
export function isUntouchedDraft(evidence: DraftEvidence): boolean {
	return (
		evidence.origin === 'generated' &&
		evidence.draftedRevision !== null &&
		evidence.draftedRevision === evidence.documentRevision &&
		evidence.userMessages === 0 &&
		evidence.reviewed === 0
	);
}

/**
 * - `running`   — chapters are being written now
 * - `stopped`   — an untouched draft with chapters still unwritten: a call failed,
 *                 or the server stopped part-way
 * - `undrafted` — someone has worked in it since, and some chapters were never
 *                 drafted — one they included afterwards, say. Nothing stopped.
 * - `empty`     — nothing was drafted at all; calling it a draft would be untrue
 * - `finished`  — every chapter that applies has been written
 */
export type DraftState = 'running' | 'stopped' | 'undrafted' | 'empty' | 'finished';

/**
 * Where a draft stands, read from the document rather than from the job.
 *
 * The job lives in memory and a restart loses it; the chapters it wrote do not.
 * Whatever is still unwritten, whether a call failed or the server stopped, is
 * the same situation to the user, with the same remedy: draft the rest. The
 * words for it depend on whether anyone has worked in the document since — a
 * chapter included after the draft did not stop anything.
 */
export function draftState(args: {
	origin: string;
	running: boolean;
	/** Chapters `chaptersToDraft` would write. */
	remaining: number;
	/** Chapters in scope that have prose. */
	written: number;
	untouched: boolean;
}): DraftState | null {
	if (args.origin !== 'generated') return null;
	if (args.running) return 'running';
	if (args.remaining === 0) return 'finished';
	if (args.written === 0) return 'empty';
	return args.untouched ? 'stopped' : 'undrafted';
}

/**
 * Filed in a drafted chapter whose reply recorded no decision of its own.
 *
 * The decisions come last in a drafting reply, and the end of a long instruction
 * is what these models drop. A drafted chapter with nothing to confirm reads
 * "complete" — the one thing a draft nobody has checked must never do.
 */
export const UNCHECKED_CHAPTER = {
	statement: 'The assistant wrote this chapter on its own.',
	rationale: 'Nothing in it has been checked with you yet.'
};

/* ------------------------------------------------------------------ prompt */

export interface DraftPromptInput {
	project: { name: string; description: string; kind: string };
	/** The triage answers in a line — `describeProfile`. */
	profile: string;
	chapter: DraftableChapter;
	/** The chapters in scope, for orientation. */
	chapters: Array<{ key: string; title: string; goal?: string }>;
	/** The Overview as drafted, or empty while it is not. */
	overview: string;
	/** Decisions already recorded in other chapters, so parallel calls agree. */
	decidedElsewhere: Array<{ chapter: string; statement: string }>;
	/** Company standards already recorded in this chapter. */
	standards: string[];
	/** A second attempt, after the first ran out of room or wrote no chapter. */
	brief?: boolean;
}

const bullets = (lines: string[], none: string) => (lines.length ? lines.map((l) => `- ${l}`).join('\n') : none);

/**
 * The system prompt for drafting one chapter.
 *
 * Its own, not the interview's: that one is about asking, and its budget is
 * spent (PLAN.md, Stage B). Everything here that must hold is also enforced
 * where the reply is read — see `draftedProse` and `asDraftBlock`.
 */
export function buildDraftPrompt(input: DraftPromptInput): string {
	const { project, chapter } = input;
	const existing = project.kind === 'change';

	const parts: string[] = [
		`You are Specman, a design assistant at Škoda Auto. A colleague has asked you to
draft the whole design document for an application on your own, as a starting point
they can read, change or throw away. There is nobody to ask. Every question this
chapter would normally put to them, you answer yourself with the default a sensible
organisation like Škoda Auto would choose — and you record each such answer as a
decision, so they can see what was assumed.`,

		`The application
Name: ${project.name}
What it should do, in their words: ${project.description.trim() || '(not described)'}
It is ${input.profile}.${
			existing
				? `

IT ALREADY EXISTS: they want to change something they already run. You do not know
how it works today, so assume it, say plainly in the chapter which parts are already
true and which are new, mark a rule describing today's behaviour with existing="true",
and record every guess about today as a decision.`
				: ''
		}`,

		`The document's chapters, for orientation — you write only the one asked for:
${input.chapters.map((c) => `- ${c.title}${c.goal ? `: ${c.goal}` : ''}`).join('\n')}`
	];

	if (input.overview.trim() && chapter.key !== 'overview') {
		parts.push(`The Overview, already drafted — everything you write must agree with it:\n${input.overview.trim()}`);
	}
	if (input.decidedElsewhere.length > 0) {
		parts.push(
			`Already decided in other chapters — stay consistent with these:\n${bullets(
				input.decidedElsewhere.map((d) => `${d.statement} (${d.chapter})`),
				''
			)}`
		);
	}

	parts.push(
		`The chapter to write: "${chapter.title}" (key: ${chapter.key})
${chapter.goal ? `What it is for: ${chapter.goal}\n` : ''}
Purpose:
${chapter.purpose}

Questions it must answer — answer every one yourself:
${bullets(chapter.questions, '- (none defined)')}

It is complete when:
${bullets(chapter.criteria, '- (no criteria defined)')}${
			input.standards.length > 0
				? `

Company standards already recorded in this chapter. They are settled for every
application: do not restate them as rules of your own, and do not contradict them.
${bullets(input.standards, '')}`
				: ''
		}`
	);

	parts.push(
		`WRITE THESE, IN THIS ORDER, AND NOTHING ELSE

1. The whole chapter, in one block:

    <chapter key="${chapter.key}">
    …
    </chapter>

   Plain prose a non-technical reader understands. Sub-headings are fine; do not
   start with a heading for the chapter itself. Write settled statements only —
   never "TBD", never "the user said", never a question. Keep it focused on what
   someone building the application needs; leave out padding.

2. The rules it must always follow, one per block, each with at least one example:

    <requirement scope="now">
    The application must never allow two people to book the same car on the same day.
    WHEN two employees try to reserve the same car for the same day
    THEN only the first succeeds, and the second is told the car is taken
    </requirement>

   Use WHEN and THEN literally, even when writing in another language — they are
   markers the reader never sees. scope="now" for the first version, "later" for
   a sensible later addition, "out" for something deliberately excluded.

3. Every choice you made that a reasonable person could have made differently,
   one per block:

    <decision>
    Sign-in uses the normal company account.
    Why: everyone already has one, so there is no extra password to look after.
    </decision>

   Record every one — a number you picked, a rule you chose, a group of users you
   assumed, anything you assumed about how they work. These are shown to your
   colleague as assumptions to check; an assumption you leave unrecorded is one
   they will never know you made.

Write everything in the language the description above is written in. No greeting,
no reply, no questions — only the blocks.${
			input.brief
				? `

YOUR LAST ATTEMPT AT THIS CHAPTER DID NOT FINISH. Keep it short this time: the
essentials in a few paragraphs, at most five rules, and only the decisions that matter
most. Start the chapter block at once.`
				: ''
		}`
	);

	return parts.join('\n\n---\n\n');
}

/** The user turn a drafting call is sent with; the gateway needs one. */
export function draftRequest(title: string): string {
	return `Draft the chapter "${title}" now.`;
}

/* ------------------------------------------------------------ the reply */

/**
 * The prose a reply wrote for this chapter, or null if it wrote none.
 *
 * A block naming this chapter by key, then one naming none, then one naming its
 * title — the rule `draftTarget` applies in the chat endpoint, restated because
 * this module takes no imports. A block for any other chapter is never this
 * chapter's, and is not written anywhere else either: that chapter is being
 * drafted by another call at the same moment.
 *
 * Judged empty after `normalise`, which is what will be saved: a block holding
 * nothing but the chapter's own heading is empty once the heading is stripped,
 * and its rules and decisions would otherwise be saved over no prose at all.
 */
export function draftedProse(
	chapter: { key: string; title: string },
	drafts: Map<string, string>,
	normalise: (markdown: string, title: string) => string = (markdown) => markdown.trim()
): string | null {
	const named = (written: string) => written.trim().toLowerCase();
	const candidates = [
		...[...drafts].filter(([written]) => named(written) === chapter.key.toLowerCase()),
		...[...drafts].filter(([written]) => written.trim() === ''),
		...[...drafts].filter(([written]) => named(written) === chapter.title.trim().toLowerCase())
	];
	for (const [, markdown] of candidates) {
		const clean = normalise(markdown, chapter.title);
		if (clean.trim()) return clean;
	}
	return null;
}

export interface DraftBlock {
	tag: string;
	attrs: Record<string, string>;
	body: string;
}

/**
 * A rule or decision from a drafting reply, as it may be stored.
 *
 * Everything is filed in the chapter being drafted and everything is new: a draft
 * has nothing of its own to change, so a reference is dropped and a removal is
 * not a block at all. Every decision is the assistant's. Nobody told it anything,
 * and a decision labelled as the user's is stored as already agreed. Anything
 * other than a rule or a decision is not the draft's to write.
 */
export function asDraftBlock(block: DraftBlock): DraftBlock | null {
	const { chapter: _chapter, ref: _ref, action, source: _source, ...rest } = block.attrs;
	if (block.tag === 'requirement') {
		if ((action ?? '').trim().toLowerCase() === 'remove') return null;
		return { tag: 'requirement', attrs: rest, body: block.body };
	}
	if (block.tag === 'decision') return { tag: 'decision', attrs: { ...rest, source: 'agent' }, body: block.body };
	return null;
}
