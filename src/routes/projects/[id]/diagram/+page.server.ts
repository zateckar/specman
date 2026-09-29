import { error } from '@sveltejs/kit';
import { getProject, latestArchitecture } from '$lib/server/db';
import { layoutDiagram } from '$lib/server/llm/diagram';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const stored = latestArchitecture(project.id);

	return {
		project: { id: project.id, name: project.name },
		model: stored ?? null,
		diagram: stored
			? layoutDiagram({
					elements: stored.elements as any[],
					relations: stored.relations as any[]
				})
			: null
	};
};
