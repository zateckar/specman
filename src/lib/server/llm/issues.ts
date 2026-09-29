/**
 * Issues found by the verification pass — matters of judgement, not of form.
 *
 * `validation.ts` answers "is this document well formed?" deterministically and
 * for free. This is the other half: does it still hang together? Are two rules
 * in conflict? Was something the user decided actually written down? Those need
 * a model, and therefore cost gateway calls and run on demand.
 *
 * Issues are advisory. They are shown to the user before approval, never used to
 * block it — a model's opinion about a document is not grounds for refusing to
 * save the user's own work.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type IssueKind = 'contradiction' | 'missing' | 'unclear' | 'drift';

export interface Issue {
	kind: IssueKind;
	/** Chapter keys the issue touches. */
	chapters: string[];
	/** Requirement refs the issue touches. */
	refs: string[];
	message: string;
}

const KINDS: IssueKind[] = ['contradiction', 'missing', 'unclear', 'drift'];

function splitList(raw: string | undefined): string[] {
	return (raw ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

/** Build an issue from a parsed `<finding>` block. */
export function toIssue(attrs: Record<string, string>, body: string): Issue | null {
	const message = body.replace(/\s+/g, ' ').trim();
	// Anything shorter is a fragment, not a finding worth showing.
	if (message.length < 12) return null;

	const kind = (attrs.kind ?? '').trim().toLowerCase() as IssueKind;

	return {
		kind: KINDS.includes(kind) ? kind : 'unclear',
		chapters: splitList(attrs.chapters ?? attrs.chapter).map((c) => c.toLowerCase()),
		refs: splitList(attrs.refs ?? attrs.ref).map((r) => r.toUpperCase()),
		message
	};
}

/**
 * Merge issues from several calls into one list.
 *
 * Each chapter is checked separately and the whole document once more, so the
 * same contradiction is often reported twice from opposite sides. Two reports of
 * one problem read as two problems, so near-identical messages collapse.
 */
export function mergeIssues(issues: Issue[]): Issue[] {
	const seen = new Map<string, Issue>();

	for (const issue of issues) {
		const key = issue.message
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, '')
			.replace(/\s+/g, ' ')
			.trim();

		const existing = seen.get(key);
		if (!existing) {
			seen.set(key, issue);
			continue;
		}

		// Same problem seen from two chapters: keep every reference to it.
		existing.chapters = [...new Set([...existing.chapters, ...issue.chapters])];
		existing.refs = [...new Set([...existing.refs, ...issue.refs])];
	}

	// Contradictions first: a document that disagrees with itself cannot be built
	// from, while something merely unclear can still be acted on.
	const order: Record<IssueKind, number> = { contradiction: 0, missing: 1, drift: 2, unclear: 3 };
	return [...seen.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}

export function summariseIssues(issues: Issue[]): string {
	if (issues.length === 0) return 'Nothing to flag — the document holds together.';

	const contradictions = issues.filter((i) => i.kind === 'contradiction').length;
	const rest = issues.length - contradictions;

	const parts: string[] = [];
	if (contradictions > 0) {
		parts.push(
			contradictions === 1 ? '1 thing that disagrees' : `${contradictions} things that disagree`
		);
	}
	if (rest > 0) parts.push(`${rest} worth a look`);

	return parts.join(', ');
}
