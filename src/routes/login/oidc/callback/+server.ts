import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, createSession } from '$lib/server/auth';
import { OidcNameCollision, completeLogin, oidcEnabled } from '$lib/server/auth/oidc';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!oidcEnabled()) throw error(404, 'Single sign-on is not configured');

	const state = cookies.get('oidc_state');
	const verifier = cookies.get('oidc_verifier');
	if (!state || !verifier) throw error(400, 'Sign-in expired. Please try again.');

	cookies.delete('oidc_state', { path: '/' });
	cookies.delete('oidc_verifier', { path: '/' });

	let user;
	try {
		user = await completeLogin(url, state, verifier);
	} catch (cause) {
		console.error('[oidc] sign-in failed:', cause);
		// Worth telling apart: this one is not fixed by trying again, and the
		// person who has to act is an administrator, not the user standing here.
		if (cause instanceof OidcNameCollision) {
			throw error(
				409,
				'Someone already uses that name for a different account here. ' +
					'Ask an administrator to sort it out — signing in again will not help.'
			);
		}
		throw error(401, 'Single sign-on failed.');
	}

	cookies.set(SESSION_COOKIE, createSession(user.id), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 14
	});

	throw redirect(303, '/');
};
