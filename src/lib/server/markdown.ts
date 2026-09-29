/**
 * Removes a chapter-level heading the model emitted anyway, so the chapter
 * title is not rendered twice (once from the document structure, once from the
 * model's own markdown).
 *
 * Only the first line is considered, and only when it is a level 1–2 heading
 * matching the chapter title — sub-headings within a chapter are left alone.
 *
 * Applied both when saving and when writing to git, so the invariant holds even
 * for content written before the rule existed.
 */
export function stripChapterHeading(markdown: string, title: string): string {
	const text = (markdown ?? '').trim();
	const match = text.match(/^(#{1,2})\s+(.+?)\s*(?:\n|$)/);
	if (!match) return text;

	const simplify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
	if (simplify(match[2]) === simplify(title)) {
		return text.slice(match[0].length).trim();
	}
	return text;
}
