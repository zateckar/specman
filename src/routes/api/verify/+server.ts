import { error, json } from '@sveltejs/kit';
import {
	getProject,
	documentRevision,
	DocumentConflict,
	projectChapters,
	projectDecisions,
	projectRequirements
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
	const revision = documentRevision(project.id);

	const result = await verifyDocument({
		chapters: projectChapters(project.id),
		requirements: projectRequirements(project.id),
		decisions: projectDecisions(project.id)
	});

	// Publish only if the input document still exists at the captured revision.
	let saved;
	try {
		saved = await writeVerification(project, result.issues, result.checked, result.failed, revision);
	} catch (cause) {
		if (cause instanceof DocumentConflict) throw error(409, 'The document changed during the check. Run it again to check the current document.');
		throw cause;
	}

	return json({
		issues: result.issues,
		checked: result.checked,
		failed: result.failed,
		stale: saved.stale,
		summary: saved.stale ? 'The document changed after this check. Run it again.' : result.failed.length
			? 'Check incomplete. ' + (result.issues.length ? summariseIssues(result.issues) : 'No findings from completed checks.')
			: summariseIssues(result.issues),
		assumptionsOutstanding: result.assumptionsOutstanding,
		created_at: saved.created_at
	});
};
