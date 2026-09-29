import { error, redirect } from '@sveltejs/kit';
import {
	getProject,
	latestVerification,
	projectChapters,
	projectDecisions,
	projectRequirements
} from '$lib/server/db';
import { approveProposal, listProposals, openProposal, proposalDiff } from '$lib/server/proposals';
import { log, manifestOnMain } from '$lib/server/git/repo';
import { requirementDelta, summariseDelta, type ManifestRequirement } from '$lib/server/llm/delta';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const proposal = openProposal(project.id);
	const diff = proposal ? await proposalDiff(project, proposal) : '';

	// What changed, as rules rather than as lines. Both sides come from the
	// manifest the repository already carries, so this costs no model call.
	const before = await manifestOnMain(project.repo_path);
	const changes = requirementDelta(
		(before?.requirements ?? []) as ManifestRequirement[],
		projectRequirements(project.id).map((r) => ({
			ref: r.ref,
			chapter: r.chapter_key,
			scope: r.scope,
			statement: r.statement,
			scenarios: r.scenarios
		}))
	);

	const chapterTitles = Object.fromEntries(projectChapters(project.id).map((c) => [c.key, c.title]));
	const decisions = projectDecisions(project.id);

	return {
		project: { id: project.id, name: project.name },
		proposal: proposal ? { id: proposal.id, branch: proposal.branch, title: proposal.title } : null,
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
	approve: async ({ params }) => {
		const project = getProject(Number(params.id));
		if (!project) throw error(404, 'No such application');

		const proposal = openProposal(project.id);
		if (!proposal) throw error(400, 'Nothing to approve');

		await approveProposal(project, proposal);
		throw redirect(303, `/projects/${project.id}`);
	}
};
