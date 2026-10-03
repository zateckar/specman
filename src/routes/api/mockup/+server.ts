import { error, json } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { isDrafting, modelConfigured, STILL_DRAFTING } from '$lib/server/drafting';
import { mockupInput, mockupView, startMockup, stopMockup } from '$lib/server/mockups';
import type { RequestHandler } from './$types';

/** Where making a mock-up stands. Polled by the mock-up page while one is being made. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const project = getProject(Number(url.searchParams.get('project')));
	if (!project) throw error(404, 'No such project');
	return json(mockupView(project));
};

/**
 * Start making a mock-up, and return at once: the server finishes it whether or
 * not the page is still open. One already being made is followed, not doubled.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const { projectId } = (await request.json()) as { projectId: number };
	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	// A mock-up of half a document would be kept as the application's.
	if (isDrafting(project.id)) throw error(409, STILL_DRAFTING);
	if (!modelConfigured()) throw error(503, 'The assistant is not available here, so it cannot make a mock-up.');

	if (!mockupView(project).running) {
		if (!mockupInput(project)) {
			throw error(
				422,
				'There is nothing written down to make a mock-up from yet. Try again once a few chapters have content.'
			);
		}
		startMockup(project);
	}
	return json(mockupView(project), { status: 202 });
};

/** Stop one being made: a click by mistake would otherwise hold a shared place for minutes. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const project = getProject(Number(url.searchParams.get('project')));
	if (!project) throw error(404, 'No such project');
	stopMockup(project.id, true);
	return json(mockupView(project));
};
