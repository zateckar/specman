/**
 * What the interviewer is shown on a turn, in what order, and how a long
 * chapter is written back a section at a time.
 *
 * Two things decide the order. The model must be able to check an answer
 * against the rest of the document, so the rest of the document is in the
 * prompt. And the gateway serves a prompt from its cache only as far as it
 * starts the same as an earlier one, so whatever changes every turn — the
 * chapter as it now reads, its rules, its open questions, the checklist — goes
 * last, with the colleague's message, and the system prompt holds only what
 * stays put while the colleague works through one chapter.
 *
 * Import-free, so `npm test` loads it directly.
 */

import type { Chapter, Requirement } from '../db/types';
import type { ChatMessage, ToolDef } from './types';

/**
 * The rest of the document may take this many characters of the prompt, about
 * 12 000 tokens. Past it, chapters are shown in less detail — see
 * `documentContext` — and any of them can be read in full with `READ_TOOL`.
 */
export const DOCUMENT_LIMIT = 48_000;

/**
 * The chapter under discussion is shown whole up to this, about 10 000 tokens,
 * and as an outline past it, to be read a part at a time.
 */
export const ACTIVE_LIMIT = 40_000;

/** Rounds of reading a turn may make before it must answer with what it has. */
export const READ_ROUNDS = 3;

/** Replay at least this many messages of the chapter's conversation… */
export const HISTORY_KEEP = 16;
/** …starting at a multiple of this, so the start stays put for several turns. */
export const HISTORY_STEP = 8;

/**
 * Where the replayed conversation starts. A window that moves by one exchange
 * every turn changes the start of everything after the system prompt every
 * turn; one that moves in steps keeps it for `step / 2` turns at a time.
 */
export function historyWindowStart(total: number, keep = HISTORY_KEEP, step = HISTORY_STEP): number {
	return Math.floor(Math.max(0, total - keep) / step) * step;
}

function ruleLine(r: Requirement): string {
	return `- ${r.ref} [${r.scope}]${r.source === 'standard' ? ' [company standard]' : ''} ${r.statement}`;
}

