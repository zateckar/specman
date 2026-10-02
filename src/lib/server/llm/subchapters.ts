/**
 * Sub-chapters: letting the agent split a large chapter up.
 *
 * "What the application does" is the chapter that grows. Once it covers six
 * distinct capabilities it becomes a wall of prose nobody can navigate, and the
 * agent starts rewriting the whole thing every turn just to add a sentence.
 *
 * So the agent proposes the arrangement declaratively — the complete set of
 * sub-chapters, in the order it wants them — and the server reconciles that
 * against what exists. Declarative rather than incremental because a model that
 * issues "add this, move that" instructions gets the order wrong, and because
 * the whole plan can then be checked before anything is written.
 *
 * The one rule that matters: **reconciliation never destroys written work.** A
 * sub-chapter the agent forgot to mention is kept, not deleted. Only an empty one
 * can be removed.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface PlannedSection {
	key: string;
	title: string;
}

export interface ExistingSection {
	key: string;
	title: string;
	position: number;
	/** True when anything would be lost by removing it. */
	hasContent: boolean;
}

export type SectionOp =
	| { kind: 'create'; key: string; title: string; position: number }
	| { kind: 'rename'; key: string; title: string }
	| { kind: 'move'; key: string; position: number }
	| { kind: 'remove'; key: string };

const MAX_SECTIONS = 12;

/** `booking-a-car` from `Booking a car`, or from a key the model half-invented. */
export function toKey(raw: string): string {
	return raw
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}

/**
 * Read a `<subchapters>` block: one `key: Title` per line.
 *
 * A missing key is derived from the title. That is a fallback, not the intent —
 * keys are identity, and a key derived from a title changes when the title is
 * reworded, which would orphan the chapter's content.
 */
export function parseSectionPlan(body: string): PlannedSection[] {
	const sections: PlannedSection[] = [];
	const seen = new Set<string>();

	for (const raw of body.split('\n')) {
		const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
		if (!line) continue;

		const split = line.indexOf(':');
		const key = toKey(split > 0 ? line.slice(0, split) : line);
		const title = (split > 0 ? line.slice(split + 1) : line).trim();

		if (!key || title.length < 2 || title.length > 80) continue;
		if (seen.has(key)) continue;

		seen.add(key);
		sections.push({ key, title });
		if (sections.length === MAX_SECTIONS) break;
	}

	return sections;
}

/**
 * Keep a plan's keys clear of every chapter that is not one of this parent's sections.
 *
 * A chapter's key is unique across the whole document, and the model names
 * sections by what they hold — `data`, `integration`, or the parent's own key —
 * which are often chapters already. Such a key used to reach the database as a
 * new row, hit the uniqueness rule and roll back the whole reply, and asking
 * again failed the same way. Prefixed with the parent it is unique, and the same
 * plan maps to the same keys next time, so the section it created is found again
 * rather than created twice.
 */
export function claimSectionKeys(
	planned: PlannedSection[],
	parentKey: string,
	taken: Iterable<string>
): PlannedSection[] {
	const used = new Set(taken);
	const claimed: PlannedSection[] = [];

	for (const section of planned) {
		let key = section.key;
		if (used.has(key)) {
			const base = `${parentKey}-${section.key}`.slice(0, 76).replace(/-+$/, '');
			key = base;
			for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
		}
		used.add(key);
		claimed.push({ key, title: section.title });
	}

	return claimed;
}

/**
 * Work out what to change.
 *
 * Anything the plan omits keeps its content and is appended after the planned
 * sections, in the order it already had. Only an empty omitted section is
 * removed — a badly-named early attempt should not have to live forever, but
 * nothing the user contributed is ever thrown away on a model's say-so.
 */
export function reconcileSections(
	existing: ExistingSection[],
	planned: PlannedSection[]
): SectionOp[] {
	if (planned.length === 0) return [];

	const byKey = new Map(existing.map((section) => [section.key, section]));
	const plannedKeys = new Set(planned.map((section) => section.key));
	const ops: SectionOp[] = [];

	planned.forEach((section, index) => {
		const current = byKey.get(section.key);

		if (!current) {
			ops.push({ kind: 'create', key: section.key, title: section.title, position: index });
			return;
		}

		if (current.title !== section.title) {
			ops.push({ kind: 'rename', key: section.key, title: section.title });
		}
		if (current.position !== index) {
			ops.push({ kind: 'move', key: section.key, position: index });
		}
	});

	// Sections the plan left out. Written ones follow the plan; empty ones go.
	let tail = planned.length;
	for (const section of existing.filter((s) => !plannedKeys.has(s.key)).sort((a, b) => a.position - b.position)) {
		if (!section.hasContent) {
			ops.push({ kind: 'remove', key: section.key });
			continue;
		}
		if (section.position !== tail) ops.push({ kind: 'move', key: section.key, position: tail });
		tail += 1;
	}

	return ops;
}

