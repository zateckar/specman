import { error } from '@sveltejs/kit';
import { getProject } from '$lib/server/db';
import { specInput } from '$lib/server/proposals';
import { buildSingleFile, buildSpecBundle } from '$lib/server/llm/export';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const input = specInput(project);

	return {
		project: { id: project.id, name: project.name },
		files: [...buildSpecBundle(input).keys()],
		single: buildSingleFile(input),
		problems: input.problems,
		requirementCount: input.requirements.filter((r) => r.scope === 'now').length,
		openQuestions: input.chapters
			.filter((c) => c.applicable !== 0)
			.reduce((sum, c) => sum + c.open_questions.length, 0),
		unconfirmed: input.decisions.filter((d) => d.source !== 'user' && d.status !== 'confirmed')
			.length
	};
};
