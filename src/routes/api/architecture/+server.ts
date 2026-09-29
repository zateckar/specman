import { error, json } from '@sveltejs/kit';
import {
	getProject,
	projectChapters,
	projectRequirements,
	saveArchitecture
} from '$lib/server/db';
import { deriveArchitecture } from '$lib/server/llm/architect';
import { layoutDiagram } from '$lib/server/llm/diagram';
import type { RequestHandler } from './$types';

/**
 * Derive the layered model and return it laid out.
 *
 * One gateway call, so it runs on request rather than on every turn, and the
 * model is stored — the picture only changes when the document does.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId } = (await request.json()) as { projectId: number };

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');

	const model = await deriveArchitecture({
		project: { name: project.name, description: project.description },
		chapters: projectChapters(project.id),
		requirements: projectRequirements(project.id)
	});

	saveArchitecture(project.id, model.elements, model.relations);

	return json({
		elements: model.elements,
		relations: model.relations,
		diagram: layoutDiagram(model)
	});
};
