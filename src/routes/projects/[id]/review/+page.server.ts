import { error, fail, redirect } from '@sveltejs/kit';
import {
	getProject,
	latestVerification,
	projectChapters,
	projectDecisions
} from '$lib/server/db';
import {
	approveProposal,
	ApprovalRecoveryBlocked,
	commitDocument,
	historyMissing,
	listProposals,
	openProposal,
	proposalDiff,
	reviewRevision,
	StaleReview,
	UnrecordedChanges
} from '$lib/server/proposals';
import { log, manifestOnMain, manifestOnBranch } from '$lib/server/git/repo';
import { requirementDelta, summariseDelta, type ManifestRequirement } from '$lib/server/llm/delta';
import type { Actions, PageServerLoad } from './$types';

/**
 * A history entry as the person approving reads it. The repository's own
 * messages name branches — "Merge design changes from spec/0003" — which is
 * storage, not something to show a colleague.
 */
function plainHistory(message: string): string {
	if (message.startsWith('Merge design changes')) return 'Changes approved';
	if (message === 'Update the build-ready specification') return 'Developer handoff brought up to date';
	if (message === 'Record check of the whole document') return 'Whole document checked';
	return message;
}

export const load: PageServerLoad = async ({ params }) => {
	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const proposal = openProposal(project.id);
	// Said as what it is. Read as an empty review, the page told the user that
	// everything was already approved while their latest answers were in no
	// history at all.
	const missing = historyMissing(project);
	// A proposal whose branch was never made — its first commit failed — has
	// nothing to review yet. Resolving it threw, and the page failed to load.
	const reviewed = proposal && !missing ? await reviewRevision(project, proposal).catch(() => null) : null;
	const diff = reviewed ? await proposalDiff(project, reviewed) : '';

	// What changed, as rules rather than as lines. Both sides come from the
	// manifest the repository already carries, so this costs no model call.
	const before = reviewed
		? await manifestOnBranch(project.repo_path, reviewed.mainRevision)
		: await manifestOnMain(project.repo_path);
	const after = reviewed ? await manifestOnBranch(project.repo_path, reviewed.proposalRevision) : before;
	const changes = requirementDelta(
		(before?.requirements ?? []) as ManifestRequirement[],
		(after?.requirements ?? []) as ManifestRequirement[]
	);

	const chapterTitles = Object.fromEntries(projectChapters(project.id).map((c) => [c.key, c.title]));
	const decisions = projectDecisions(project.id);

	return {
		project: { id: project.id, name: project.name },
		historyMissing: missing,
		proposal: proposal ? { id: proposal.id, branch: proposal.branch, title: proposal.title } : null,
		reviewed,
		diff,
		changes,
		changeSummary: summariseDelta(changes),
		chapterTitles,
		pendingDecisions: decisions.filter((d) => d.source !== 'user' && d.status !== 'confirmed'),
		verification: latestVerification(project.id) ?? null,
		history: (await log(project.repo_path, 15).catch(() => [])).map((entry) => ({
			message: plainHistory(entry.message),
			date: entry.date
		})),
		merged: listProposals(project.id)
			.filter((p) => p.state === 'merged')
			.slice(0, 10)
	};
};

export const actions: Actions = {
	approve: async ({ params, request }) => {
		const project = getProject(Number(params.id));
		if (!project) throw error(404, 'No such application');

		const proposal = openProposal(project.id);
		if (!proposal) return fail(409, { message: new StaleReview().message });
		const fields = await request.formData();
		const proposalId = Number(fields.get('proposalId'));
		const proposalRevision = String(fields.get('proposalRevision') ?? '');
		const mainRevision = String(fields.get('mainRevision') ?? '');
		const commitHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
		if (!Number.isSafeInteger(proposalId) || proposalId <= 0 ||
			!commitHash.test(proposalRevision) || !commitHash.test(mainRevision)) {
			return fail(409, { message: 'This review has no valid revision. Reload the review before approving.' });
		}

		// Said in the user's terms. The errors themselves speak of bases, merges and
		// Git work, which is right for the log and nothing a colleague can act on.
		try {
			await approveProposal(project, proposal, { proposalId, proposalRevision, mainRevision });
		} catch (cause) {
			if (cause instanceof ApprovalRecoveryBlocked) {
				console.error('[review] approval blocked:', cause);
				return fail(503, {
					message:
						'An earlier approval did not finish, so nothing more can be approved until it has. ' +
						'This needs whoever looks after Specman; the details are in its log.'
				});
			}
			if (cause instanceof StaleReview) {
				return fail(409, {
					message: 'The changes moved on while you were reading them. Look over them again, then approve.'
				});
			}
			if (cause instanceof UnrecordedChanges) {
				// Recorded now, rather than telling the user to "record another change"
				// — an instruction they had no way to follow.
				const recorded = await commitDocument(project, 'Record changes not yet in the history').then(
					() => true,
					(failure) => {
						console.error('[review] could not record the outstanding changes:', failure);
						return false;
					}
				);
				return fail(409, {
					message: recorded
						? 'Some of the latest changes had not been saved into the history. They have been now — ' +
							'look over them again, then approve.'
						: 'Some of the latest changes have not reached the history, and could not be added just now. ' +
							'Nothing was approved. Try again in a minute.'
				});
			}
			throw cause;
		}
		throw redirect(303, `/projects/${project.id}`);
	}
};
