import type { LayoutServerLoad } from './$types';

/**
 * The signed-in user, as the browser is allowed to see them.
 *
 * Listed field by field rather than returned whole. `locals.user` is a database
 * row, and a row gains columns — the credential columns were already on it once,
 * reaching every page's serialised payload without `svelte-check` seeing
 * anything wrong, because the cast said they were not there. Naming the fields
 * here means the next column added to `users` has to be named before it can
 * leave the server.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	return {
		user: user && {
			id: user.id,
			username: user.username,
			display_name: user.display_name,
			is_admin: user.is_admin
		}
	};
};
