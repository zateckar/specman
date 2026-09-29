/**
 * Decisions, and who made them.
 *
 * The agent is told that when the user says "you decide", it should propose a
 * sensible default and record it. That is the right behaviour — a non-technical
 * user should not be forced to have an opinion about session lengths — but it
 * means part of the finished document was decided by a machine.
 *
 * So every decision carries its source, and an agent-made one is `proposed`
 * until the user confirms it. Nothing else in the document distinguishes a
 * choice the user made from one made on their behalf, and they must be able to
 * tell the difference before anyone builds from it.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type DecisionSource = 'user' | 'agent' | 'standard';

export interface DecisionDraft {
	chapterKey: string | null;
	statement: string;
	rationale: string;
	source: DecisionSource;
}

// Asterisks may close before or after the colon — "**Why:**" and "**Why**:" are
// both common — so allow them on either side rather than in one fixed place.
const WHY_MARKER = /^(?:[-*•]\s*)?\**\s*why\b\**\s*[:—-]\s*\**\s*/i;
const LIST_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s*/;

/**
 * Who made this call.
 *
 * Anything unrecognised becomes `agent`. That is the safe direction: an
 * agent decision is surfaced for confirmation, so mislabelling one as the
 * user's would silently attribute a machine's choice to a person, while the
 * reverse merely asks them to confirm something they already said.
 */
export function normaliseSource(raw: string | undefined): DecisionSource {
	const value = (raw ?? '').trim().toLowerCase();
	if (value === 'user') return 'user';
	if (value === 'standard') return 'standard';
	return 'agent';
}

export function toDecisionDraft(
	attrs: Record<string, string>,
	body: string
): DecisionDraft | null {
	const statementLines: string[] = [];
	const rationaleLines: string[] = [];
	let inRationale = false;

	for (const raw of body.split('\n')) {
		const line = raw.trim();
		if (!line) continue;

		const why = WHY_MARKER.exec(line);
		if (why) {
			inRationale = true;
			rationaleLines.push(line.slice(why[0].length).trim());
			continue;
		}

		if (inRationale) rationaleLines.push(line.replace(LIST_PREFIX, ''));
		else statementLines.push(line.replace(LIST_PREFIX, ''));
	}

	const statement = statementLines.join(' ').trim();
	if (statement.length < 8) return null;

	return {
		chapterKey: attrs.chapter?.trim().toLowerCase() || null,
		statement,
		rationale: rationaleLines.join(' ').trim(),
		source: normaliseSource(attrs.source)
	};
}

/** Decisions the user has not yet agreed to. These block a document being called finished. */
export function unconfirmed<T extends { source: string; status: string }>(decisions: T[]): T[] {
	return decisions.filter((d) => d.source !== 'user' && d.status !== 'confirmed');
}

/**
 * The status to show for a chapter, given how many of its decisions are still
 * unconfirmed.
 *
 * A chapter resting on unreviewed assumptions is not finished: the assessor
 * judges the chapter text, which reads perfectly well when the assistant has
 * answered its own questions sensibly, so left alone it reports progress the
 * user never agreed to.
 *
 * Derived rather than stored. Writing the downgrade into the database would
 * leave it stale the moment the user confirms — the status would stay wrong
 * until the next conversation turn happened to reassess the chapter.
 */
export function effectiveStatus(storedStatus: string, pendingDecisions: number): string {
	return storedStatus === 'complete' && pendingDecisions > 0 ? 'in_progress' : storedStatus;
}

/** Pending decisions per chapter key, for deriving status in bulk. */
export function pendingByChapter<T extends { chapter_key: string; source: string; status: string }>(
	decisions: T[]
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const decision of unconfirmed(decisions)) {
		counts.set(decision.chapter_key, (counts.get(decision.chapter_key) ?? 0) + 1);
	}
	return counts;
}
