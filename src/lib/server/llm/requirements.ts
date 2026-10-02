/**
 * Requirements: the checkable part of a chapter.
 *
 * A chapter's prose says what the application is for. A requirement says what
 * must always be true, with at least one concrete scenario showing it. That is
 * the part a developer — or a coding agent — can actually build and verify
 * against, and the part a later coherence pass can check for contradictions.
 *
 * The agent writes them inside `<requirement>` blocks in the streamed reply, for
 * the same reason chapter prose is streamed: long text in a tool argument is a
 * hard 400 on this gateway. See the header of `gateway.ts`.
 *
 * Users never see the `WHEN`/`THEN` markers — those are storage, and the UI
 * renders them as "If … then …".
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

/** now = build it; later = agreed but not yet; out = explicitly not doing. */
export type Scope = 'now' | 'later' | 'out';

export interface Scenario {
	when: string;
	then: string;
}

export interface RequirementDraft {
	/** Null for a new requirement — the server assigns the ref, never the model. */
	ref: string | null;
	/** Null means "the chapter currently in focus". */
	chapterKey: string | null;
	scope: Scope;
	statement: string;
	scenarios: Scenario[];
	remove: boolean;
	/** True when this describes how the application already behaves today. */
	existing: boolean;
}

// Forgiving: the models decorate markers with list bullets, bold, and colons,
// and close the bold on either side of the colon ("**WHEN:**" or "**WHEN**:").
// The \b matters — without it "WHENEVER" would be read as a marker.
const WHEN_MARKER = /^(?:[-*•]\s*)?\**\s*WHEN\b\**\s*:?\s*\**\s*/i;
const THEN_MARKER = /^(?:[-*•]\s*)?\**\s*THEN\b\**\s*:?\s*\**\s*/i;
const LIST_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s*/;

export function normaliseScope(raw: string | undefined): Scope {
	const value = (raw ?? '').trim().toLowerCase();
	if (['later', 'v2', 'future', 'next'].includes(value)) return 'later';
	if (['out', 'never', 'no', 'out-of-scope', 'not-doing', 'excluded'].includes(value)) return 'out';
	return 'now';
}

/**
 * Split a requirement body into its statement and scenarios.
 *
 * A body with no recognisable scenario still yields the statement: dropping the
 * agent's work because it formatted the markers badly would lose real content.
 * `validateDocument` flags the missing scenario instead.
 */
export function parseRequirementBody(body: string): { statement: string; scenarios: Scenario[] } {
	const statementLines: string[] = [];
	const scenarios: Scenario[] = [];

	let current: { when: string[]; then: string[] } | null = null;
	let mode: 'statement' | 'when' | 'then' = 'statement';

	const flush = () => {
		if (!current) return;
		const when = current.when.join(' ').trim();
		const then = current.then.join(' ').trim();
		if (when && then) scenarios.push({ when, then });
		current = null;
	};

	for (const raw of body.split('\n')) {
		const line = raw.trim();
		if (!line) continue;

		const when = WHEN_MARKER.exec(line);
		if (when) {
			flush();
			current = { when: [line.slice(when[0].length).trim()], then: [] };
			mode = 'when';
			continue;
		}

		const then = THEN_MARKER.exec(line);
		if (then) {
			const text = line.slice(then[0].length).trim();
			// A THEN with no WHEN is malformed; keep the words rather than lose them.
			if (current) {
				current.then.push(text);
				mode = 'then';
			} else {
				statementLines.push(text);
			}
			continue;
		}

		// Anything else continues whatever was last opened — this is how "AND …"
		// continuation lines end up attached to the right half of the scenario.
		if (mode === 'when' && current) current.when.push(line.replace(LIST_PREFIX, ''));
		else if (mode === 'then' && current) current.then.push(line.replace(LIST_PREFIX, ''));
		else statementLines.push(line.replace(LIST_PREFIX, ''));
	}

	flush();

	return { statement: statementLines.join(' ').trim(), scenarios };
}

/** Build a draft from a parsed `<requirement>` block. */
export function toRequirementDraft(
	attrs: Record<string, string>,
	body: string
): RequirementDraft | null {
	// Refs are stored as `REQ-004`; `req-004` names the same one.
	const ref = attrs.ref?.trim().toUpperCase() || null;
	const remove = (attrs.action ?? '').trim().toLowerCase() === 'remove';

	// Removing needs only a ref; anything else needs words.
	if (remove) {
		return ref
			? {
					ref,
					chapterKey: null,
					scope: 'now',
					statement: '',
					scenarios: [],
					remove: true,
					existing: false
				}
			: null;
	}

	const { statement, scenarios } = parseRequirementBody(body);
	if (statement.length < 8) return null;

	return {
		ref,
		chapterKey: attrs.chapter?.trim().toLowerCase() || null,
		scope: normaliseScope(attrs.scope),
		statement,
		scenarios,
		remove: false,
		existing: /^(true|yes|1)$/i.test((attrs.existing ?? '').trim())
	};
}

/**
 * True when two statements are the same rule written the same way.
 *
 * The model restates rules as it rewrites a chapter, and does not always carry
 * the reference with it. Without one, every restatement was a new requirement,
 * and the chapter collected copies of itself. Only wording that matches once
 * case, spacing and the closing full stop are set aside counts: anything looser
 * would merge two rules that differ in the one word that matters.
 */
export function sameStatement(a: string, b: string): boolean {
	const plain = (text: string) =>
		text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!。]+$/u, '');
	return plain(a) !== '' && plain(a) === plain(b);
}

/**
 * Scenarios as a person writes them: one to a line, "If …, then …".
 *
 * The same sentence the interface shows, so a standard's examples are edited in
 * the words they are read in and the storage markers stay out of the form. The
 * first "then" divides the line; a list bullet and the closing full stop are
 * set aside.
 */
const PLAIN_SCENARIO = /^(?:[-*•]\s*)?if\s+(.+?),?\s+then\s+(.+?)\s*\.?$/i;

export function scenarioLines(scenarios: Scenario[]): string {
	return scenarios.map((s) => `If ${s.when}, then ${s.then.replace(/\.\s*$/, '')}.`).join('\n');
}

/** Every line read, or the lines that could not be — never half of them. */
export function readScenarioLines(text: string): { scenarios: Scenario[] } | { unreadable: string[] } {
	const scenarios: Scenario[] = [];
	const unreadable: string[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const match = PLAIN_SCENARIO.exec(line);
		if (match && match[1].trim() && match[2].trim()) {
			scenarios.push({ when: match[1].trim(), then: match[2].trim() });
		} else {
			unreadable.push(line);
		}
	}
	return unreadable.length > 0 ? { unreadable } : { scenarios };
}

/**
 * The next reference for a project.
 *
 * Refs are sequential per project rather than per chapter: a chapter-derived
 * prefix looks tidier but collides (`data` and `data-classification`) and breaks
 * if a chapter is ever renamed — which would silently sever the traceability
 * that verification and change review depend on.
 */
export function nextRef(existing: Iterable<string>): string {
	let highest = 0;
	for (const ref of existing) {
		const match = /^REQ-(\d+)$/i.exec((ref ?? '').trim());
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return `REQ-${String(highest + 1).padStart(3, '0')}`;
}
