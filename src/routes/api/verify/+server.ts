import { error, json } from '@sveltejs/kit';
import {
	getProject,
	projectChapters,
	projectDecisions,
	projectRequirements,
	saveVerification
} from '$lib/server/db';
import { verifyDocument } from '$lib/server/llm/verification';
import { summariseIssues } from '$lib/server/llm/issues';
import { writeVerification } from '$lib/server/proposals';
import type { RequestHandler } from './$types';

/**
 * Check the whole document.
 *
 * Several gateway calls, so it runs on request rather than on every turn, and
 * the result is stored — re-reading a report should not cost what producing it
 * cost. Findings are advisory: they are never allowed to block approval.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId } = (await request.json()) as { projectId: number };

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');

	const result = await verifyDocument({
		chapters: projectChapters(project.id),
		requirements: projectRequirements(project.id),
		decisions: projectDecisions(project.id)
	});

	const saved = saveVerification(project.id, result.issues, result.checked);

	// Record it in the repository too, so the pull request carries the check.
	await writeVerification(project, result.issues, result.checked).catch((cause) => {
		console.error('[verify] could not record the check in version control:', cause);
	});

	return json({
		issues: result.issues,
		checked: result.checked,
		summary: summariseIssues(result.issues),
		assumptionsOutstanding: result.assumptionsOutstanding,
		created_at: saved.created_at
	});
};
