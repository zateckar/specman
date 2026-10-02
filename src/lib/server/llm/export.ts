/**
 * Turning the document into something a developer — or a coding agent — can
 * build from.
 *
 * The design document is written for the person who asked for the application:
 * plain language, no notation, decisions explained. That is the right audience
 * for the conversation and the wrong one for construction. This produces the
 * other view: what must be true, what is explicitly out of scope, what was
 * assumed and by whom, and in what order to read it.
 *
 * A pure function from data to files, so `npm test` can check the whole bundle
 * without a repository or a gateway.
 *
 * Deliberately free of imports.
 */

export interface ExportChapter {
	key: string;
	title: string;
	goal: string;
	status: string;
	content_md: string;
	position: number;
	/** Set when this is a section of another chapter; its position is relative. */
	parent_key?: string;
	applicable: number;
	skip_reason: string;
	open_questions: string[];
}

export interface ExportRequirement {
	ref: string;
	chapter_key: string;
	statement: string;
	scope: string;
	scenarios: Array<{ when: string; then: string }>;
	source: string;
	existing: number;
}

export interface ExportDecision {
	chapter_key: string;
	statement: string;
	rationale: string;
	source: string;
	status: string;
}

export interface ExportInput {
	project: { name: string; description: string; kind: string };
	chapters: ExportChapter[];
	requirements: ExportRequirement[];
	decisions: ExportDecision[];
	/** Structural problems from `validateDocument`, if any. */
	problems: Array<{ severity: string; message: string }>;
}

const SCOPE_HEADING: Record<string, string> = {
	now: 'Must be true in the first version',
	later: 'Agreed, but deliberately not in the first version'
};

/**
 * Reading order: each chapter followed by its own sections.
 *
 * A section's position is relative to its parent, so sorting on position alone
 * interleaves the sections of chapter three with chapters one and two. That was
 * invisible while sections were empty and wrong the moment they hold the
 * functionality — which is exactly what they hold now.
 */
function inReadingOrder(chapters: ExportChapter[]): ExportChapter[] {
	const byPosition = (a: ExportChapter, b: ExportChapter) =>
		a.position - b.position || a.key.localeCompare(b.key);

	const ordered: ExportChapter[] = [];
	for (const parent of chapters.filter((c) => !c.parent_key).sort(byPosition)) {
		ordered.push(parent);
		ordered.push(...chapters.filter((c) => c.parent_key === parent.key).sort(byPosition));
	}

	// A section whose parent is not in the set would otherwise vanish from the
	// bundle while still being part of the document.
	const placed = new Set(ordered.map((c) => c.key));
	ordered.push(...chapters.filter((c) => !placed.has(c.key)).sort(byPosition));

	return ordered;
}

/** Same numbering as `git/repo.ts` — a flat directory that still reads in order. */
function chapterFiles(chapters: ExportChapter[]): Map<string, string> {
	const positionOf = new Map(
		chapters.filter((c) => !c.parent_key).map((c) => [c.key, c.position])
	);

	return new Map(
		chapters.map((chapter) => {
			if (!chapter.parent_key) {
				return [
					chapter.key,
					`chapters/${String(chapter.position * 10).padStart(3, '0')}-${chapter.key}.md`
				];
			}
			const parent = String((positionOf.get(chapter.parent_key) ?? 0) * 10).padStart(3, '0');
			const own = String(chapter.position + 1).padStart(2, '0');
			return [chapter.key, `chapters/${parent}-${own}-${chapter.key}.md`];
		})
	);
}

function renderScenarios(requirement: ExportRequirement): string[] {
	return requirement.scenarios.flatMap((scenario) => [
		`- **WHEN** ${scenario.when}`,
		`  **THEN** ${scenario.then}`
	]);
}

function renderChapter(
	chapter: ExportChapter,
	requirements: ExportRequirement[]
): string {
	const lines: string[] = [`# ${chapter.title}`, ''];
	if (chapter.goal) lines.push(`> ${chapter.goal}`, '');

	if (chapter.applicable === 0) {
		lines.push(
			`**Not applicable to this application.** ${chapter.skip_reason}`,
			'',
			'Nothing in this area needs building.',
			''
		);
		return lines.join('\n');
	}

	if (chapter.content_md.trim()) lines.push(chapter.content_md.trim(), '');
	else lines.push('_Not described._', '');

	for (const scope of ['now', 'later'] as const) {
		const group = requirements.filter((r) => r.scope === scope);
		if (group.length === 0) continue;

		lines.push(`## ${SCOPE_HEADING[scope]}`, '');
		for (const requirement of group) {
			const already = requirement.existing ? ' _(already true today)_' : '';
			lines.push(`### ${requirement.ref}${already}`, '', requirement.statement, '');
			const scenarios = renderScenarios(requirement);
			if (scenarios.length > 0) lines.push(...scenarios, '');
		}
	}

	if (chapter.open_questions.length > 0) {
		lines.push(
			'## Not yet answered',
			'',
			'These are undecided. Do not guess — ask.',
			'',
			...chapter.open_questions.map((q) => `- ${q}`),
			''
		);
	}

	return lines.join('\n');
}

