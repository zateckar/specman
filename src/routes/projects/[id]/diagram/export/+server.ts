import { error } from '@sveltejs/kit';
import { getProject, latestArchitecture, projectChapters } from '$lib/server/db';
import { slug } from '$lib/server/llm/architecture';
import { toOpenExchange } from '$lib/server/llm/archimate';
import { layoutDiagram } from '$lib/server/llm/diagram';
import type { RequestHandler } from './$types';

/**
 * The diagram as an ArchiMate Open Exchange File.
 *
 * Built from the stored model rather than from anything the browser holds, so
 * what downloads is what the document actually says. The layout is recomputed
 * here for the same reason: the file carries coordinates, and they should match
 * the picture on screen.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const stored = latestArchitecture(project.id);
	if (!stored) throw error(404, 'No diagram has been drawn for this application yet');

	const model = {
		elements: stored.elements as Parameters<typeof toOpenExchange>[0]['elements'],
		relations: stored.relations as Parameters<typeof toOpenExchange>[0]['relations']
	};

	const chapterTitles: Record<string, string> = {};
	for (const chapter of projectChapters(project.id)) chapterTitles[chapter.key] = chapter.title;

	const drawn = new Date(stored.created_at ?? '');
	const on = Number.isNaN(drawn.getTime()) ? '' : ` on ${drawn.toISOString().slice(0, 10)}`;

	const xml = toOpenExchange(model, layoutDiagram(model), {
		name: project.name,
		documentation:
			`Derived from the Specman design document for “${project.name}”${on}.` +
			' Every element and relation comes from something the document states.',
		viewName: 'How it fits together',
		chapterTitles
	});

	const name = slug(project.name) || 'architecture';

	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'content-disposition': `attachment; filename="${name}.archimate.xml"`
		}
	});
};
