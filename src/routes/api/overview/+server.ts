import { error, json } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { isDrafting, modelConfigured, STILL_DRAFTING } from '$lib/server/drafting';
import { overviewInput, overviewView, startOverview, stopOverview } from '$lib/server/overviews';
import type { RequestHandler } from './$types';

/** Where making an overview stands. Polled by the overview page while one is being made. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const project = getProject(Number(url.searchParams.get('project')));
	if (!project) throw error(404, 'No such project');
	return json(overviewView(project));
};

/**
 * Start making an overview, and return at once: the server finishes it whether
 * or not the page is still open. One already being made is followed, not doubled.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const { projectId } = (await request.json()) as { projectId: number };
	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	// An overview of half a document would be kept as the application's.
	if (isDrafting(project.id)) throw error(409, STILL_DRAFTING);
	if (!modelConfigured()) throw error(503, 'The assistant is not available here, so it cannot make an overview.');

	if (!overviewView(project).running) {
		if (!overviewInput(project)) {
			throw error(
				422,
				'There is nothing written down to make an overview from yet. Try again once a few chapters have content.'
			);
		}
		startOverview(project);
	}
	return json(overviewView(project), { status: 202 });
};

/** Stop one being made: a click by mistake would otherwise hold a shared place for minutes. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const project = getProject(Number(url.searchParams.get('project')));
	if (!project) throw error(404, 'No such project');
	stopOverview(project.id, true);
	return json(overviewView(project));
};
