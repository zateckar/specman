import { error, fail } from '@sveltejs/kit';
import { defaultTemplate, listTemplates, templateChapters, updateTemplateChapter } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');

	const templates = listTemplates();
	const selectedId = Number(url.searchParams.get('template') ?? '') || defaultTemplate().id;
	const selected = templates.find((t) => t.id === selectedId) ?? templates[0];

	return {
		templates,
		selected,
		chapters: templateChapters(selected.id)
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!locals.user?.is_admin) throw error(403, 'Administrators only');

		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { message: 'Missing chapter id' });

		const lines = (value: FormDataEntryValue | null) =>
			String(value ?? '')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);

		updateTemplateChapter(id, {
			title: String(form.get('title') ?? '').trim(),
			goal: String(form.get('goal') ?? '').trim(),
			purpose: String(form.get('purpose') ?? '').trim(),
			questions: lines(form.get('questions')),
			criteria: lines(form.get('criteria'))
		});

		return { saved: id };
	}
};
