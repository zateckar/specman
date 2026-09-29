import { fail, redirect } from '@sveltejs/kit';
import { createProject, defaultTemplate, listProjects, projectChapters, slugExists } from '$lib/server/db';
import { repoPathFor } from '$lib/server/git/repo';
import { toProfile } from '$lib/server/llm/profile';
import { countableChapters } from '$lib/server/llm/subchapters';
import { ensureWorkingProposal } from '$lib/server/proposals';
import type { Actions, PageServerLoad } from './$types';

function slugify(name: string): string {
	const base =
		name
			.toLowerCase()
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'app';

	let slug = base;
	let n = 2;
	while (slugExists(slug)) slug = `${base}-${n++}`;
	return slug;
}

export const load: PageServerLoad = async () => {
	const projects = listProjects().map((project) => {
		const chapters = projectChapters(project.id);
		// The same rule the chapter index uses, or the card and the index disagree
		// about the same document.
		const counted = countableChapters(chapters);
		return {
			id: project.id,
			name: project.name,
			description: project.description,
			created_at: project.created_at,
			total: counted.length,
			complete: counted.filter((c) => c.status === 'complete').length,
			open: chapters.reduce((sum, c) => sum + c.open_questions.length, 0)
		};
	});

	return { projects };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Give the application a name.' });

		// A few questions decide which chapters this application actually needs.
		// Unanswered means the cautious answer — see `toProfile`.
		const profile = toProfile({
			reach: String(form.get('reach') ?? ''),
			personalData: form.get('personalData') !== 'no',
			critical: form.get('critical') === 'yes'
		});

		const slug = slugify(name);
		const project = createProject({
			name,
			description,
			ownerId: locals.user.id,
			templateId: defaultTemplate().id,
			slug,
			repoPath: repoPathFor(slug),
			profile,
			kind: form.get('kind') === 'change' ? 'change' : 'new'
		});

		// Create the repository and its first working branch up front, so the
		// first conversation turn doesn't pay for it.
		await ensureWorkingProposal(project);

		throw redirect(303, `/projects/${project.id}`);
	}
};
