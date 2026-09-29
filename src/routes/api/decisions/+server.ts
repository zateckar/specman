import { error, json } from '@sveltejs/kit';
import { confirmDecision, deleteDecision, getDecision, getProject } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Confirming or discarding a decision the assistant made on the user's behalf.
 *
 * Only the user can do this — that is the entire point of recording the source.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId, id, action } = (await request.json()) as {
		projectId: number;
		id: number;
		action: 'confirm' | 'discard';
	};

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');

	const decision = getDecision(id);
	if (!decision || decision.project_id !== project.id) throw error(404, 'No such decision');

	if (action === 'discard') {
		deleteDecision(project.id, id);
		return json({ id, discarded: true });
	}

	return json(confirmDecision(project.id, id));
};
