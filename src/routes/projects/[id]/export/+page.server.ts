import { error } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { specInput } from '$lib/server/proposals';
import { buildSingleFile, buildSpecBundle, bundleSummary } from '$lib/server/llm/export';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const input = specInput(project);
	// The same counts the bundle's first page gives, from the same function.
	const summary = bundleSummary(input);

	return {
		project: { id: project.id, name: project.name },
		files: [...buildSpecBundle(input).keys()],
		single: buildSingleFile(input),
		problems: input.problems,
		requirementCount: summary.inScope.length,
		openQuestions: summary.openQuestions,
		unconfirmed: summary.assumed.length
	};
};
