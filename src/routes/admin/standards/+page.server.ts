import { error, fail } from '@sveltejs/kit';
import { listStandards, updateStandard } from '$lib/server/db';
import { CONDITIONS, readConditions } from '$lib/server/llm/profile';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');
	return { standards: listStandards(), conditions: CONDITIONS.join(', ') };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!locals.user?.is_admin) throw error(403, 'Administrators only');

		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { message: 'Which standard?' });
		// A standard deleted or renumbered since the page loaded is an answer,
		// not a crash.
		if (!listStandards().some((standard) => standard.id === id)) {
			return fail(400, { message: 'That standard is no longer there. Reload the page.' });
		}

		const statement = String(form.get('statement') ?? '').trim();
		if (!statement) return fail(400, { message: 'A standard needs wording.' });

		const read = readConditions(String(form.get('appliesWhen') ?? ''));
		if ('unknown' in read) {
			return fail(400, {
				message: `“${read.unknown.join('”, “')}” is not a condition. Use any of: ${CONDITIONS.join(', ')}.`
			});
		}

		updateStandard(id, {
			statement,
			active: form.get('active') === 'on',
			appliesWhen: read.conditions
		});

		return { saved: true };
	}
};
