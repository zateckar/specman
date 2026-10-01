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
		if (!id) return fail(400, { failed: id, message: 'Missing chapter id' });
		// A chapter removed since the page loaded is an answer, not a crash.
		const known = listTemplates().some((template) =>
			templateChapters(template.id).some((chapter) => chapter.id === id)
		);
		if (!known) return fail(400, { failed: id, message: 'That chapter is no longer there. Reload the page.' });

		const lines = (value: FormDataEntryValue | null) =>
			String(value ?? '')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);

		// Every new application copies these. A blank title is a chapter nobody can
		// find in the index; a blank purpose is a chapter the assistant has no
		// guidance for — both would be copied into every document from now on.
		const title = String(form.get('title') ?? '').trim();
		const purpose = String(form.get('purpose') ?? '').trim();
		if (!title) return fail(400, { failed: id, message: 'A chapter needs a title.' });
		if (!purpose) return fail(400, { failed: id, message: 'A chapter needs a purpose — it is what the assistant works from.' });

		updateTemplateChapter(id, {
			title,
			goal: String(form.get('goal') ?? '').trim(),
			purpose,
			questions: lines(form.get('questions')),
			criteria: lines(form.get('criteria'))
		});

		return { saved: id };
	}
};