/**
 * What the first page of the bundle says, counted once.
 *
 * The export page counted for itself, over every chapter, while `AGENTS.md`
 * counted over the chapters that apply — so the page and the file it describes
 * gave different numbers for the same document. Both read this now.
 */
export function bundleSummary(input: ExportInput) {
	// Counted over the chapters that apply. A set-aside chapter is rendered as
	// "nothing in this area needs building", and counting its rules here as well
	// told the reader the opposite on the first page.
	const applies = new Set(input.chapters.filter((c) => c.applicable !== 0).map((c) => c.key));
	return {
		inScope: input.requirements.filter((r) => r.scope === 'now' && applies.has(r.chapter_key)),
		assumed: input.decisions.filter(
			(d) => d.source !== 'user' && d.status !== 'confirmed' && applies.has(d.chapter_key)
		),
		openQuestions: input.chapters
			.filter((c) => applies.has(c.key))
			.reduce((sum, c) => sum + c.open_questions.length, 0),
		errors: input.problems.filter((p) => p.severity === 'error'),
		warnings: input.problems.filter((p) => p.severity === 'warning')
	};
}

function renderAgents(
	input: ExportInput,
	chapters: ExportChapter[],
	fileOf: Map<string, string>
): string {
	const { project, requirements } = input;
	const { inScope: now, assumed, openQuestions, errors, warnings } = bundleSummary(input);

	const lines: string[] = [
		`# ${project.name}`,
		'',
		project.description || '_No short description was given._',
		''
	];

	if (project.kind === 'change') {
		lines.push(
			'**This application already exists.** Requirements marked _(already true today)_ describe',
			'current behaviour — they are there so you know what not to rebuild. Everything else is new.',
			''
		);
	}

	lines.push(
		'## What this is',
		'',
		'A specification written by the person who wants this application, with an assistant',
		'conducting the interview. They are not a developer: the wording is theirs, and it says',
		'what the application must do rather than how to build it. Technology choices are yours.',
		'',
		now.length === 1
			? '1 requirement is in scope for the first version.'
			: `${now.length} requirements are in scope for the first version.`,
		''
	);

	if (errors.length > 0 || openQuestions > 0 || assumed.length > 0 || warnings.length > 0) {
		lines.push('## Read this before you start', '');

		if (errors.length > 0) {
			lines.push(
				`**${errors.length} structural problem${errors.length === 1 ? '' : 's'} in the specification:**`,
				'',
				...errors.map((e) => `- ${e.message}`),
				''
			);
		}
		if (openQuestions > 0) {
			lines.push(
				openQuestions === 1
					? '**1 question remains unanswered.** It is listed'
					: `**${openQuestions} questions remain unanswered.** They are listed`,
				'under "Not yet answered" in each chapter. Ask rather than assume — a guess here becomes',
				'a rebuild later.',
				''
			);
		}
		if (assumed.length > 0) {
			lines.push(
				`**${assumed.length} decision${assumed.length === 1 ? ' was' : 's were'} made by the assistant and never confirmed**`,
				'by the requester. They are marked in `decisions.md`. Treat them as weaker than the rest.',
				''
			);
		}
		// The page told the requester about these and the builder never heard of
		// them: the same caveat has to reach both.
		if (warnings.length > 0) {
			lines.push(
				`**${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth checking:**`,
				'',
				...warnings.map((w) => `- ${w.message}`),
				''
			);
		}
	}

	lines.push('## Read in this order', '');
	for (const chapter of chapters) {
		const own = requirements.filter((r) => r.chapter_key === chapter.key && r.scope === 'now');
		const note =
			chapter.applicable === 0
				? 'not applicable'
				: `${own.length} requirement${own.length === 1 ? '' : 's'}`;
		lines.push(`- [${chapter.title}](${fileOf.get(chapter.key)}) — ${note}`);
	}

	lines.push(
		'',
		'- [decisions.md](decisions.md) — what was settled, by whom, and why',
		'- [out-of-scope.md](out-of-scope.md) — what must **not** be built',
		'',
		'## Ground rules',
		'',
		'- A requirement is a requirement. The **WHEN/THEN** examples are the acceptance criteria;',
		'  if your implementation fails one, it is wrong regardless of how reasonable it looks.',
		'- Anything in `out-of-scope.md` must not be built, however easy it would be to add. It was',
		'  excluded on purpose, and adding it back is a change to the specification, not a favour.',
		'- Requirements under "deliberately not in the first version" are agreed but not now. Do not',
		'  build them, and do not design in a way that makes them impossible.',
		'- Where the specification is silent, ask. It was written by someone describing their work,',
		'  so silence usually means the question never came up — not that anything goes.',
		''
	);

	return lines.join('\n');
}

