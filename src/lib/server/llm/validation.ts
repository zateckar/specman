/**
 * Structural checks over a whole document.
 *
 * Deterministic and cheap — no model call — so this can run on every save. It
 * answers "is this document well formed?", never "is it right?". Judgement
 * questions (contradictions, coverage, whether the document still describes the
 * application the overview claims) belong to the verification pass, which costs
 * gateway calls and runs on demand.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface Finding {
	severity: 'error' | 'warning';
	message: string;
	chapterKey?: string;
	ref?: string;
}

interface ChapterLike {
	key: string;
	title: string;
	status: string;
	open_questions: string[];
}

interface RequirementLike {
	ref: string;
	chapter_key: string;
	statement: string;
	scope: string;
	scenarios: Array<{ when: string; then: string }>;
}

/** Lowercased, punctuation-stripped, for comparing two statements as text. */
function normalise(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

interface DecisionLike {
	chapter_key: string;
	source: string;
	status: string;
}

/**
 * A requirement as the user knows it: by what it says. The preview never shows
 * references, so a finding naming REQ-003 named something the reader had no way
 * to find.
 */
function quote(req: RequirementLike): string {
	const words = req.statement.trim().replace(/\s+/g, ' ');
	if (!words) return 'a rule with no wording';
	return `the rule “${words.length > 80 ? `${words.slice(0, 77).trimEnd()}…` : words}”`;
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function validateDocument(input: {
	chapters: ChapterLike[];
	requirements: RequirementLike[];
	decisions?: DecisionLike[];
	/**
	 * Chapters the triage set aside. Not checked as chapters — they were never in
	 * scope — but they exist, and a rule filed under one is not an orphan.
	 */
	setAside?: Array<{ key: string; title: string }>;
}): Finding[] {
	const findings: Finding[] = [];
	const { chapters, requirements } = input;
	const decisions = input.decisions ?? [];
	const chapterKeys = new Set(chapters.map((c) => c.key));
	const setAside = new Map((input.setAside ?? []).map((c) => [c.key, c.title]));
	const titleOf = new Map(chapters.map((c) => [c.key, c.title]));

	const seenRefs = new Map<string, RequirementLike>();
	const seenStatements = new Map<string, RequirementLike>();

	for (const req of requirements) {
		const sharer = seenRefs.get(req.ref);
		if (sharer) {
			findings.push({
				severity: 'error',
				message: `Two rules were recorded as one: ${quote(sharer)} and ${quote(req)}.`,
				ref: req.ref,
				chapterKey: req.chapter_key
			});
		}
		seenRefs.set(req.ref, req);

		if (!req.statement.trim()) {
			findings.push({
				severity: 'error',
				message: `A rule in ${titleOf.get(req.chapter_key) ?? 'the document'} has no wording.`,
				ref: req.ref,
				chapterKey: req.chapter_key
			});
		}

		if (setAside.has(req.chapter_key)) {
			findings.push({
				severity: 'warning',
				message: `${capitalise(quote(req))} is in “${setAside.get(req.chapter_key)}”, which was set aside as not applying. Open that chapter if it does apply.`,
				ref: req.ref
			});
		} else if (!chapterKeys.has(req.chapter_key)) {
			findings.push({
				severity: 'error',
				message: `${capitalise(quote(req))} belongs to a chapter that no longer exists.`,
				ref: req.ref
			});
		}

		// An untestable requirement is an opinion. Only enforced for work that is
		// actually planned — something explicitly excluded needs no scenario.
		if (req.scope !== 'out' && req.scenarios.length === 0) {
			findings.push({
				severity: 'warning',
				message: `${capitalise(quote(req))} has no example of what it means in practice.`,
				ref: req.ref,
				chapterKey: req.chapter_key
			});
		}

		for (const scenario of req.scenarios) {
			if (!scenario.when.trim() || !scenario.then.trim()) {
				findings.push({
					severity: 'warning',
					message: `An example under ${quote(req)} is only half written.`,
					ref: req.ref,
					chapterKey: req.chapter_key
				});
			}
		}

		const key = normalise(req.statement);
		if (key) {
			if (seenStatements.has(key)) {
				findings.push({
					severity: 'warning',
					message: `${capitalise(quote(req))} is recorded twice.`,
					ref: req.ref,
					chapterKey: req.chapter_key
				});
			} else {
				seenStatements.set(key, req);
			}
		}
	}

	for (const chapter of chapters) {
		if (chapter.status === 'complete' && chapter.open_questions.length > 0) {
			findings.push({
				severity: 'error',
				message: `${chapter.title} is marked finished but still has questions open.`,
				chapterKey: chapter.key
			});
		}

		const own = requirements.filter((r) => r.chapter_key === chapter.key);
		if (chapter.status === 'complete' && own.length === 0) {
			findings.push({
				severity: 'warning',
				message: `${chapter.title} is finished but states nothing that must be true.`,
				chapterKey: chapter.key
			});
		}

		// Reported whatever the chapter's status: the status is already derived to
		// withhold "complete" while these are outstanding, so the job here is to
		// say what needs doing rather than repeat that it is unfinished.
		const pending = decisions.filter(
			(d) => d.chapter_key === chapter.key && d.source !== 'user' && d.status !== 'confirmed'
		).length;

		if (pending > 0) {
			findings.push({
				severity: 'warning',
				message: `${pending} decision${pending === 1 ? ' was' : 's were'} made for you in ${chapter.title} — please check ${pending === 1 ? 'it' : 'them'}.`,
				chapterKey: chapter.key
			});
		}
	}

	if (requirements.length > 0 && !requirements.some((r) => r.scope === 'now')) {
		findings.push({
			severity: 'warning',
			message: 'Nothing is scheduled to be built — every requirement is later or excluded.'
		});
	}

	// Errors first: they block the export, warnings do not.
	return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Chapters referenced by findings, for highlighting in the index. */
export function chaptersWithProblems(findings: Finding[]): Set<string> {
	return new Set(findings.filter((f) => f.chapterKey).map((f) => f.chapterKey!));
}

export { normalise as normaliseStatement };
