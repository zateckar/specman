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
	const ref = attrs.ref?.trim() || null;
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
