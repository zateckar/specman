/**
 * Comparing two versions of a document as requirements, not as text.
 *
 * A line diff answers "which characters moved". The person approving these
 * changes wants "which rules changed", and cannot be expected to read diff
 * hunks. Both sides come from `specman.manifest.json`, which the repository
 * already carries, so this is deterministic — no model call.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface ManifestRequirement {
	ref: string;
	chapter: string;
	scope: string;
	statement: string;
	scenarios: Array<{ when: string; then: string }>;
}

export interface RequirementChange {
	kind: 'added' | 'changed' | 'removed';
	ref: string;
	chapter: string;
	before?: ManifestRequirement;
	after?: ManifestRequirement;
	/** For a change: which parts moved, so the UI can say "postponed" rather than "changed". */
	fields: Array<'statement' | 'scope' | 'scenarios'>;
}

function sameScenarios(
	a: ManifestRequirement['scenarios'],
	b: ManifestRequirement['scenarios']
): boolean {
	if (a.length !== b.length) return false;
	return a.every((s, i) => s.when === b[i].when && s.then === b[i].then);
}

export function requirementDelta(
	before: ManifestRequirement[],
	after: ManifestRequirement[]
): RequirementChange[] {
	const byRefBefore = new Map(before.map((r) => [r.ref, r]));
	const byRefAfter = new Map(after.map((r) => [r.ref, r]));
	const changes: RequirementChange[] = [];

	for (const current of after) {
		const previous = byRefBefore.get(current.ref);

		if (!previous) {
			changes.push({ kind: 'added', ref: current.ref, chapter: current.chapter, after: current, fields: [] });
			continue;
		}

		const fields: RequirementChange['fields'] = [];
		if (previous.statement !== current.statement) fields.push('statement');
		if (previous.scope !== current.scope) fields.push('scope');
		if (!sameScenarios(previous.scenarios ?? [], current.scenarios ?? [])) fields.push('scenarios');

		if (fields.length > 0) {
			changes.push({
				kind: 'changed',
				ref: current.ref,
				chapter: current.chapter,
				before: previous,
				after: current,
				fields
			});
		}
	}

	for (const previous of before) {
		if (!byRefAfter.has(previous.ref)) {
			changes.push({
				kind: 'removed',
				ref: previous.ref,
				chapter: previous.chapter,
				before: previous,
				fields: []
			});
		}
	}

	// Removals first — dropping a rule deserves more attention than adding one.
	const order = { removed: 0, changed: 1, added: 2 } as const;
	return changes.sort((a, b) => order[a.kind] - order[b.kind] || a.ref.localeCompare(b.ref));
}

/** One line summarising the delta, for a heading. */
export function summariseDelta(changes: RequirementChange[]): string {
	const counts = {
		added: changes.filter((c) => c.kind === 'added').length,
		changed: changes.filter((c) => c.kind === 'changed').length,
		removed: changes.filter((c) => c.kind === 'removed').length
	};

	const parts: string[] = [];
	if (counts.added) parts.push(`${counts.added} added`);
	if (counts.changed) parts.push(`${counts.changed} changed`);
	if (counts.removed) parts.push(`${counts.removed} removed`);

	if (parts.length === 0) return 'No changes to what must be true';

	const total = counts.added + counts.changed + counts.removed;
	return `${total} requirement${total === 1 ? '' : 's'}: ${parts.join(', ')}`;
}
