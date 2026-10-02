/**
 * Reading an identity a reverse proxy has already authenticated.
 *
 * Where Specman sits behind a proxy that authenticates against the company
 * directory, the proxy passes on who it let through:
 *
 *   X-Forwarded-User                 the account name it authenticated
 *   X-Forwarded-Email                their address
 *   X-Forwarded-Preferred-Username   the name they are known by, when it differs
 *
 * None of these is a credential. Each is a string the caller chose, and it is
 * only worth anything because the proxy overwrites whatever the client sent and
 * nothing else can reach the port. The first of those lives in the proxy's
 * configuration and cannot be checked from here; the second is what
 * `mayAssertIdentity` is for.
 *
 * Both functions are pure, so the rule that decides whether a caller may claim
 * to be someone is checked by `npm test` rather than by reasoning about it.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface ForwardedIdentity {
	/** The stable name this person is known by here. Lowercased. */
	username: string;
	/** What to show; falls back to the username. */
	displayName: string;
	email: string;
}

/**
 * The identity a set of headers asserts, or null when they assert none.
 *
 * `X-Forwarded-User` is the account the proxy authenticated and is therefore the
 * identity. A preferred username is a display matter — taking it as the account
 * name would let a directory rename move someone onto a different account here.
 */
export function readForwardedIdentity(
	header: (name: string) => string | null
): ForwardedIdentity | null {
	const user = (header('x-forwarded-user') ?? '').trim();
	if (!user) return null;

	const email = (header('x-forwarded-email') ?? '').trim();
	const preferred = (header('x-forwarded-preferred-username') ?? '').trim();

	return {
		username: user.toLowerCase(),
		displayName: preferred || user,
		email
	};
}

/**
 * May this caller assert an identity?
 *
 * With no trusted peers configured, anyone may — which is correct only while the
 * proxy is the sole route to the port, and is why the server warns on boot. With
 * a list configured, the peer must be on it.
 *
 * Matching is exact on the address as the runtime reports it. An IPv4 address
 * arriving mapped into IPv6 (`::ffff:10.0.0.4`) is compared unwrapped, because
 * that form is an artefact of the socket rather than something an operator
 * should have to know to write down.
 */
export function mayAssertIdentity(peer: string | null, trusted: string[]): boolean {
	if (trusted.length === 0) return true;
	if (!peer) return false;

	const candidates = new Set([peer, unwrapIpv4(peer)]);
	return trusted.some((entry) => {
		const value = entry.trim();
		return value.length > 0 && (candidates.has(value) || candidates.has(unwrapIpv4(value)));
	});
}

/**
 * The address a sign-in attempt is held against.
 *
 * Behind a proxy every caller arrives from the proxy's address, so failed
 * attempts were counted against one address for the whole company: six wrong
 * passwords for `admin` from anyone locked out the administrator's break-glass
 * sign-in for everyone. A peer on the trusted list is the proxy, and the last
 * address it appended to `X-Forwarded-For` is the caller it saw. Anyone else's
 * header is their own invention and is ignored.
 */
export function attemptAddress(peer: string, forwardedFor: string | null, trusted: string[]): string {
	if (trusted.length === 0 || !forwardedFor || !mayAssertIdentity(peer, trusted)) return peer;
	const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean);
	return hops.at(-1) ?? peer;
}

function unwrapIpv4(address: string): string {
	const bare = address.trim().replace(/^\[|\]$/g, '');
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
	return mapped ? mapped[1] : bare;
}
