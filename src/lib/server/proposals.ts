import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	db,
	addMessage,
	atomically,
	clearMigrated,
	documentRevision,
	DocumentConflict,
	confirmDecision,
	deleteDecision,
	getChapter,
	getDecision,
	getProject,
	listProjects,
	updateChapterState,
	projectChapters,
	projectDecisions,
	projectRequirements,
	saveVerification,
	setChapterApplicable,
	type VerificationRow,
	projectsMigratedAtStartup
} from './db';
import type { Decision, Project, Proposal } from './db/types';
import {
	MAIN_BRANCH,
	checkoutBranch,
	commitAll,
	diffAgainstMain,
	ensureRepo,
	hasChanges,
	mergeToMain,
	resolveRevision,
	revisionIsAncestor,
	recoveryTreeSafe,
	onlyBundleChanged,
	repoPathFor,
	specInputOnBranch,
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
	await recoverApproval(project);
	// A proposal is made only once the repository has its first commit, so any
	// proposal at all means there was a history here to lose.
	await ensureRepo(project.repo_path, project.name, listProposals(project.id).length > 0);

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
	return withRepo(project.repo_path, () => commitWorkingDocument(project, message));
}

/** Caller holds the repository; capture the whole export before any further await. */
async function commitWorkingDocument(project: Project, message: string): Promise<string | null> {
	const proposal = await workingProposal(project);
	const input = specInput(project);
	writeDocument(
		project.repo_path,
		project.name,
		projectChapters(project.id),
		projectRequirements(project.id),
		projectDecisions(project.id)
	);
	writeFileSync(join(project.repo_path, 'specman.export.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
	const commit = await commitAll(project.repo_path, message, proposal.branch);
	// The whole document is in the repository now, whether or not anything
	// changed, so a repair waiting to reach it has.
	clearMigrated(project.id);

	if (commit) {
		db()
			.prepare("UPDATE proposals SET title = ? WHERE id = ? AND title = 'Design updates'")
			.run(message.slice(0, 72), proposal.id);
	}

	return commit;
}

/** The decision is gone — another tab discarded it first. */
export class DecisionNotFound extends Error {
	constructor() {
		super('That decision is no longer there. It may have been settled in another window.');
		this.name = 'DecisionNotFound';
	}
}

/** What the assistant asks once the user says an assumption was wrong. */
export function questionForRejected(statement: string): string {
	return `Earlier I chose this for you: “${statement.trim()}”. You said that is not right — what should it be instead?`;
}

/** A decision change and its commit share the approval lock. */
export async function recordDecision(project: Project, id: number, action: 'confirm' | 'discard'): Promise<void> {
	await withRepo(project.repo_path, async () => {
		await recoverApproval(project);
		const decision = getDecision(id);
		if (!decision || decision.project_id !== project.id) throw new DecisionNotFound();
		if (action === 'discard') reopenRejected(project, decision);
		else confirmDecision(project.id, id);
		await commitWorkingDocument(project, action === 'discard' ? 'Discard a proposed decision' : 'Confirm a proposed decision');
	});
}

/**
 * Bring a chapter the triage set aside back into the document.
 *
 * The index told the user to "open one if you think it does apply", and opening
 * it changed nothing: the chapter stayed out of the progress, the export and the
 * handoff until something happened to be written in it. This is the overruling
 * the triage promised, as a deliberate act, committed like any other change.
 */
export async function includeChapter(project: Project, key: string): Promise<void> {
	await withRepo(project.repo_path, async () => {
		await recoverApproval(project);
		const chapter = getChapter(project.id, key);
		if (!chapter) return;
		if (chapter.applicable === 0) setChapterApplicable(project.id, key, true);
		// Committed even when it already reads as included. A choice whose commit
		// failed is kept, as a confirmation is, and that is what a retry finds —
		// returning early made the retry succeed while still recording nothing.
		await commitWorkingDocument(project, `Include ${chapter.title}`);
	});
}

/**
 * "Not right" does not end the matter; it reopens it.
 *
 * Deleting the row was all this used to do, while the page promised the question
 * would be raised again — a plan with no owner. The rejected assumption stayed in
 * the prose, and with nothing pending the chapter could read as complete and be
 * approved resting on it. So the work is done here, at the moment the user says
 * so: the chapter is put back in progress with the question at the top of its
 * open questions, and the assistant asks it in that chapter's conversation.
 * One transaction, so the decision cannot vanish without the question appearing.
 */
function reopenRejected(project: Project, decision: Decision): void {
	const question = questionForRejected(decision.statement);
	atomically(() => {
		deleteDecision(project.id, decision.id);
		const chapter = getChapter(project.id, decision.chapter_key);
		if (chapter) {
			updateChapterState(project.id, chapter.key, {
				status: 'in_progress',
				openQuestions: [question, ...chapter.open_questions.filter((q) => q !== question)]
			});
			addMessage(project.id, chapter.key, 'assistant', question);
		}
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
	checked: string[],
	failed: string[],
	expectedRevision: number
): Promise<VerificationRow> {
	return withRepo(project.repo_path, async () => {
		const proposal = await workingProposal(project);
		if (documentRevision(project.id) !== expectedRevision) throw new DocumentConflict();
		const saved = saveVerification(project.id, issues, checked, failed, expectedRevision);

		const titles = new Map(projectChapters(project.id).map((c) => [c.key, c.title]));
		const lines: string[] = [
			'# Check of the whole document',
			'',
			`Document revision: ${expectedRevision}.`,
			'',
			`${checked.length} chapter${checked.length === 1 ? '' : 's'} checked.`,
			''
		];

		if (failed.length > 0) {
			lines.push('**Check incomplete.** Some parts could not be checked:', '');
			for (const key of failed) lines.push(`- ${key === 'whole-document' ? 'Agreement across chapters' : titles.get(key) ?? key}`);
			lines.push('', 'Run the check again to cover these parts.', '');
		}
		if (issues.length === 0 && failed.length === 0) {
			lines.push('Nothing was flagged. The document agrees with itself.');
		} else {
			for (const issue of issues) {
				const where = issue.chapters.map((k) => titles.get(k) ?? k).join(', ');
				lines.push(`- **${issue.kind}** — ${issue.message}`);
				if (where) lines.push(`  In: ${where}`);
				if (issue.refs.length > 0) lines.push(`  Concerns: ${issue.refs.join(', ')}`);
			}
		}

		try {
			writeFileSync(join(project.repo_path, 'VERIFICATION.md'), lines.join('\n') + '\n', 'utf8');
			await commitAll(project.repo_path, 'Record check of the whole document', proposal.branch);
		} catch (cause) {
			console.error('[verify] could not record the check in version control:', cause);
		}
		return { ...saved, stale: documentRevision(project.id) !== expectedRevision };
	});
}

export interface ReviewedRevision {
	proposalId: number;
	proposalRevision: string;
	mainRevision: string;
}

/** The prose diff and requirement delta use these immutable commits. */
export async function reviewRevision(project: Project, proposal: Proposal): Promise<ReviewedRevision> {
	const [proposalRevision, mainRevision] = await Promise.all([
		resolveRevision(project.repo_path, proposal.branch),
		resolveRevision(project.repo_path, MAIN_BRANCH)
	]);
	return { proposalId: proposal.id, proposalRevision, mainRevision };
}

export async function proposalDiff(project: Project, reviewed: ReviewedRevision): Promise<string> {
	return diffAgainstMain(project.repo_path, reviewed.proposalRevision, reviewed.mainRevision);
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
			decisions,
			setAside: chapters.filter((c) => c.applicable === 0)
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
export async function approveProposal(project: Project, proposal: Proposal, reviewed: ReviewedRevision): Promise<void> {
	await withRepo(project.repo_path, async () => {
		await recoverApproval(project);
		if (reviewed.proposalId !== proposal.id || openProposal(project.id)?.id !== proposal.id) throw new StaleReview();
		const current = await reviewRevision(project, proposal);
		if (current.proposalRevision !== reviewed.proposalRevision || current.mainRevision !== reviewed.mainRevision) {
			throw new StaleReview();
		}
		// A failed commit can leave files staged or untracked. The bundle commit
		// stages the whole tree, so moving it to main must start from a clean tree.
		if (await hasChanges(project.repo_path)) throw new UnrecordedChanges();
		db()
			.prepare(`INSERT INTO approval_intents (proposal_id, project_id, proposal_revision, main_revision, phase)
				VALUES (?, ?, ?, ?, 'prepared')`)
			.run(proposal.id, project.id, reviewed.proposalRevision, reviewed.mainRevision);
		try {
			await recoverApproval(project);
		} catch (cause) {
			// Approval stands once its merge and marker are durable. Bundle recovery
			// remains pending and subsequent writers must finish it before proceeding.
			if (getProposal(proposal.id)?.state !== 'merged') throw cause;
			console.error('[proposals] approved; specification bundle awaits recovery:', cause);
		}
	});
}

interface ApprovalIntent {
	proposal_id: number;
	project_id: number;
	proposal_revision: string;
	main_revision: string;
	merge_revision: string | null;
	phase: 'prepared' | 'merged' | 'complete';
}

export class ApprovalRecoveryBlocked extends Error {
	constructor(detail: string) {
		super(`An approved change is awaiting recovery. ${detail}`);
		this.name = 'ApprovalRecoveryBlocked';
	}
}

/** Caller owns the repository. No new branch/write may bypass this journal. */
async function recoverApproval(project: Project): Promise<void> {
	try {
		await recoverApprovalWork(project);
	} catch (cause) {
		if (cause instanceof ApprovalRecoveryBlocked) throw cause;
		throw new ApprovalRecoveryBlocked(cause instanceof Error ? cause.message : 'Recovery could not finish.');
	}
}

async function recoverApprovalWork(project: Project): Promise<void> {
	const intent = db().prepare(`SELECT * FROM approval_intents WHERE project_id = ? AND phase <> 'complete'`)
		.get(project.id) as ApprovalIntent | undefined;
	if (!intent) return;
	if (!await recoveryTreeSafe(project.repo_path, intent.phase === 'merged')) {
		throw new ApprovalRecoveryBlocked('The repository has unfinished Git work or unrecorded changes. Resolve them before retrying.');
	}

	if (intent.phase === 'prepared') {
		let main = await resolveRevision(project.repo_path, MAIN_BRANCH);
		if (!await revisionIsAncestor(project.repo_path, intent.proposal_revision, main)) {
			if (main !== intent.main_revision) {
				throw new ApprovalRecoveryBlocked('The approved base moved before merging. Restore the reviewed base before retrying.');
			}
			await mergeToMain(project.repo_path, intent.proposal_revision);
			main = await resolveRevision(project.repo_path, MAIN_BRANCH);
		}
		if (!await revisionIsAncestor(project.repo_path, intent.main_revision, main)) {
			throw new ApprovalRecoveryBlocked('The reviewed base is missing from main history.');
		}
		const database = db();
		database.exec('BEGIN IMMEDIATE');
		try {
			database.prepare(`UPDATE proposals SET state = 'merged', merged_at = datetime('now') WHERE id = ?`)
				.run(intent.proposal_id);
			database.prepare(`UPDATE approval_intents SET phase = 'merged', merge_revision = ? WHERE proposal_id = ?`)
				.run(main, intent.proposal_id);
			database.exec('COMMIT');
		} catch (cause) {
			database.exec('ROLLBACK');
			throw cause;
		}
		intent.merge_revision = main;
		intent.phase = 'merged';
	}

	const main = await resolveRevision(project.repo_path, MAIN_BRANCH);
	if (!intent.merge_revision || !await revisionIsAncestor(project.repo_path, intent.proposal_revision, main) ||
		!await revisionIsAncestor(project.repo_path, intent.merge_revision, main) ||
		!await onlyBundleChanged(project.repo_path, intent.merge_revision, main)) {
		throw new ApprovalRecoveryBlocked('Main no longer matches the recorded merge.');
	}
	await checkoutBranch(project.repo_path, MAIN_BRANCH);
	writeSpecBundle(project.repo_path, buildSpecBundle(await specInputOnBranch(project.repo_path, intent.merge_revision)));
	await commitAll(project.repo_path, 'Update the build-ready specification', MAIN_BRANCH);
	db().prepare(`UPDATE approval_intents SET phase = 'complete' WHERE proposal_id = ?`).run(intent.proposal_id);
}

/**
 * Point each application at its repository again after the installation moved.
 *
 * The path is stored whole, resolved against the folder the server was started
 * in. Started from another folder — a different working directory in the
 * container, a backup restored somewhere else — every stored path named
 * nothing. Where the repository is found where this installation would put it,
 * the stored path follows it; where it is found nowhere, that is said at boot
 * rather than discovered by the first person to answer a question.
 *
 * Synchronous and run before anything reads `repo_path`.
 */
export function relocateRepositories(): void {
	for (const project of listProjects()) {
		if (existsSync(join(project.repo_path, '.git'))) continue;
		const here = repoPathFor(project.slug);
		if (here !== project.repo_path && existsSync(join(here, '.git'))) {
			db().prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(here, project.id);
			console.warn(`[repos] "${project.name}" is now read from ${here} (was ${project.repo_path})`);
		} else if (historyMissing(project)) {
			console.error(`[repos] the repository of "${project.name}" is missing from ${project.repo_path}`);
		}
	}
}

/**
 * An application that has had a history, whose repository is not there.
 *
 * A proposal is made only once the repository has its first commit, so any
 * proposal at all means there was a history to lose. See `RepositoryMissing`.
 */
export function historyMissing(project: Project): boolean {
	return !existsSync(join(project.repo_path, '.git')) && listProposals(project.id).length > 0;
}

/** Idempotent forward recovery; failures in one project do not hide the others. */
export async function recoverPendingApprovals(): Promise<void> {
	const rows = db().prepare(`SELECT DISTINCT project_id FROM approval_intents WHERE phase <> 'complete'`)
		.all() as Array<{ project_id: number }>;
	for (const { project_id } of rows) {
		const project = getProject(project_id);
		if (!project) continue;
		try {
			await withRepo(project.repo_path, () => recoverApproval(project));
		} catch (cause) {
			console.error(`[proposals] recovery blocked for project ${project_id}:`, cause);
		}
	}
}

export class StaleReview extends Error {
	constructor() {
		super('The proposal or approved document changed since this review. Review the updated changes before approving.');
		this.name = 'StaleReview';
	}
}

export class UnrecordedChanges extends Error {
	constructor() {
		super('Some changes have not reached the application’s history. Record another change before approving this proposal.');
		this.name = 'UnrecordedChanges';
	}
}

/**
 * Write out any document a startup repair rewrote.
 *
 * The repair rewrites chapters in the database; the repository is where the
 * document is read from and merged, so it has to be told. Committing the same
 * content twice is a no-op — `commitAll` returns null when the tree is
 * unchanged — so this is safe on every boot, and an entry whose commit fails is
 * still there to be tried at the next one.
 */
export async function commitStartupMigrations(): Promise<void> {
	for (const { projectId, summary } of projectsMigratedAtStartup()) {
		const project = getProject(projectId);
		if (!project) continue;

		try {
			const commit = await commitDocument(project, summary);
			if (commit) console.info(`[proposals] recorded the startup migration for ${project.name}: ${summary}`);
		} catch (cause) {
			// Kept as outstanding: the next boot tries again, and so does the next
			// conversation turn, which writes the whole document out anyway.
			console.error(`[proposals] could not record the startup migration for ${project.name}:`, cause);
		}
	}
}

export function markInReview(proposalId: number): void {
	db().prepare("UPDATE proposals SET state = 'in_review' WHERE id = ?").run(proposalId);
}
