/**
 * Reconciling the two calls that make up an agent turn.
 *
 * A turn is a prose call and an assessment call (see the header of `agent.ts`),
 * and they are independent judgements. The assessor reads the chapter text, so
 * it cannot see that the prose call left a question hanging — left alone it
 * marks the chapter complete with an unanswered question still on screen. The
 * next turn then reads that state, believes the chapter is finished, and starts
 * interviewing the user about a different chapter.
 *
 * These functions enforce the invariant the two calls can otherwise break:
 * a chapter is complete exactly when nothing is left to ask.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface Assessment {
	status: string;
	openQuestions: string[];
}

export interface AnswerOption {
	label: string;
	recommended: boolean;
}

const LIST_PREFIX = /^\s*(?:[-*•—]|\d+[.)])\s*/;
const RECOMMENDED_MARKER = /\[\s*recommended\s*\]/i;
const MAX_OPTIONS = 4;

/**
 * Answers the agent offered, from the body of an `<options>` block.
 *
 * The format is one answer per line, with `[recommended]` on the one the agent
 * would advise — deliberately forgiving, because the backend models format
 * loosely and a malformed block should cost the user nothing. Anything that
 * cannot be read as a clean set is dropped: no options is a fine outcome, a
 * confusing set is not.
 */
export function parseOptions(raw: string): AnswerOption[] {
	const seen = new Set<string>();
	const options: AnswerOption[] = [];

	for (const line of raw.split('\n')) {
		const recommended = RECOMMENDED_MARKER.test(line);
		const label = line
			.replace(RECOMMENDED_MARKER, '')
			.replace(LIST_PREFIX, '')
			.replace(/[\s—–-]+$/, '')
			.trim();

		// A blank line, a bare list marker, or a whole sentence of prose. A single
		// character is kept: "1" or "7" is a real answer to "how many days?".
		if (!label || label.length > 120) continue;

		const key = label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		options.push({ label, recommended });
		if (options.length === MAX_OPTIONS) break;
	}

	// A single option is not a choice, it is a leading question.
	if (options.length < 2) return [];

	// Exactly one recommendation: the agent's advice should be unambiguous.
	const first = options.findIndex((o) => o.recommended);
	return options.map((o, i) => ({ ...o, recommended: i === (first === -1 ? 0 : first) }));
}

/** True when a full stop closes an abbreviation rather than a sentence. */
function isAbbreviation(before: string): boolean {
	// "e.g.", "i.e.", "z. B.", an initial — cutting at one of these would slice a
	// question in half. Only a SINGLE trailing letter counts: two-letter words are
	// ordinary words ("to", "it", "so"), and treating those as abbreviations
	// swallows the whole sentence before the question.
	return /(?:\s|^)[("[]?(?:\p{L}\.)+\p{L}$/u.test(before) || /(?:\s|^)\p{L}$/u.test(before);
}

/** Drop complete sentences preceding the question, keeping the question itself. */
function trimLeadIn(text: string): string {
	for (let i = text.length - 2; i > 0; i--) {
		const ch = text[i];
		if (ch !== '.' && ch !== '!') continue;
		if (!/\s/.test(text[i + 1])) continue;
		if (isAbbreviation(text.slice(0, i))) continue;
		return text.slice(i + 1).trim();
	}
	return text.trim();
}

/**
 * The questions the agent put to the user in its reply.
 *
 * `?` is the question mark in every language the agent writes in, so this stays
 * language-agnostic.
 */
export function questionsInReply(reply: string): string[] {
	const found: string[] = [];

	for (const rawLine of reply.split('\n')) {
		let rest = rawLine.replace(LIST_PREFIX, '').trim();
		if (!rest.includes('?')) continue;

		// One line can hold lead-in prose and more than one question.
		for (let mark = rest.indexOf('?'); mark !== -1; mark = rest.indexOf('?')) {
			found.push(trimLeadIn(rest.slice(0, mark + 1)));
			rest = rest.slice(mark + 1);
		}
	}

	return found.filter((q) => q.length > 3).slice(0, 6);
}

/**
 * Reconcile the assessor's verdict with what the agent actually said.
 *
 * The assessor's own wording wins when it supplies questions; the reply is the
 * fallback, so a hanging question is never silently dropped.
 */
export function reconcileAssessment(
	assessment: Assessment | null,
	reply: string
): Assessment | null {
	const asked = questionsInReply(reply);

	if (!assessment) {
		return asked.length ? { status: 'in_progress', openQuestions: asked } : null;
	}

	const openQuestions = assessment.openQuestions.length ? assessment.openQuestions : asked;
	const status =
		openQuestions.length > 0 && assessment.status === 'complete'
			? 'in_progress'
			: assessment.status;

	return { status, openQuestions };
}
