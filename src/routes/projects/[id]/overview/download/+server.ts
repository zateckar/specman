import { error } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { renderReport, reportFileName, reportHeaders } from '$lib/server/llm/overview';
import { overviewView } from '$lib/server/overviews';
import type { RequestHandler } from './$types';

/**
 * The overview as one HTML file, a report to pass on. Rendered now rather than
 * stored, so it says whether the document has changed since it was made.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const made = overviewView(project).made;
	if (!made) throw error(404, 'No overview has been made for this application yet');

	return new Response(renderReport(made.report), {
		headers: {
			...reportHeaders(),
			'content-disposition': `attachment; filename="${reportFileName(project.slug)}"`
		}
	});
};
