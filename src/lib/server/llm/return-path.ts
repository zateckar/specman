/**
 * Where to go after signing in.
 *
 * Checking the string is not enough. `//evil.com` names another host, and so does
 * `/<TAB>/evil.com`: a tab is legal in a header, and the URL parser every browser
 * uses drops tabs and newlines before it resolves, so the second arrives as the
 * first. Rather than list the shapes, the destination is resolved the way the
 * browser will resolve it and kept only if it stays on this host. The moment just
 * after a successful sign-in is the most credible one in which to land someone on
 * another site.
 *
 * Staying on this host is not the end of it, because what is returned is a path the
 * browser resolves a second time. `/..//evil.com` resolves here to the path
 * `//evil.com`, which is on this host now and on another one once it is sent back
 * as a `Location`. So the path that comes out has to be one that cannot be read as
 * an address, too.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

const HERE = 'http://specman.invalid';

export function safeReturnPath(next: string | null | undefined): string {
	const requested = String(next ?? '');
	if (!requested.startsWith('/')) return '/';

	let resolved: URL;
	try {
		resolved = new URL(requested, HERE);
	} catch {
		return '/';
	}
	if (resolved.origin !== HERE) return '/';

	const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
	// The same test, applied to what will actually be sent.
	if (/^[/\\]{2}/.test(path) || new URL(path, HERE).origin !== HERE) return '/';
	return path;
}
