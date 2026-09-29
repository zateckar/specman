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
import { commitStartupMigrations } from '$lib/server/proposals';

// Open the database and create the initial admin account on boot.
db();
bootstrapAdmin();
purgeExpiredSessions();
reportProxyAuthPosture();

// Opening the database may migrate a document; the repository is a second copy of
// it and has to be told. Not awaited — it is git I/O for the rare project that
// needed it, and nothing serving a request depends on it having finished.
void commitStartupMigrations();

const PUBLIC_ROUTES = ['/login', '/health'];

/** Exactly the path, or a path below it — never a route that merely starts with the same letters. */
function isPublic(pathname: string): boolean {
	return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export const handle: Handle = async ({ event, resolve }) => {
	// The proxy's assertion is read first and re-read every request. It is not
	// turned into a session on purpose: a session would have to be revalidated
	// against the directory later by something, and nothing would. Read this way,
	// an account the directory disables stops working here on the next request.
	//
	// The peer is whatever the platform reports as the client address. Behind one
	// proxy that is the proxy. If the deployment sets `ADDRESS_HEADER`, or puts
	// several hops in front, it is whatever that arrangement produces — which is
	// why `PROXY_AUTH_TRUSTED_IPS` is the operator's to get right and cannot be
	// worked out from in here.
	let peer: string | null = null;
	try {
		peer = event.getClientAddress();
	} catch {
		// adapter-node throws when it is told to read an address header that the
		// request does not carry. No address means no trusted peer.
	}

	const fromProxy = userForProxyHeaders((name) => event.request.headers.get(name), peer);

	event.locals.user = fromProxy ?? userForSession(event.cookies.get(SESSION_COOKIE));
	event.locals.viaProxy = fromProxy !== null;

	if (!event.locals.user && !isPublic(event.url.pathname)) {
		throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}

	return resolve(event);
};
