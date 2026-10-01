import { error, redirect } from '@sveltejs/kit';
import * as client from 'openid-client';
import { authorizationUrl, oidcEnabled } from '$lib/server/auth/oidc';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!oidcEnabled()) throw error(404, 'Single sign-on is not configured');

	const state = client.randomState();
	const codeVerifier = client.randomPKCECodeVerifier();
	const nonce = client.randomNonce();

	const options = {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		maxAge: 600
	};
	cookies.set('oidc_state', state, options);
	cookies.set('oidc_verifier', codeVerifier, options);
	cookies.set('oidc_nonce', nonce, options);

	throw redirect(303, await authorizationUrl(state, codeVerifier, nonce));
};
