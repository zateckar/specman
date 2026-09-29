import { error, fail } from '@sveltejs/kit';
import { listStandards, updateStandard } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');
	return { standards: listStandards() };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!locals.user?.is_admin) throw error(403, 'Administrators only');

		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { message: 'Which standard?' });

		const statement = String(form.get('statement') ?? '').trim();
		if (!statement) return fail(400, { message: 'A standard needs wording.' });

		updateStandard(id, {
			statement,
			active: form.get('active') === 'on',
			appliesWhen: String(form.get('appliesWhen') ?? 'always')
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
		});

		return { saved: true };
	}
};
