import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	bootstrapAdmin,
	purgeExpiredSessions,
	reportProxyAuthPosture,
	userForProxyHeaders,
	userForSession
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { commitStartupMigrations, recoverPendingApprovals, relocateRepositories } from '$lib/server/proposals';

// Open the database and create the initial admin account on boot.
db();
bootstrapAdmin();
purgeExpiredSessions();
reportProxyAuthPosture();
relocateRepositories();

// Recover durable approvals before recording startup migrations. Reads may
// proceed meanwhile; each repository writer independently checks recovery too.
// Caught, because an unhandled rejection here ends the process on Node's
// default settings — and both steps are retried by the next writer anyway.
void recoverPendingApprovals()
	.then(() => commitStartupMigrations())
	.catch((cause) => console.error('[boot] could not finish recovery and startup commits:', cause));

const PUBLIC_ROUTES = ['/login', '/health'];

/** Exactly the path, or a path below it — never a route that merely starts with the same letters. */
function isPublic(pathname: string): boolean {
	return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * A write to the JSON endpoints from a page on another site.
 *
 * A second line, not the first. SvelteKit already refuses a cross-site post of
 * any type a browser sends without asking first — `text/plain` included, which
 * these endpoints would read as JSON — and any other type needs a preflight
 * this server never approves. Checked here as well because it matters more
 * than usual: behind the proxy the identity is added on the way in, whichever
 * page sent the request, so this rule should not rest on a content-type list or
 * on a framework option staying at its default. A browser names the origin of
 * every cross-site write, so one that names another is refused.
 */
function crossSiteWrite(request: Request, url: URL): boolean {
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
	const origin = request.headers.get('origin');
	return origin !== null && origin !== url.origin;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/') && crossSiteWrite(event.request, event.url)) {
		return new Response('Cross-site requests are not accepted.', { status: 403 });
	}

	// A session comes first: it exists only because someone signed in here on
	// purpose — with a password or the company account — and behind the proxy that
	// is how an administrator reaches the account that makes them one. Ending it
	// hands them back to whoever the proxy says they are.
	//
	// The proxy's assertion is re-read every request rather than turned into a
	// session: a session would have to be revalidated against the directory later
	// by something, and nothing would. Read this way, an account the directory
	// disables stops working here on the next request.
	const fromSession = userForSession(event.cookies.get(SESSION_COOKIE));
	const fromProxy = fromSession ? null : userForProxyHeaders((name) => event.request.headers.get(name));

	event.locals.user = fromSession ?? fromProxy;
	event.locals.viaProxy = fromProxy !== null;

	if (!event.locals.user && !isPublic(event.url.pathname)) {
		// An endpoint called by the page is told plainly; redirecting it answered
		// with the sign-in page, which the page read as a reply with nothing in it.
		if (event.url.pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ message: 'You have been signed out. Sign in again.' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}

	const response = await resolve(event);
	// Nothing here is meant to be shown inside another site's page, where a
	// click on "That's right" could be someone else's click. The one exception is
	// the mock-up, which Specman's own page shows: a response may keep framing by
	// this site, and nothing wider.
	try {
		if (response.headers.get('x-frame-options') !== 'SAMEORIGIN') response.headers.set('x-frame-options', 'DENY');
		if (!response.headers.has('content-security-policy')) {
			response.headers.set('content-security-policy', "frame-ancestors 'none'");
		}
	} catch {
		// A response with immutable headers is one we did not build; leave it be.
	}
	return response;
};
