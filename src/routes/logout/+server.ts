import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';
import { config } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	const session = cookies.get(SESSION_COOKIE);
	if (session) destroySession(session);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	// Behind a proxy the session being ended is the proxy's, not ours. Sending
	// them to our own login page would sign them straight back in on the next
	// request, which looks like the button is broken.
	if (locals.viaProxy) {
		throw redirect(303, config.proxyAuthLogoutUrl ?? '/');
	}

	throw redirect(303, '/login');
};
