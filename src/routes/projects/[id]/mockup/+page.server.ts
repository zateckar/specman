import { error } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { isDrafting, modelConfigured } from '$lib/server/drafting';
import { MOCKUP_SANDBOX } from '$lib/server/llm/mockup';
import { mockupView } from '$lib/server/mockups';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	return {
		project: { id: project.id, name: project.name },
		view: mockupView(project),
		drafting: isDrafting(project.id),
		canMake: modelConfigured(),
		// The frame's sandbox, from the same place as the response's.
		sandbox: MOCKUP_SANDBOX
	};
};
