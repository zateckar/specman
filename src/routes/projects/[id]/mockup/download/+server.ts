import { error } from '@sveltejs/kit';
import { getProject, latestMockup } from '$lib/server/db';
import { mockupFileName, mockupHeaders } from '$lib/server/llm/mockup';
import type { RequestHandler } from './$types';

/**
 * The mock-up as one HTML file, which opens in any browser with no network and
 * no build step. Sent with the same policy as when it is shown, for a browser
 * that displays it rather than saving it.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const stored = latestMockup(project.id);
	if (!stored) throw error(404, 'No mock-up has been made for this application yet');

	return new Response(stored.html, {
		headers: {
			...mockupHeaders(),
			'content-disposition': `attachment; filename="${mockupFileName(project.slug)}"`
		}
	});
};
