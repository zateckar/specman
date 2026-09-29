import { error, json } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { presence } from '$lib/server/llm/presence';
import type { RequestHandler } from './$types';

/**
 * Say I am here, and find out who else is.
 *
 * Polled rather than pushed. A second event stream per open tab, held open for
 * as long as someone has the page up, would cost a connection each to tell them
 * something that changes every half minute — and this application already has
 * one long-lived stream per turn that matters more.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId } = (await request.json()) as { projectId: number };

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');

	const now = Date.now();
	presence.seen(project.id, locals.user.id, locals.user.display_name || locals.user.username, now);

	return json({ others: presence.others(project.id, locals.user.id, now) });
};