/**
 * Display order: each top-level chapter followed by its own sub-chapters.
 *
 * Sub-chapter positions are relative to their parent, so a parent can be moved
 * without renumbering anything beneath it.
 */
export function arrangeChapters<T extends { key: string; parent_key: string; position: number }>(
	chapters: T[]
): Array<T & { depth: number }> {
	const top = chapters
		.filter((c) => !c.parent_key)
		.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

	const childrenOf = new Map<string, T[]>();
	for (const chapter of chapters) {
		if (!chapter.parent_key) continue;
		const list = childrenOf.get(chapter.parent_key) ?? [];
		list.push(chapter);
		childrenOf.set(chapter.parent_key, list);
	}

	const arranged: Array<T & { depth: number }> = [];
	for (const parent of top) {
		arranged.push({ ...parent, depth: 0 });
		const children = (childrenOf.get(parent.key) ?? []).sort(
			(a, b) => a.position - b.position || a.key.localeCompare(b.key)
		);
		for (const child of children) arranged.push({ ...child, depth: 1 });
	}

	// A sub-chapter whose parent vanished would otherwise disappear from the UI
	// while still sitting in the database.
	const placed = new Set(arranged.map((c) => c.key));
	for (const orphan of chapters.filter((c) => !placed.has(c.key))) {
		arranged.push({ ...orphan, depth: 0 });
	}

	return arranged;
}

/* ------------------------------------------------- filing existing prose away */

/**
 * Moving what is already written into the sections that now hold it.
 *
 * Splitting a chapter used to create the sub-chapters and nothing else, leaving
 * every word in the parent. The agent was told to "split first, then fill the
 * parts in on later turns" — but a chapter is usually split once it has grown
 * large, which is to say once it is nearly finished, so there were no later
 * turns. The sub-chapters stayed empty for good: opening one showed nothing and
 * called itself not started, while the parent showed all of it.
 *
 * The prose already says where it goes. A chapter that is worth splitting is
 * written as `## Booking a car`, `## Blocking cars for servicing` — and those
 * headings are what the agent named the sections after in the first place. So the
 * headings are matched to the section titles here, in code, with no model call
 * and nothing rewritten.
 *
 * Wording drifts between the two ("My bookings and cancellation" becomes "Seeing
 * and cancelling my bookings"), so matching is on stemmed words rather than exact
 * text, and it is **best-first across all pairings** rather than best-per-heading:
 * an exact match claims its own section before a loose one can take it.
 *
 * Anything that cannot be placed confidently stays with the parent. There is no
 * fall back to matching by position — a heading filed under the wrong capability
 * is a wrong document, where one left where it was is merely untidy, and the
 * parent's view shows its sections beneath it so nothing left behind is hidden.
 */

export interface FilingTarget {
	key: string;
	title: string;
	/** Already has something in it, so nothing may be filed into it. */
	occupied?: boolean;
}

export interface Filing {
	/** What the parent should be left holding. */
	parent: string;
	filed: Array<{ key: string; markdown: string }>;
}

/** Below this, two titles are not the same thing said differently. */
const MIN_SCORE = 0.4;

const STOP = new Set([
	'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
	'is', 'it', 'be', 'with', 'from', 'that', 'this', 'as', 'per'
]);

/** Crude and symmetric: enough for "bookings" to meet "booking". */
function stem(word: string): string {
	for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ies', 'ers', 'er', 'es', 'ed', 's']) {
		if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
			return word.slice(0, -suffix.length);
		}
	}
	return word;
}

function words(text: string): Set<string> {
	const found = new Set<string>();
	const parts = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.split(/[^\p{L}\p{N}]+/u);

	for (const part of parts) {
		if (!part || STOP.has(part)) continue;
		found.add(stem(part));
	}
	return found;
}

/** How much two titles have in common, 0 to 1. */
export function similarity(left: string, right: string): number {
	const a = words(left);
	const b = words(right);
	if (a.size === 0 || b.size === 0) return 0;

	let shared = 0;
	for (const word of a) if (b.has(word)) shared += 1;
	return shared / (a.size + b.size - shared);
}

interface Block {
	heading: string;
	body: string;
	/** Heading and body together, for putting back unchanged. */
	raw: string;
}

/**
 * Cut markdown into its top-level sections.
 *
 * Split at the shallowest heading present rather than at a fixed `##`, since the
 * level a chapter uses for its sections varies. Fenced code is skipped so a `##`
 * inside a block comment cannot cut the document in half.
 */
