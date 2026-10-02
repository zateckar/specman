import * as client from 'openid-client';
import { db, getUser } from '../db';
import { config } from '../env';
import type { User } from '../db/types';

/**
 * Optional OIDC sign-in. Inert unless OIDC_ISSUER, OIDC_CLIENT_ID and
 * OIDC_CLIENT_SECRET are set, so local accounts keep working out of the box.
 */

export function oidcEnabled(): boolean {
	return Boolean(config.oidcIssuer && config.oidcClientId && config.oidcClientSecret);
}

let discovered: Promise<client.Configuration> | null = null;

/**
 * The issuer's configuration, discovered once and kept.
 *
 * Only a success is kept. A failed discovery — the directory briefly down when
 * the first person tried to sign in — used to be kept too, so company sign-in
 * failed for everyone until the server was restarted.
 */
function configuration(): Promise<client.Configuration> {
	if (!oidcEnabled()) throw new Error('OIDC is not configured');
	if (!discovered) {
		const attempt = client.discovery(
			new URL(config.oidcIssuer!),
			config.oidcClientId!,
			config.oidcClientSecret!
		);
		discovered = attempt;
		attempt.catch(() => {
			if (discovered === attempt) discovered = null;
		});
	}
	return discovered;
}

export function redirectUri(): string {
	return `${config.publicUrl.replace(/\/$/, '')}/login/oidc/callback`;
}

/**
 * Where to send the browser to sign in.
 *
 * The nonce ties the ID token to this attempt. PKCE already stops a stolen code
 * being redeemed elsewhere; the nonce stops a token issued for some other sign-in
 * being replayed into this one.
 */
export async function authorizationUrl(
	state: string,
	codeVerifier: string,
	nonce: string
): Promise<string> {
	const cfg = await configuration();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

	return client
		.buildAuthorizationUrl(cfg, {
			redirect_uri: redirectUri(),
			scope: 'openid profile email',
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			state,
			nonce
		})
		.toString();
}

/**
 * An unfamiliar company identity whose name is already in use.
 *
 * Distinct from an ordinary sign-in failure because the operator's fix is
 * different: this one is resolved by renaming or removing the local account, not
 * by trying again.
 */
export class OidcNameCollision extends Error {
	readonly username: string;
	constructor(username: string) {
		super(
			`An account named "${username}" already exists with a different identity. ` +
				'Refusing to adopt it from single sign-on.'
		);
		this.username = username;
		this.name = 'OidcNameCollision';
	}
}

/** Completes the flow and maps the OIDC subject onto a local user. */
export async function completeLogin(
	currentUrl: URL,
	expectedState: string,
	codeVerifier: string,
	expectedNonce: string
): Promise<User> {
	const cfg = await configuration();

	const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
		pkceCodeVerifier: codeVerifier,
		expectedState,
		expectedNonce
	});

	const claims = tokens.claims();
	if (!claims?.sub) throw new Error('OIDC response contained no subject');

	const issuer = String(claims.iss ?? config.oidcIssuer);
	const subject = String(claims.sub);
	const username =
		String(claims.preferred_username ?? claims.email ?? subject).toLowerCase();
	const displayName = String(claims.name ?? username);

	const existing = db()
		.prepare('SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?')
		.get(issuer, subject) as { user_id: number } | undefined;

	if (existing) {
		const user = getUser(existing.user_id);
		if (user) return user;
	}

	// The issuer and subject above are the only authoritative key. A matching
	// username is not: it is a string the directory happens to carry, and treating
	// it as proof of identity means whoever the directory calls "admin" inherits
	// the bootstrap administrator account — an account nobody granted them.
	//
	// Passwordless accounts also have owners. A recycled name or a name shared
	// with the proxy must not link a new subject to their permissions.
	const local = db()
		.prepare('SELECT id FROM users WHERE username = ?')
		.get(username);

	if (local) throw new OidcNameCollision(username);

	const database = db();
	database.exec('BEGIN');
	try {
		// Always an ordinary user. Company sign-in establishes who someone is; it
		// does not say what they may do here. Administrator rights are granted by
		// an administrator, on the people page, and never arrive in a token.
		db()
			.prepare(
				`INSERT INTO users (username, display_name, is_admin, created_via)
				 VALUES (?, ?, 0, 'oidc')`
			)
			.run(username, displayName);
		const userId = (database.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
		database
			.prepare('INSERT INTO oidc_identities (user_id, issuer, subject) VALUES (?, ?, ?)')
			.run(userId, issuer, subject);
		database.exec('COMMIT');
		console.info(`[oidc] registered "${username}" as a new user`);
		return getUser(userId)!;
	} catch (cause) {
		database.exec('ROLLBACK');
		throw cause;
	}
}
