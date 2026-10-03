import { error, json } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { draftView, isDrafting, modelConfigured, startDraft } from '$lib/server/drafting';
import { presence } from '$lib/server/llm/presence';
import type { RequestHandler } from './$types';

/**
 * How far a draft has got. Polled by the workspace while one runs, as presence
 * is, and for the same reason: a second long-lived stream per open tab to report
 * a count that changes once a minute.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const project = getProject(Number(url.searchParams.get('project')));
	if (!project) throw error(404, 'No such project');
	return json(draftView(project, locals.user));
};

/** Draft the rest: whatever applies and is still unwritten. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const { projectId } = (await request.json()) as { projectId: number };
	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	if (project.origin !== 'generated') throw error(400, 'This application was not drafted.');
	if (!modelConfigured()) throw error(503, 'The assistant is not available here, so it cannot draft anything.');

	// A turn running now compares the revision it began from; chapters landing
	// under it would have it refused after the person had waited for it.
	if (isDrafting(project.id) || presence.writing(project.id)) {
		throw error(409, 'The assistant is already writing in this document. Try again when it has finished.');
	}
	startDraft(project);
	return json(draftView(project, locals.user));
};