function blocksOf(markdown: string): { preamble: string; blocks: Block[] } {
	const lines = markdown.split('\n');
	const depths: number[] = [];
	let fenced = false;

	for (const line of lines) {
		if (/^\s*```/.test(line)) fenced = !fenced;
		else if (!fenced) {
			const heading = line.match(/^(#{1,6})\s+\S/);
			if (heading) depths.push(heading[1].length);
		}
	}

	if (depths.length === 0) return { preamble: markdown, blocks: [] };

	const level = Math.min(...depths);
	const marker = new RegExp(`^#{${level}}\\s+(\\S.*)$`);
	const preamble: string[] = [];
	const blocks: Block[] = [];
	let current: { heading: string; lines: string[]; raw: string[] } | null = null;
	fenced = false;

	for (const line of lines) {
		if (/^\s*```/.test(line)) fenced = !fenced;

		const heading = fenced ? null : line.match(marker);
		if (heading) {
			if (current) {
				blocks.push({
					heading: current.heading,
					body: current.lines.join('\n').trim(),
					raw: current.raw.join('\n').trim()
				});
			}
			current = { heading: heading[1].trim(), lines: [], raw: [line] };
			continue;
		}

		if (current) {
			current.lines.push(line);
			current.raw.push(line);
		} else {
			preamble.push(line);
		}
	}

	if (current) {
		blocks.push({
			heading: current.heading,
			body: current.lines.join('\n').trim(),
			raw: current.raw.join('\n').trim()
		});
	}

	return { preamble: preamble.join('\n'), blocks };
}

export function distributeContent(markdown: string, targets: FilingTarget[]): Filing {
	const source = markdown ?? '';
	const { preamble, blocks } = blocksOf(source);

	if (blocks.length === 0 || targets.length === 0) {
		return { parent: source.trim(), filed: [] };
	}

	const pairs: Array<{ block: number; target: number; score: number }> = [];
	blocks.forEach((block, b) =>
		targets.forEach((target, t) => {
			const score = similarity(block.heading, target.title);
			if (score >= MIN_SCORE) pairs.push({ block: b, target: t, score });
		})
	);

	// Highest score first; ties settled by document order so the result never
	// depends on how the scores happened to be enumerated.
	pairs.sort((x, y) => y.score - x.score || x.block - y.block || x.target - y.target);

	const claimed = new Map<number, FilingTarget>();
	const takenBlocks = new Set<number>();
	const takenTargets = new Set<number>();

	for (const pair of pairs) {
		if (takenBlocks.has(pair.block) || takenTargets.has(pair.target)) continue;
		takenBlocks.add(pair.block);
		takenTargets.add(pair.target);
		claimed.set(pair.block, targets[pair.target]);
	}

	const filed: Array<{ key: string; markdown: string }> = [];
	const left: string[] = [];
	if (preamble.trim()) left.push(preamble.trim());

	blocks.forEach((block, index) => {
		const target = claimed.get(index);
		// A heading with nothing under it would leave the section still looking
		// unwritten, so it stays where it is rather than being filed as content.
		if (!target || target.occupied || !block.body) {
			left.push(block.raw);
			return;
		}
		filed.push({ key: target.key, markdown: block.body });
	});

	return { parent: left.join('\n\n').trim(), filed };
}

/**
 * The chapters that represent work still to do.
 *
 * A chapter that has been split is a container — its content is its sections — so
 * counting both it and them counts the same work twice, and a document reads
 * "4 of 18" in one place and "3 of 17" in another. Chapters the triage set aside
 * are not work either: they were never in scope.
 *
 * `ChapterIndex.svelte` derives the same rule for itself, because its progress bar
 * has to move as statuses stream in and a number from the server would go stale
 * mid-conversation. Change one, change the other.
 */
export function countableChapters<
	T extends { key: string; parent_key?: string; applicable?: number }
>(chapters: T[]): T[] {
	const containers = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
	return chapters.filter((c) => c.applicable !== 0 && !containers.has(c.key));
}

/** File name for a chapter, keeping reading order in a flat directory. */
export function chapterPath(
	chapter: { key: string; parent_key: string; position: number },
	parentPosition: number
): string {
	if (!chapter.parent_key) {
		return `docs/${String(chapter.position * 10).padStart(3, '0')}-${chapter.key}.md`;
	}
	const parent = String(parentPosition * 10).padStart(3, '0');
	return `docs/${parent}-${String(chapter.position + 1).padStart(2, '0')}-${chapter.key}.md`;
}
