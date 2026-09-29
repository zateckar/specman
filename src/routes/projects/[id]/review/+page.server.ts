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

export const load: PageServerLoad = async ({ params }) => {
	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const proposal = openProposal(project.id);
	const reviewed = proposal ? await reviewRevision(project, proposal) : null;
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
		proposal: proposal ? { id: proposal.id, branch: proposal.branch, title: proposal.title } : null,
		reviewed,
		diff,
		changes,
		changeSummary: summariseDelta(changes),
		chapterTitles,
		pendingDecisions: decisions.filter((d) => d.source !== 'user' && d.status !== 'confirmed'),
		verification: latestVerification(project.id) ?? null,
		history: await log(project.repo_path, 15).catch(() => []),
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

		try {
			await approveProposal(project, proposal, { proposalId, proposalRevision, mainRevision });
		} catch (cause) {
			if (cause instanceof ApprovalRecoveryBlocked) return fail(503, { message: cause.message });
			if (cause instanceof StaleReview || cause instanceof UnrecordedChanges) return fail(409, { message: cause.message });
			throw cause;
		}
		throw redirect(303, `/projects/${project.id}`);
	}
};