function renderDecisions(input: ExportInput, chapters: ExportChapter[]): string {
	const titles = new Map(chapters.map((c) => [c.key, c.title]));
	const label: Record<string, string> = {
		user: 'the requester',
		agent: 'the assistant',
		standard: 'a company standard'
	};

	const lines: string[] = ['# Decisions', ''];

	if (input.decisions.length === 0) {
		lines.push('_Nothing was recorded as an explicit decision._', '');
		return lines.join('\n');
	}

	lines.push(
		'Who chose what. A decision made by the assistant and not confirmed by the requester is',
		'the weakest thing in this specification — if one blocks you, question it rather than',
		'building on it.',
		''
	);

	for (const chapter of chapters) {
		const own = input.decisions.filter((d) => d.chapter_key === chapter.key);
		if (own.length === 0) continue;

		lines.push(`## ${titles.get(chapter.key) ?? chapter.key}`, '');
		for (const decision of own) {
			const unconfirmed = decision.source !== 'user' && decision.status !== 'confirmed';
			lines.push(
				`- ${decision.statement}`,
				`  — decided by ${label[decision.source] ?? decision.source}${unconfirmed ? ', **not confirmed**' : ''}`
			);
			if (decision.rationale) lines.push(`  — because ${decision.rationale}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

function renderOutOfScope(input: ExportInput, chapters: ExportChapter[]): string {
	const titles = new Map(chapters.map((c) => [c.key, c.title]));
	const excluded = input.requirements.filter((r) => r.scope === 'out');
	const notApplicable = chapters.filter((c) => c.applicable === 0);

	const lines: string[] = [
		'# Out of scope',
		'',
		'Do not build any of this. Each was excluded deliberately, and adding it back is a change',
		'to the specification.',
		''
	];

	if (excluded.length === 0 && notApplicable.length === 0) {
		lines.push('_Nothing has been ruled out._', '');
		return lines.join('\n');
	}

	if (excluded.length > 0) {
		lines.push('## Ruled out', '');
		for (const requirement of excluded) {
			lines.push(
				`- **${requirement.statement}** (${requirement.ref}, ${titles.get(requirement.chapter_key) ?? requirement.chapter_key})`
			);
		}
		lines.push('');
	}

	if (notApplicable.length > 0) {
		lines.push('## Areas that do not apply', '');
		for (const chapter of notApplicable) {
			lines.push(`- **${chapter.title}** — ${chapter.skip_reason}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

/** The whole bundle: relative path inside `spec/` → file contents. */
export function buildSpecBundle(input: ExportInput): Map<string, string> {
	const chapters = inReadingOrder(input.chapters);
	const fileOf = chapterFiles(chapters);
	const files = new Map<string, string>();

	files.set('AGENTS.md', renderAgents(input, chapters, fileOf));

	// Inserted in reading order, which is the order `buildSingleFile` relies on.
	for (const chapter of chapters) {
		files.set(
			fileOf.get(chapter.key)!,
			renderChapter(
				chapter,
				input.requirements.filter((r) => r.chapter_key === chapter.key)
			)
		);
	}

	files.set('decisions.md', renderDecisions(input, chapters));
	files.set('out-of-scope.md', renderOutOfScope(input, chapters));

	return files;
}

/**
 * The same content as one document, for pasting into a chat.
 *
 * Ordered as `AGENTS.md` tells a reader to read it, so the paste makes sense on
 * its own without the file names.
 */
export function buildSingleFile(input: ExportInput): string {
	const files = buildSpecBundle(input);
	const order = [
		'AGENTS.md',
		// Insertion order, not sorted: a section's file name sorts before its own
		// parent's, which would put the parts of a chapter ahead of the chapter.
		...[...files.keys()].filter((k) => k.startsWith('chapters/')),
		'decisions.md',
		'out-of-scope.md'
	];

	return order
		.map((path) => files.get(path)?.trim())
		.filter(Boolean)
		.join('\n\n---\n\n');
}
