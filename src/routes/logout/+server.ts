import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Ends this site's session, if there is one, and goes to the sign-in page.
 *
 * Behind the proxy that page is where a colleague switches account: it names
 * who the gateway signed them in as, offers to carry on as that, and offers the
 * password form — the only way an administrator reached through the proxy gets
 * to the account that makes them one. The proxy's own session is the proxy's;
 * the sign-in page links to its sign-out where one is configured.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	const session = cookies.get(SESSION_COOKIE);
	if (session) destroySession(session);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	throw redirect(303, '/login');
};
