import { error } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { isDrafting, modelConfigured } from '$lib/server/drafting';
import { overviewView } from '$lib/server/overviews';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	return {
		project: { id: project.id, name: project.name },
		view: overviewView(project),
		drafting: isDrafting(project.id),
		canMake: modelConfigured()
	};
};
