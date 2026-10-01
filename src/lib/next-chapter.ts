/**
 * Where to go once a chapter is finished.
 *
 * The agent used to suggest it, and a suggestion is phrased as a question —
 * "shall we look at Users and roles next?" — which was then filed as this
 * chapter's open question and kept the chapter from ever completing. Choosing
 * the next chapter is a rule, not a judgement, so the application does it.
 *
 * Runs in the browser so it follows statuses as they stream in. Deliberately
 * free of imports so `npm test` can load it directly.
 */

export interface ChapterStep {
	key: string;
	title: string;
	status: string;
	applicable?: boolean;
	parent_key?: string;
}

/**
 * The first unfinished chapter after the active one, in reading order, wrapping
 * round to the start. Null when nothing is left.
 *
 * A split chapter is skipped because its work is in its sections, the same rule
 * the progress count uses — see `countableChapters` in llm/subchapters.ts.
 */
export function nextChapter<T extends ChapterStep>(chapters: T[], activeKey: string | null): T | null {
	const parents = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
	const at = chapters.findIndex((c) => c.key === activeKey);
	const ordered = [...chapters.slice(at + 1), ...chapters.slice(0, Math.max(at, 0))];

	return (
		ordered.find(
			(c) => c.applicable !== false && !parents.has(c.key) && c.status !== 'complete'
		) ?? null
	);
}
