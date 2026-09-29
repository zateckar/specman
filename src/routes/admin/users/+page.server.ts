import { error, fail } from '@sveltejs/kit';
import { listUsers, setUserAdmin } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

/**
 * Who may use Specman, and who administers it.
 *
 * Company sign-in registers people here as ordinary users — it establishes who
 * someone is, not what they may do — so this page is where rights are granted.
 * Without it "an administrator assigns rights" would have nowhere to happen.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');

	return {
		me: locals.user.id,
		users: listUsers().map((user) => ({
			id: user.id,
			username: user.username,
			display_name: user.display_name,
			is_admin: user.is_admin === 1,
			hasPassword: user.has_password === 1,
			sso: user.sso === 1,
			createdVia: user.created_via,
			created_at: user.created_at
		}))
	};
};

export const actions: Actions = {
	rights: async ({ request, locals }) => {
		if (!locals.user?.is_admin) throw error(403, 'Administrators only');

		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { message: 'Which person?' });

		try {
			setUserAdmin(id, form.get('admin') === 'yes');
		} catch (cause) {
			// The only expected failure is removing the last administrator, which is
			// a rule rather than a fault — say so plainly instead of erroring out.
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not change that.' });
		}

		return { saved: true };
	}
};
