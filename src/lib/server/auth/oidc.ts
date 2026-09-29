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

function configuration(): Promise<client.Configuration> {
	if (!oidcEnabled()) throw new Error('OIDC is not configured');
	discovered ??= client.discovery(
		new URL(config.oidcIssuer!),
		config.oidcClientId!,
		config.oidcClientSecret!
	);
	return discovered;
}

export function redirectUri(): string {
	return `${config.publicUrl.replace(/\/$/, '')}/login/oidc/callback`;
}

export async function authorizationUrl(state: string, codeVerifier: string): Promise<string> {
	const cfg = await configuration();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

	return client
		.buildAuthorizationUrl(cfg, {
			redirect_uri: redirectUri(),
			scope: 'openid profile email',
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			state
		})
		.toString();
}

/**
 * A company account whose name collides with a local password account.
 *
 * Distinct from an ordinary sign-in failure because the operator's fix is
 * different: this one is resolved by renaming or removing the local account, not
 * by trying again.
 */
export class OidcNameCollision extends Error {
	constructor(readonly username: string) {
		super(
			`A local account named "${username}" already exists and signs in with a password. ` +
				'Refusing to adopt it from single sign-on.'
		);
		this.name = 'OidcNameCollision';
	}
}

/** Completes the flow and maps the OIDC subject onto a local user. */
export async function completeLogin(
	currentUrl: URL,
	expectedState: string,
	codeVerifier: string
): Promise<User> {
	const cfg = await configuration();

	const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
		pkceCodeVerifier: codeVerifier,
		expectedState
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
	// So a name match is adopted only when the local account has no password of
	// its own, which is to say it was provisioned by this very flow and is being
	// re-linked. An account that can be signed into with a password belongs to
	// whoever knows that password, and is never taken over from here.
	const local = db()
		.prepare('SELECT id, password_hash FROM users WHERE username = ?')
		.get(username) as { id: number; password_hash: string | null } | undefined;

	if (local?.password_hash) throw new OidcNameCollision(username);

	let userId = local?.id;

	if (!userId) {
		// Always an ordinary user. Company sign-in establishes who someone is; it
		// does not say what they may do here. Administrator rights are granted by
		// an administrator, on the people page, and never arrive in a token.
		db()
			.prepare(
				`INSERT INTO users (username, display_name, is_admin, created_via)
				 VALUES (?, ?, 0, 'oidc')`
			)
			.run(username, displayName);
		userId = (db().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
		console.info(`[oidc] registered "${username}" as a new user`);
	}

	db()
		.prepare('INSERT OR IGNORE INTO oidc_identities (user_id, issuer, subject) VALUES (?, ?, ?)')
		.run(userId, issuer, subject);

	return getUser(userId)!;
}
