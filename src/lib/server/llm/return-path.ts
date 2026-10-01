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

	return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
