import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, createSession, login } from '$lib/server/auth';
import { config } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(303, '/');
	return {
		oidcAvailable: Boolean(config.oidcIssuer && config.oidcClientId),
		next: safeNext(url.searchParams.get('next') ?? '/')
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const next = String(form.get('next') ?? '/');

		if (!username || !password) {
			return fail(400, { message: 'Enter your username and password.', username });
		}

		const user = login(username, password);
		if (!user) {
			return fail(401, { message: 'That username and password did not match.', username });
		}

		cookies.set(SESSION_COOKIE, createSession(user.id), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 14
		});

		throw redirect(303, safeNext(next));
	}
};

/**
 * Where to go after signing in.
 *
 * `startsWith('/')` alone is not enough: `//evil.com` passes it and is a
 * scheme-relative URL, which SvelteKit puts in the `Location` header verbatim.
 * The moment just after a successful sign-in is the most credible one in which
 * to land someone on another site, so anything that is not a plain path on this
 * host goes to the front page instead.
 */
function safeNext(next: string): string {
	return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}
