import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	db,
	getProject,
	projectChapters,
	projectDecisions,
	projectRequirements,
	projectsMigratedAtStartup
} from './db';
import type { Project, Proposal } from './db/types';
import {
	MAIN_BRANCH,
	checkoutBranch,
	commitAll,
	diffAgainstMain,
	ensureRepo,
	mergeToMain,
	withRepo,
	writeDocument,
	writeSpecBundle
} from './git/repo';
import { buildSpecBundle, type ExportInput } from './llm/export';
import { validateDocument } from './llm/validation';
import { stripChapterHeading } from './markdown';

/**
 * A proposal is a working branch holding the changes made in conversation since
 * the last approval. The user reviews it and approves; the UI calls it a pull
 * request throughout so nothing changes in wording when GitHub is wired up.
 */

export function openProposal(projectId: number): Proposal | undefined {
	return db()
		.prepare(
			`SELECT * FROM proposals WHERE project_id = ? AND state IN ('draft','in_review')
			 ORDER BY id DESC LIMIT 1`
		)
		.get(projectId) as Proposal | undefined;
}

export function getProposal(id: number): Proposal | undefined {
	return db().prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal | undefined;
}

export function listProposals(projectId: number): Proposal[] {
	return db()
		.prepare('SELECT * FROM proposals WHERE project_id = ? ORDER BY id DESC')
		.all(projectId) as unknown as Proposal[];
}