const FIRST_SENTENCE = /^([\s\S]{1,300}?[.!?])(?=\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * A chapter in brief: its headings, the first sentence of every paragraph and
 * the first item of every list. Made in code, so it cannot leave out a heading
 * or say something the chapter does not; what it leaves out can be read.
 */
export function outlineOf(markdown: string): string {
	const out: string[] = [];
	let fenced = false;
	for (const paragraph of markdown.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
		const lines = paragraph.split('\n').filter((line) => line.trim());
		if (lines.length === 0) continue;
		const fences = lines.filter((line) => /^\s*(```|~~~)/.test(line)).length;
		if (fenced || fences > 0) {
			if (fences % 2 === 1) fenced = !fenced;
			continue;
		}
		const headings = lines.filter((line) => /^#{1,6}\s/.test(line));
		const prose = lines.filter((line) => !/^#{1,6}\s/.test(line));
		out.push(...headings);
		if (prose.length === 0) continue;
		if (LIST_ITEM.test(prose[0])) {
			const items = prose.filter((line) => LIST_ITEM.test(line)).length;
			out.push(items > 1 ? `${prose[0].trim()} (… ${items - 1} more)` : prose[0].trim());
			continue;
		}
		const text = prose.join(' ').replace(/\s+/g, ' ').trim();
		const first = FIRST_SENTENCE.exec(text)?.[1] ?? text.slice(0, 300);
		out.push(first.length < text.length ? `${first} …` : first);
	}
	return out.join('\n');
}

const STOP_WORDS = new Set(
	'that this with from they them their there what when which will have each must into only also more than should would could does been were about after before every other such these those where while your'.split(' ')
);

/** Words worth comparing, crudely stemmed: diacritics gone, cut to six letters, so "bookings" meets "booking". */
function stems(text: string): Set<string> {
	const words = text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
	return new Set(words.map((word) => word.slice(0, 6)));
}

/**
 * How much another chapter bears on the one under discussion.
 *
 * Read from what the chapter under discussion is *for* — its title, goal,
 * purpose and questions — not from what it says now, so the answer does not
 * change from one turn to the next and the system prompt the cache serves stays
 * the same. The Overview comes first, then the chapter's own family: its parent,
 * its sub-chapters, its siblings.
 */
export function relatedness(active: Chapter | null, other: Chapter): number {
	if (other.key === 'overview') return Infinity;
	if (!active) return 0;
	const family =
		other.parent_key === active.key ||
		active.parent_key === other.key ||
		(active.parent_key !== '' && other.parent_key === active.parent_key);
	const wanted = stems([active.title, active.goal, active.purpose, ...active.questions].join(' '));
	const offered = stems([other.title, other.goal, other.purpose, other.content_md].join(' '));
	let shared = 0;
	for (const stem of wanted) if (offered.has(stem)) shared++;
	return (family ? FAMILY : 0) + shared / Math.sqrt(offered.size || 1);
}

/** Relatedness at or above this is the Overview or the chapter's own family. */
const FAMILY = 1_000_000;

/** How much of a chapter the prompt carries. */
export type Shown = 'full' | 'outline' | 'rules' | 'title';
const LESS: Record<Shown, Shown | null> = { full: 'outline', outline: 'rules', rules: 'title', title: null };
const MARK: Record<Shown, string> = { full: '', outline: ' [outline]', rules: ' [rules only]', title: ' [title only]' };

function showChapter(chapter: Chapter, rules: readonly Requirement[], shown: Shown): string {
	const heading = `## ${chapter.title} (key: ${chapter.key})${MARK[shown]}`;
	const written = chapter.content_md.trim();
	if (shown === 'title') return `${heading}\n(${written ? 'written' : 'nothing written yet'}; ${rules.length} rules)`;
	const prose = !written ? '(nothing written yet)' : shown === 'full' ? written : shown === 'outline' ? outlineOf(written) : '';
	return [heading, prose, rules.length ? `Rules:\n${rules.map(ruleLine).join('\n')}` : '']
		.filter(Boolean)
		.join('\n');
}

/**
 * Every chapter that applies, other than the one under discussion, in document
 * order, with its rules — each in full while the whole fits `limit`.
 *
 * Past that, the chapters that bear least on the one under discussion are shown
 * in less detail first: as an outline, then as their rules alone, then as a
 * title. Every rule stays until the last step, because a rule is the precise,
 * checkable part of a chapter. A set-aside chapter is left out: it is not part
 * of what will be built.
 */
export function documentContext(
	chapters: readonly Chapter[],
	requirements: readonly Requirement[],
	active: Chapter | null,
	limit = DOCUMENT_LIMIT
): { text: string; shown: Map<string, Shown> } {
	const others = chapters.filter((c) => c.applicable !== 0 && c.key !== active?.key);
	const rulesOf = new Map(others.map((c) => [c.key, requirements.filter((r) => r.chapter_key === c.key)]));
	const shown = new Map<string, Shown>(others.map((c) => [c.key, 'full']));
	const size = (c: Chapter) => showChapter(c, rulesOf.get(c.key)!, shown.get(c.key)!).length + 2;
	let total = others.reduce((sum, c) => sum + size(c), 0);

	// Least related first; among equals, the later in the document. The Overview
	// and the chapter's own family keep their detail until the rest has been cut
	// to its rules, and their titles until the rest is down to titles.
	const order = others
		.map((c, position) => ({ c, position, weight: relatedness(active, c) }))
		.sort((a, b) => a.weight - b.weight || b.position - a.position);
	const rest = order.filter((e) => e.weight < FAMILY).map((e) => e.c);
	const close = order.filter((e) => e.weight >= FAMILY).map((e) => e.c);
	const steps: Array<[readonly Chapter[], Shown]> = [
		[rest, 'full'],
		[rest, 'outline'],
		[close, 'full'],
		[rest, 'rules'],
		[close, 'outline'],
		[close, 'rules']
	];

	for (const [group, from] of steps) {
		for (const c of group) {
			if (total <= limit) break;
			if (shown.get(c.key) !== from) continue;
			total -= size(c);
			shown.set(c.key, LESS[from]!);
			total += size(c);
		}
	}

	const text = others.map((c) => showChapter(c, rulesOf.get(c.key)!, shown.get(c.key)!)).join('\n\n');
	return { text, shown };
}

/**
 * Lets the model open a chapter it is shown only in part. The arguments are a
 * key and a heading, so nothing long ever rides in the call — see `gateway.ts`.
 */
export const READ_TOOL: ToolDef = {
	name: 'read_chapter',
	description:
		'Read the whole of one chapter of the document, with its rules, or one part of it by heading. ' +
		'Use it when a chapter shown only in outline, or as its rules or title, may bear on what the ' +
		'colleague just said.',
	input_schema: {
		type: 'object',
		properties: {
			key: { type: 'string', description: 'The chapter key, as shown after "key:".' },
			heading: { type: 'string', description: 'Optional: one heading of that chapter, to read only that part.' }
		},
		required: ['key']
	}
};

/** What a read returns: the chapter as it stands now, or why there is nothing to read. */
export function readChapter(
	input: Record<string, unknown>,
	chapters: readonly Chapter[],
	requirements: readonly Requirement[]
): { chapter: Chapter | null; text: string } {
	const asked = String(input.key ?? '').trim().toLowerCase();
	const chapter =
		chapters.find((c) => c.key.toLowerCase() === asked) ??
		chapters.find((c) => c.title.trim().toLowerCase() === asked) ??
		null;
	if (!chapter) {
		return {
			chapter: null,
			text: `No chapter has the key "${asked}". The chapters are: ${chapters.map((c) => c.key).join(', ')}.`
		};
	}
	const heading = String(input.heading ?? '').trim();
	if (heading) {
		const part = chapterParts(chapter.content_md).sections.find((s) => sameHeading(s.heading, heading));
		if (part) return { chapter, text: `## ${chapter.title} (key: ${chapter.key}) — ${part.heading}\n${part.body}` };
		return {
			chapter,
			text: `"${chapter.title}" has no part headed "${heading}". Its headings are: ${
				sectionHeadings(chapter.content_md).join('; ') || '(none)'
			}.`
		};
	}
	return { chapter, text: showChapter(chapter, requirements.filter((r) => r.chapter_key === chapter.key), 'full') };
}

/** One line per chapter: where it stands, with the one under discussion marked. */
export function chapterDigest(chapters: readonly Chapter[], activeKey: string | null): string {
	return chapters
		.filter((c) => c.applicable !== 0)
		.map((c) => {
			const marker = c.key === activeKey ? '>' : ' ';
			const open = c.open_questions.length ? ` — ${c.open_questions.length} open` : '';
			return `${marker} [${c.status}] ${c.key}: ${c.title}${open}`;
		})
		.join('\n');
}

const STANDARDS_NOTE = `Some of the above are marked [company standard]. They are already settled for
every application at Škoda Auto — do not interview the user about them and do
not ask them to confirm them. Mention them only if what the user describes would
break one, and then say which, and ask whether this application really needs to
differ.`;

/**
 * What changes from turn to turn, and the checklist, around the colleague's
 * message. It exists only in the request: the transcript keeps their own words.
 */
export function buildTurnState(args: {
	chapters: readonly Chapter[];
	active: Chapter | null;
	activeRequirements: readonly Requirement[];
	message: string;
}): string {
	const { chapters, active, activeRequirements, message } = args;
	const digest = `Where every chapter stands — background, not a list of things to ask about now:
${chapterDigest(chapters, active?.key ?? null)}`;
	const said = `THE COLLEAGUE'S MESSAGE

${message.trim()}`;

	if (!active) {
		return [`WHERE THE DOCUMENT STANDS NOW (from Specman, not from the colleague)\n\n${digest}`, said].join(
			'\n\n---\n\n'
		);
	}

	const recorded = activeRequirements.length ? activeRequirements.map(ruleLine).join('\n') : '(nothing recorded yet)';
	const standards = activeRequirements.some((r) => r.source === 'standard') ? `\n\n${STANDARDS_NOTE}` : '';

	const written = active.content_md.trim();
	const long = written.length > LONG_CHAPTER;
	const headings = sectionHeadings(written);
	const content = !written
		? '(empty — nothing written yet)'
		: written.length > ACTIVE_LIMIT
			? `${outlineOf(written)}

(This chapter is too long to show here whole: above is its outline. Read the part
you are changing with read_chapter, key "${active.key}" and its heading, first.)`
			: written;
	const parts = long
		? `

Its parts, by heading:
${headings.map((h) => `- ${h}`).join('\n') || '(none — it has no headings yet)'}`
		: '';

	const state = `WHERE THIS CHAPTER STANDS NOW (from Specman, not from the colleague, who does not see it)

The chapter "${active.title}" (key: ${active.key}) is currently "${active.status}".

Already recorded as must-be-true (do not repeat these; change them by reference
if the user contradicts one):
${recorded}${standards}

Current content:
${content}${parts}

Still open:
${active.open_questions.map((q) => `- ${q}`).join('\n') || '(nothing recorded)'}

${digest}`;

	// Last deliberately: this is the rule the model is most likely to drop, and
	// the one whose failure is most visible to the user — it starts interviewing
	// about the next chapter while the index still shows this one.
	const writeItDown = !long
		? `1. WRITE DOWN WHAT THEY JUST TOLD YOU. If the colleague's message above
   contained any fact about this chapter, your reply MUST contain a
   <chapter key="${active.key}"> block carrying the whole chapter, rewritten to
   include it. Nothing is saved from your conversational text — only the blocks
   are kept. A reply that just asks the next question throws their answer away,
   and they will be asked the same thing again.`
		: headings.length === 0
			? `1. WRITE DOWN WHAT THEY JUST TOLD YOU. If the colleague's message above
   contained any fact about this chapter, your reply MUST contain a
   <chapter key="${active.key}"> block carrying the whole chapter, rewritten to
   include it. The chapter is long and has no headings: this once, organise it
   under ## headings as you rewrite it, so that later answers can change one
   part at a time. Nothing is saved from your conversational text — only the
   blocks are kept.`
			: `1. WRITE DOWN WHAT THEY JUST TOLD YOU. If the colleague's message above
   contained any fact about this chapter, your reply MUST record it. The chapter
   is long, so do NOT rewrite it whole: write only the parts that change, each
   as its own block —

       <section chapter="${active.key}" heading="${headings[0]}">
       the whole new text of that part, without its heading
       </section>

   - heading is one of the parts listed above, exactly as written, to replace
     that part; or a new heading, to add a part at the end of the chapter.
   - heading="" is the text before the first heading.
   - Everything you do not send stays exactly as it is.
   Nothing is saved from your conversational text — only the blocks are kept.`;

	const checklist = `CHECK ALL OF THIS BEFORE YOU REPLY

${writeItDown}

2. Record anything now settled as a <requirement>, and anything you decided on
   their behalf as a <decision source="agent">.

3. If what they told you contradicts another chapter of the document, correct
   that chapter in the same reply — a <chapter> block carrying its key, or for a
   long chapter <section chapter="its key" heading="the part's heading"> with
   that part's new text — and say in your
   reply which chapter you changed and what it said before. If it is shown here
   only in part, read it first. If you cannot tell which of the two they mean
   to hold, ask instead.

4. Every other question you ask must be about "${active.title}" and nothing
   else. Never write "let's move on to ...", "now let's talk about ..." or "I'm
   moving this conversation to ...". Switching chapters is the user's to do, by
   clicking the index.

5. If this chapter is finished, your ENTIRE reply is one sentence saying so.
   Ask nothing, and do not suggest another chapter — the application offers the
   next one itself, and a question here keeps this chapter from completing.

Write the blocks first, then your short reply. A status of "complete" is not
final — new information reopens the chapter.`;

	return [state, said, checklist].join('\n\n---\n\n');
}

/**
 * Other chapters a reply names by title without writing them.
 *
 * Seen on the live gateway: told that an answer contradicted another chapter,
 * the model once replied "I changed Users and roles, What the application does
 * and Security" and wrote no block at all, so nothing changed and the colleague
 * was told it had. Naming a chapter is not always claiming to have changed it,
 * so this only says which chapters to ask about; `REPAIR` asks.
 */
export function unwrittenMentions(
	reply: string,
	chapters: readonly Chapter[],
	writtenKeys: readonly string[],
	activeKey: string | null
): Chapter[] {
	const said = reply.toLowerCase();
	return chapters.filter(
		(c) =>
			c.applicable !== 0 &&
			c.key !== activeKey &&
			!writtenKeys.includes(c.key) &&
			c.title.trim().length > 3 &&
			said.includes(c.title.trim().toLowerCase())
	);
}

/** The follow-up for a reply that named chapters it did not write. */
export function repairRequest(named: readonly Chapter[]): string {
	const list = named.map((c) => `- "${c.title}" (key: ${c.key})`).join('\n');
	return `FROM SPECMAN, NOT FROM THE COLLEAGUE

Your reply names these chapters, but carried no <chapter> block for them:
${list}

If your reply says you changed or corrected any of them, that change was NOT
saved — only blocks are kept. Send it now: a <chapter> block with the chapter's
key carrying the whole chapter rewritten, or, for a long chapter, a
<section chapter="…" heading="…"> block for each part that changes. Send
nothing else: no reply, no explanation.

If your reply did not say you changed them, send nothing at all.`;
}

/**
 * The conversation as sent: the same turns, with the last one — the
 * colleague's message, possibly joined to one an earlier failure left
 * unanswered — replaced by `lastTurn`.
 */
export function withLastTurn(conversation: readonly ChatMessage[], lastTurn: string): ChatMessage[] {
	const sent = conversation.map((m) => ({ ...m }));
	const last = sent.at(-1);
	if (last?.role === 'user') last.content = lastTurn;
	else sent.push({ role: 'user', content: lastTurn });
	return sent;
}

// --- Sections -------------------------------------------------------------------
//
// One part of a long chapter, rewritten on its own. A reply that records an
// answer used to rewrite the whole chapter: for a long chapter that is a minute
// of writing, much of a turn's budget, and a rewrite in which a paragraph nobody
// discussed can go missing. Past `LONG_CHAPTER` the model is asked for
// `<section chapter="…" heading="…">` blocks instead, and each is put into the
// chapter here, by its heading, in code.
//
// A chapter's sections are the parts under its shallowest heading level; deeper
// headings belong to the section they sit in. Text before the first heading is
// the section with no heading.

/**
 * Past this many characters — about five hundred words — a chapter is edited by
 * section. Low on purpose: a whole rewrite is where the model condenses what
 * nobody discussed. Live on 2026-10-03, a chapter edited by section changed a few
 * lines a turn; the turn it fell under the first threshold of 6 000 and was
 * rewritten whole, it went from 5 500 characters to 1 400.
 */
export const LONG_CHAPTER = 3_000;

export interface ChapterParts {
	/** The heading level the chapter is divided at; 2 when it has no headings yet. */
	level: number;
	/** Text before the first heading. */
	preamble: string;
	sections: Array<{ heading: string; body: string }>;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;
const FENCE = /^\s*(```|~~~)/;

/** Headings outside code fences, with the line each is on. */
function headingLines(lines: readonly string[]): Array<{ line: number; level: number; text: string }> {
	const found: Array<{ line: number; level: number; text: string }> = [];
	let fenced = false;
	lines.forEach((line, index) => {
		if (FENCE.test(line)) fenced = !fenced;
		const match = fenced ? null : HEADING.exec(line);
		if (match) found.push({ line: index, level: match[1].length, text: match[2].trim() });
	});
	return found;
}

/** The lines a chapter is cut at: its headings of the shallowest level. */
function cutsOf(lines: readonly string[]): { level: number; cuts: Array<{ line: number; text: string }> } {
	const all = headingLines(lines);
	const level = all.length ? Math.min(...all.map((h) => h.level)) : 2;
	return { level, cuts: all.filter((h) => h.level === level) };
}

export function chapterParts(markdown: string): ChapterParts {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const { level, cuts } = cutsOf(lines);
	if (cuts.length === 0) return { level, preamble: markdown.trim(), sections: [] };
	return {
		level,
		preamble: lines.slice(0, cuts[0].line).join('\n').trim(),
		sections: cuts.map((cut, i) => ({
			heading: cut.text,
			body: lines.slice(cut.line + 1, cuts[i + 1]?.line ?? lines.length).join('\n').trim()
		}))
	};
}

/** The headings a section block may name, in order. */
export function sectionHeadings(markdown: string): string[] {
	return chapterParts(markdown).sections.map((s) => s.heading);
}

/** Headings compared as a reader would: case, emphasis, numbering and end punctuation aside. */
export function sameHeading(a: string, b: string): boolean {
	const plain = (text: string) =>
		text
			.toLowerCase()
			.replace(/[*_`]/g, '')
			.replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '')
			.replace(/[\s.:;!?]+$/, '')
			.replace(/\s+/g, ' ')
			.trim();
	return plain(a) === plain(b);
}

export type SectionOutcome = 'replaced' | 'added' | 'removed' | 'unchanged';

/**
 * The chapter with one section replaced, added at the end, or removed.
 *
 * Only the lines of that section change: every other part is kept exactly as it
 * was written, so the change a reviewer sees is the change that was made.
 *
 * An empty body changes nothing, as an empty chapter block does: nobody means to
 * erase part of a chapter by writing nothing into it. A body that repeats the
 * section's own heading on its first line has it taken off, rather than shown
 * twice.
 */
export function mergeSection(
	markdown: string,
	heading: string,
	body: string,
	remove = false
): { markdown: string; outcome: SectionOutcome } {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const { level, cuts } = cutsOf(lines);

	const name = heading.replace(/^#+\s*/, '').trim();
	const firstLine = body.trimStart().split('\n');
	const repeated = HEADING.exec(firstLine[0] ?? '');
	const text = (repeated && name && sameHeading(repeated[2], name) ? firstLine.slice(1).join('\n') : body).trim();
	const at = name ? cuts.findIndex((cut) => sameHeading(cut.text, name)) : -1;
	const end = (i: number) => cuts[i + 1]?.line ?? lines.length;
	const joined = (pieces: string[][]) =>
		pieces
			.map((piece) => piece.join('\n').trim())
			.filter(Boolean)
			.join('\n\n');

	if (remove) {
		if (at < 0) return { markdown, outcome: 'unchanged' };
		return { markdown: joined([lines.slice(0, cuts[at].line), lines.slice(end(at))]), outcome: 'removed' };
	}
	if (!text) return { markdown, outcome: 'unchanged' };
	if (!name) {
		return { markdown: joined([[text], lines.slice(cuts[0]?.line ?? lines.length)]), outcome: 'replaced' };
	}
	if (at >= 0) {
		return {
			markdown: joined([lines.slice(0, cuts[at].line + 1), [text], lines.slice(end(at))]),
			outcome: 'replaced'
		};
	}
	return { markdown: joined([lines, [`${'#'.repeat(level)} ${name}`, '', text]]), outcome: 'added' };
}
