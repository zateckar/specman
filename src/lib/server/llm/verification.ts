import { gateway } from './gateway';
import { ChapterStreamParser } from './blocks';
import { mapWithLimit } from './parallel';
import { mergeIssues, toIssue, type Issue } from './issues';
import { unconfirmed } from './decisions';
import type { Chapter, Decision, Requirement } from '../db/types';

/**
 * Checking the document as a whole.
 *
 * Two things the per-turn flow cannot do. It sees one chapter at a time, so it
 * cannot notice that Security and Authorization disagree; and it judges what was
 * just said, so it cannot notice that something settled four chapters ago was
 * never actually written down.
 *
 * Structured as one call per chapter plus a single cross-document pass, run a
 * few at a time — see `parallel.ts` for why the whole document is not sent in
 * one request. Findings come back as streamed `<finding>` blocks rather than
 * tool arguments, for the reason in the header of `gateway.ts`.
 *
 * Everything here is advisory. A failed check returns nothing and says so; it
 * never blocks the user from saving their own work.
 */

const CONCURRENCY = 3;

const FORMAT = `Report each problem as its own block, and write nothing else:

<finding kind="contradiction" chapters="functionality,security" refs="REQ-004,REQ-012">
Two rules disagree about whether a booking can be changed on the day of the trip.
</finding>

kind is one of:
  contradiction — two parts of the document cannot both be true
  missing       — something was settled in conversation but never written down
  drift         — a part no longer matches what the application is said to be for
  unclear       — too vague for someone to build from without guessing

Write each message as one sentence a non-technical person would understand, and
name what is wrong rather than restating the document. If nothing is wrong,
reply with nothing at all. Do not invent problems to look thorough.`;

async function collectFindings(system: string, prompt: string): Promise<Issue[]> {
	try {
		let text = '';
		for await (const event of gateway.streamChat({
			system,
			messages: [{ role: 'user', content: prompt }],
			// The served model reasons before writing, and thinking tokens come out
			// of the same budget — too small a ceiling yields an empty answer.
			maxTokens: 3000
		})) {
			if (event.type === 'text') text += event.text;
		}

		const parser = new ChapterStreamParser();
		parser.push(text);
		parser.end();

		return parser
			.blocksOf('finding')
			.map((block) => toIssue(block.attrs, block.body))
			.filter((issue): issue is Issue => issue !== null);
	} catch (error) {
		// One unlucky call must not lose the other eleven.
		console.warn('[verify] a check failed:', error);
		return [];
	}
}

function describeRequirements(requirements: Requirement[]): string {
	if (requirements.length === 0) return '(none recorded)';
	return requirements
		.map((r) => {
			const scenarios = r.scenarios
				.map((s) => `\n    if ${s.when}, then ${s.then}`)
				.join('');
			return `- ${r.ref} [${r.scope}] ${r.statement}${scenarios}`;
		})
		.join('\n');
}

/** One chapter against its own criteria and the decisions taken in it. */
async function checkChapter(args: {
	chapter: Chapter;
	requirements: Requirement[];
	decisions: Decision[];
}): Promise<Issue[]> {
	const { chapter, requirements, decisions } = args;

	// Nothing written, nothing to check — and no call to pay for.
	if (!chapter.content_md.trim() && requirements.length === 0) return [];

	const system = `You are checking one chapter of an application design document for
problems. Be strict but fair, and silent when it is sound.

${FORMAT}

Use chapters="${chapter.key}" on every finding.`;

	const prompt = `Chapter: ${chapter.title}
What it is for: ${chapter.goal || '(not stated)'}

It counts as finished when all of these hold:
${chapter.criteria.map((c) => `- ${c}`).join('\n') || '- (none defined)'}

What the chapter says:
${chapter.content_md || '(nothing written)'}

What it says must always be true:
${describeRequirements(requirements)}

Decisions recorded against it:
${decisions.map((d) => `- ${d.statement}${d.rationale ? ` (because ${d.rationale})` : ''}`).join('\n') || '- (none)'}

Check three things. Is anything here in conflict with something else here? Is
any decision listed above absent from the text and the rules — settled in
conversation but never actually written down? Is anything too vague to build
from without guessing?`;

	return collectFindings(system, prompt);
}

/**
 * The whole document at once — but only the *statements*.
 *
 * This is the call that catches Security contradicting Authorization, which no
 * per-chapter check can see. Sending statements rather than full prose keeps it
 * comfortably small whatever backend serves it.
 */
async function checkAcrossChapters(args: {
	chapters: Chapter[];
	requirements: Requirement[];
}): Promise<Issue[]> {
	const { chapters, requirements } = args;
	if (requirements.length < 2) return [];

	const overview = chapters.find((c) => c.key === 'overview');

	const system = `You are checking whether an application design document agrees with
itself across its chapters. You are looking for two things only: rules in
different chapters that cannot both be true, and parts that no longer match what
the application is said to be for.

Do not comment on anything missing or vague — other checks cover that.

${FORMAT}`;

	const byChapter = chapters
		.map((chapter) => {
			const own = requirements.filter((r) => r.chapter_key === chapter.key);
			if (own.length === 0) return '';
			return `${chapter.title} (${chapter.key})\n${own
				.map((r) => `  ${r.ref} [${r.scope}] ${r.statement}`)
				.join('\n')}`;
		})
		.filter(Boolean)
		.join('\n\n');

	const prompt = `What the application is for:
${overview?.content_md || '(not written yet)'}

Everything the document says must be true:

${byChapter}`;

	return collectFindings(system, prompt);
}

export interface VerificationResult {
	issues: Issue[];
	/** Chapters that were checked, for reporting what the run covered. */
	checked: string[];
	/** True when at least one chapter had unconfirmed assumptions. */
	assumptionsOutstanding: number;
}

export async function verifyDocument(args: {
	chapters: Chapter[];
	requirements: Requirement[];
	decisions: Decision[];
}): Promise<VerificationResult> {
	const { chapters, requirements, decisions } = args;

	// A chapter set aside by the triage was never in scope, so it is not a gap.
	const inScope = chapters.filter((c) => c.applicable !== 0);
	const worthChecking = inScope.filter(
		(c) => c.content_md.trim() || requirements.some((r) => r.chapter_key === c.key)
	);

	const perChapter = await mapWithLimit(worthChecking, CONCURRENCY, (chapter) =>
		checkChapter({
			chapter,
			requirements: requirements.filter((r) => r.chapter_key === chapter.key),
			decisions: decisions.filter((d) => d.chapter_key === chapter.key)
		})
	);

	const across = await checkAcrossChapters({ chapters: inScope, requirements });

	return {
		issues: mergeIssues([...perChapter.flat(), ...across]),
		checked: worthChecking.map((c) => c.key),
		assumptionsOutstanding: unconfirmed(decisions).length
	};
}