function createProposal(projectId: number): Proposal {
	const database = db();
	database
		.prepare("INSERT INTO proposals (project_id, branch, title, state) VALUES (?, '', '', 'draft')")
		.run(projectId);

	const id = (database.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	const branch = `spec/${String(id).padStart(4, '0')}`;

	database.prepare('UPDATE proposals SET branch = ?, title = ? WHERE id = ?').run(
		branch,
		'Design updates',
		id
	);

	return getProposal(id)!;
}

/**
 * Ensures the repo exists and an open proposal branch is checked out.
 *
 * Unlocked: every caller below already holds the repository, and the lock is not
 * reentrant — taking it again here would deadlock the turn against itself.
 */
async function workingProposal(project: Project): Promise<Proposal> {
	await ensureRepo(project.repo_path, project.name);

	const proposal = openProposal(project.id) ?? createProposal(project.id);
	await checkoutBranch(project.repo_path, proposal.branch);
	return proposal;
}

/** Ensures the repo exists and an open proposal branch is checked out. */
export async function ensureWorkingProposal(project: Project): Promise<Proposal> {
	return withRepo(project.repo_path, () => workingProposal(project));
}

/**
 * Writes the current document state to the proposal branch and commits.
 * Returns the commit hash, or null when nothing changed.
 *
 * Checkout, write and commit are one held section. Ordering the git calls
 * individually would not help: the damage happens between them, when another
 * turn moves the branch under files this one has already written.
 */
export async function commitDocument(project: Project, message: string): Promise<string | null> {
	return withRepo(project.repo_path, async () => {
		const proposal = await workingProposal(project);
		writeDocument(
			project.repo_path,
			project.name,
			projectChapters(project.id),
			projectRequirements(project.id),
			projectDecisions(project.id)
		);
		const commit = await commitAll(project.repo_path, message, proposal.branch);

		if (commit) {
			db()
				.prepare("UPDATE proposals SET title = ? WHERE id = ? AND title = 'Design updates'")
				.run(message.slice(0, 72), proposal.id);
		}

		return commit;
	});
}

/**
 * Records the result of a whole-document check in the repository.
 *
 * Committed on the working branch so the check travels with the change it
 * describes, and a reviewer sees what was flagged before approving.
 */
export async function writeVerification(
	project: Project,
	issues: Array<{ kind: string; chapters: string[]; refs: string[]; message: string }>,
	checked: string[]
): Promise<string | null> {
	return withRepo(project.repo_path, async () => {
		const proposal = await workingProposal(project);

		const titles = new Map(projectChapters(project.id).map((c) => [c.key, c.title]));
		const lines: string[] = [
			'# Check of the whole document',
			'',
			`${checked.length} chapter${checked.length === 1 ? '' : 's'} checked.`,
			''
		];

		if (issues.length === 0) {
			lines.push('Nothing was flagged. The document agrees with itself.');
		} else {
			for (const issue of issues) {
				const where = issue.chapters.map((k) => titles.get(k) ?? k).join(', ');
				lines.push(`- **${issue.kind}** — ${issue.message}`);
				if (where) lines.push(`  In: ${where}`);
				if (issue.refs.length > 0) lines.push(`  Concerns: ${issue.refs.join(', ')}`);
			}
		}

		writeFileSync(join(project.repo_path, 'VERIFICATION.md'), lines.join('\n') + '\n', 'utf8');
		return commitAll(project.repo_path, 'Record check of the whole document', proposal.branch);
	});
}

export async function proposalDiff(project: Project, proposal: Proposal): Promise<string> {
	return diffAgainstMain(project.repo_path, proposal.branch);
}

/**
 * Assemble the inputs for the build-ready bundle.
 *
 * Kept here rather than in the export module so that module stays pure — it is
 * the one part of this whose whole output can be checked by `npm test`.
 */
export function specInput(project: Project): ExportInput {
	const chapters = projectChapters(project.id);
	const requirements = projectRequirements(project.id);
	const decisions = projectDecisions(project.id);

	return {
		project: { name: project.name, description: project.description, kind: project.kind },
		chapters: chapters.map((c) => ({
			key: c.key,
			title: c.title,
			goal: c.goal ?? '',
			status: c.status,
			content_md: stripChapterHeading(c.content_md ?? '', c.title),
			position: c.position,
			parent_key: c.parent_key ?? '',
			applicable: c.applicable ?? 1,
			skip_reason: c.skip_reason ?? '',
			open_questions: c.open_questions
		})),
		requirements: requirements.map((r) => ({
			ref: r.ref,
			chapter_key: r.chapter_key,
			statement: r.statement,
			scope: r.scope,
			scenarios: r.scenarios,
			source: r.source,
			existing: r.existing ?? 0
		})),
		decisions: decisions.map((d) => ({
			chapter_key: d.chapter_key,
			statement: d.statement,
			rationale: d.rationale,
			source: d.source,
			status: d.status
		})),
		problems: validateDocument({
			chapters: chapters.filter((c) => c.applicable !== 0),
			requirements,
			decisions
		})
	};
}

/**
 * Merge the proposal into main.
 *
 * Held for the whole merge. This is the case that mattered: approving checks out
 * `main`, and a conversation turn that had checked out its proposal branch a
 * moment earlier would stage its chapters onto `main` — a change reaching the
 * approved document without anyone approving it.
 */
export async function approveProposal(project: Project, proposal: Proposal): Promise<void> {
	await withRepo(project.repo_path, async () => {
		await mergeToMain(project.repo_path, proposal.branch);

		// Refresh the build-ready bundle on main, so what a developer clones always
		// matches the approved document rather than whatever was approved last time.
		try {
			writeSpecBundle(project.repo_path, buildSpecBundle(specInput(project)));
			await commitAll(project.repo_path, 'Update the build-ready specification', MAIN_BRANCH);
		} catch (cause) {
			console.error('[proposals] could not write the specification bundle:', cause);
		}

		db()
			.prepare("UPDATE proposals SET state = 'merged', merged_at = datetime('now') WHERE id = ?")
			.run(proposal.id);
		await checkoutBranch(project.repo_path, MAIN_BRANCH);
	});
}

/**
 * Write out any document the startup migration rewrote.
 *
 * The migration moves prose between chapters in the database; the repository is
 * where the document is read from and merged, so it has to be told. Committing
 * the same content twice is a no-op — `commitAll` returns null when the tree is
 * unchanged — so this is safe on every boot.
 */
export async function commitStartupMigrations(): Promise<void> {
	for (const id of projectsMigratedAtStartup()) {
		const project = getProject(id);
		if (!project) continue;

		try {
			const commit = await commitDocument(project, 'Move the chapter into its sub-chapters');
			if (commit) console.info(`[proposals] recorded the migrated split for ${project.name}`);
		} catch (cause) {
			// The next conversation turn writes the document out anyway, so a failure
			// here delays the repository catching up rather than losing anything.
			console.error(`[proposals] could not record the migrated split for ${project.name}:`, cause);
		}
	}
}

export function markInReview(proposalId: number): void {
	db().prepare("UPDATE proposals SET state = 'in_review' WHERE id = ?").run(proposalId);
}
