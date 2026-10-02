import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, createSession, login } from '$lib/server/auth';
import { config } from '$lib/server/env';
import { SignInAttempts } from '$lib/server/llm/attempts';
import { attemptAddress } from '$lib/server/llm/forwarded';
import { safeReturnPath } from '$lib/server/llm/return-path';
import type { Actions, PageServerLoad } from './$types';

const attempts = new SignInAttempts();

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(303, '/');
	return {
		oidcAvailable: Boolean(config.oidcIssuer && config.oidcClientId),
		next: safeReturnPath(url.searchParams.get('next') ?? '/')
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, locals }) => {
		// Someone already signed in — behind the proxy, that is every colleague —
		// has no password to try here, and their failed attempts were what could
		// lock the administrator out.
		if (locals.user) throw redirect(303, '/');

		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const next = String(form.get('next') ?? '/');

		if (!username || !password) {
			return fail(400, { message: 'Enter your username and password.', username });
		}

		const address = attemptAddress(
			getClientAddress(),
			request.headers.get('x-forwarded-for'),
			config.proxyAuthTrustedIps
		);
		const wait = attempts.waitFor(address, username);
		if (wait > 0) {
			const minutes = Math.ceil(wait / 60_000);
			return fail(429, {
				message: `Too many attempts. Wait ${minutes === 1 ? 'a minute' : `${minutes} minutes`} and try again.`,
				username
			});
		}

		const user = await login(username, password);
		if (!user) {
			attempts.failed(address, username);
			return fail(401, { message: 'That username and password did not match.', username });
		}
		attempts.succeeded(address, username);

		cookies.set(SESSION_COOKIE, createSession(user.id), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 14
		});

		throw redirect(303, safeReturnPath(next));
	}
};
