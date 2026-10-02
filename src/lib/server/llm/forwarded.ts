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
 * nothing else can reach the port. Both live in the deployment, not here:
 * turning proxy sign-in on is the operator saying they hold.
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
 * The address a sign-in attempt is held against.
 *
 * Behind a proxy every caller arrives from the proxy's address, so failed
 * attempts were counted against one address for the whole company: six wrong
 * passwords for `admin` from anyone locked out the administrator's sign-in for
 * everyone. With proxy sign-in on, the operator has said the proxy is the only
 * route here, so the last address it appended to `X-Forwarded-For` is the caller
 * it saw. With it off, nothing vouches for that header and it is ignored.
 */
export function attemptAddress(peer: string, forwardedFor: string | null, behindProxy: boolean): string {
	if (!behindProxy || !forwardedFor) return peer;
	const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean);
	return hops.at(-1) ?? peer;
}