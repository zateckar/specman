import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, countUsers, getUser, getUserByUsername } from '../db';
import { config } from '../env';
import { mayAssertIdentity, readForwardedIdentity } from '../llm/forwarded';
import type { User } from '../db/types';

const SESSION_DAYS = 14;

function hash(password: string, salt: string): string {
	return scryptSync(password, salt, 64).toString('hex');
}

/**
 * The same hash off the event loop. A sign-in is the one place an
 * unauthenticated caller makes the server run scrypt, and the synchronous form
 * stalls every other request for as long as it takes.
 */
function hashAsync(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
	});
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
	const actual = await hashAsync(password, salt);
	const target = Buffer.from(expected, 'hex');
	return actual.length === target.length && timingSafeEqual(actual, target);
}

/** Hashed for a name that has no password, so its answer takes as long as a wrong one. */
const DECOY = { salt: randomBytes(16).toString('hex'), hash: randomBytes(64).toString('hex') };

export function createUser(args: {
	username: string;
	password: string;
	displayName?: string;
	isAdmin?: boolean;
}): User {
	const salt = randomBytes(16).toString('hex');
	db()
		.prepare(
			`INSERT INTO users (username, password_hash, password_salt, display_name, is_admin, created_via)
			 VALUES (?, ?, ?, ?, ?, 'password')`
		)
		.run(
			args.username,
			hash(args.password, salt),
			salt,
			args.displayName ?? args.username,
			args.isAdmin ? 1 : 0
		);
	return getUserByUsername(args.username)!;
}

/**
 * Creates the admin account on first boot from ADMIN_PASSWORD.
 * No-op once any user exists, so the password is not a permanent backdoor.
 */
export function bootstrapAdmin(): void {
	if (countUsers() > 0) return;

	const password = config.adminPassword;
	if (!password) {
		console.warn('[auth] no users and ADMIN_PASSWORD unset — cannot bootstrap an admin account');
		return;
	}

	createUser({ username: 'admin', password, displayName: 'Administrator', isAdmin: true });
	console.info('[auth] created initial admin account "admin"');
}

/**
 * The account a name and password sign in to, or null.
 *
 * An unknown name, or one with no password, still costs a full hash. Answering
 * those at once would tell anyone timing the reply which names exist.
 */
export async function login(username: string, password: string): Promise<User | null> {
	const user = getUserByUsername(username);
	if (!user?.password_hash || !user.password_salt) {
		await verifyPassword(password, DECOY.salt, DECOY.hash);
		return null;
	}
	if (!(await verifyPassword(password, user.password_salt, user.password_hash))) return null;
	return user;
}

export function createSession(userId: number): string {
	const id = randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
	db().prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
		id,
		userId,
		expires
	);
	return id;
}

export function userForSession(sessionId: string | undefined): User | null {
	if (!sessionId) return null;

	const row = db()
		.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
		.get(sessionId) as { user_id: number; expires_at: string } | undefined;
	if (!row) return null;

	if (new Date(row.expires_at).getTime() < Date.now()) {
		destroySession(sessionId);
		return null;
	}

	return getUser(row.user_id) ?? null;
}

export function destroySession(sessionId: string): void {
	db().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Clear out sessions that have expired.
 *
 * Until now a session row was deleted only when its owner came back and presented
 * it, so the rows for everyone who simply stopped visiting stayed for ever. They
 * grant nothing — `userForSession` checks the expiry — but a table of dead
 * credentials is a thing worth not keeping.
 *
 * Run at boot. There is no scheduler here, and adding one for a table this size
 * would be more moving parts than the problem.
 */
export function purgeExpiredSessions(): void {
	const result = db()
		// Compared in the form the expiry is written in. `datetime('now')` has a
		// space where an ISO time has a `T`, and as text every session due to
		// expire later today sorted after it, so a day's expiries were missed.
		.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
		.run();
	const gone = Number(result.changes ?? 0);
	if (gone > 0) console.info(`[auth] removed ${gone} expired session(s)`);
}

export const SESSION_COOKIE = 'specman_session';

/* ------------------------------------------------- behind a reverse proxy */

/**
 * The user a proxy-authenticated request is for, registering them on first sight.
 *
 * No session is created. The proxy's assertion is re-read on every request, so
 * someone the directory disables stops being signed in at once rather than when
 * a cookie we minted happens to expire. A session would have to be revalidated
 * later by something, and "later, by something" is the shape this codebase has a
 * rule against.
 *
 * Returns null whenever the request asserts nothing, is not allowed to assert
 * it, or names an account that signs in another way — with a password or through
 * company sign-in. A proxy header is a string the caller chose, and a matching
 * name is not proof of anything.
 */
export function userForProxyHeaders(
	header: (name: string) => string | null,
	peer: string | null
): User | null {
	if (!config.proxyAuthEnabled) return null;

	const identity = readForwardedIdentity(header);
	if (!identity) return null;

	if (!mayAssertIdentity(peer, config.proxyAuthTrustedIps)) {
		console.warn(
			`[proxy-auth] refused "${identity.username}" asserted by ${peer ?? 'an unknown peer'}` +
				' — not in PROXY_AUTH_TRUSTED_IPS'
		);
		return null;
	}

	const local = db()
		.prepare(
			`SELECT id, password_hash, created_via,
			        EXISTS (SELECT 1 FROM oidc_identities o WHERE o.user_id = users.id) AS linked
			   FROM users WHERE username = ?`
		)
		.get(identity.username) as
		| { id: number; password_hash: string | null; created_via: string; linked: number }
		| undefined;

	if (local?.password_hash) {
		// Same rule as company sign-in: never take over an account somebody holds
		// a password for. Otherwise a header naming "admin" is the whole system.
		console.warn(
			`[proxy-auth] refused "${identity.username}" — a local password account already uses that name`
		);
		return null;
	}

	if (local && (local.linked || local.created_via === 'oidc')) {
		// The mirror of company sign-in refusing a proxy account's name: this
		// account belongs to an issuer and subject, and a header carrying the same
		// string is not that subject.
		console.warn(
			`[proxy-auth] refused "${identity.username}" — that name belongs to a company sign-in account`
		);
		return null;
	}

	if (local) {
		// An account registered before `created_via` existed has nothing recorded,
		// and nothing about the row can say where it came from afterwards. Watching
		// it arrive through the gateway is the one moment that can, so take it —
		// otherwise the people page goes on calling these accounts unable to sign
		// in for as long as the installation lives.
		if (local.created_via === '') {
			db().prepare(`UPDATE users SET created_via = 'proxy' WHERE id = ?`).run(local.id);
		}
		return withheldRights(getUser(local.id) ?? null);
	}

	// Registered as an ordinary user, exactly as company sign-in does. What
	// someone may do here is granted on the people page, never asserted by a
	// header.
	db()
		.prepare(
			`INSERT INTO users (username, display_name, is_admin, created_via)
			 VALUES (?, ?, 0, 'proxy')`
		)
		.run(identity.username, identity.displayName);
	const id = (db().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
	console.info(`[proxy-auth] registered "${identity.username}" as a new user`);

	return getUser(id) ?? null;
}

/**
 * The user as a header may present them.
 *
 * With no trusted peers configured, anyone who can reach the port can send the
 * header, so naming a colleague who was later made an administrator would be
 * the whole system. Rights granted on the people page are honoured through the
 * header only once the server can check who sent it; until then that colleague
 * works here as an ordinary user, and the bootstrap password still gets an
 * administrator in.
 */
function withheldRights(user: User | null): User | null {
	if (!user || !user.is_admin || config.proxyAuthTrustedIps.length > 0) return user;
	return { ...user, is_admin: 0 };
}

/**
 * Says once, at boot, what the configuration actually trusts.
 *
 * An operator who has not set `PROXY_AUTH_TRUSTED_IPS` has decided — usually
 * without knowing it — that any caller who can reach the port may claim to be
 * any user. That is correct behind a proxy and catastrophic in front of one, and
 * the difference is invisible from inside the application.
 */
export function reportProxyAuthPosture(): void {
	if (!config.proxyAuthEnabled) {
		console.info('[proxy-auth] disabled — X-Forwarded-User is ignored');
		return;
	}

	const trusted = config.proxyAuthTrustedIps;
	if (trusted.length > 0) {
		console.info(`[proxy-auth] enabled, trusting ${trusted.length} peer(s): ${trusted.join(', ')}`);
		return;
	}

	console.warn(
		'[proxy-auth] enabled with NO trusted peers configured. Any caller that can reach this ' +
			'port may sign in as any account the proxy registered, and register new ones, by ' +
			'sending X-Forwarded-User. Administrator rights are not honoured through the header ' +
			'until the sender can be checked, so administrators must use a password or company ' +
			'sign-in. This is only safe if a reverse proxy is the sole route here and it overwrites ' +
			'that header. Set PROXY_AUTH_TRUSTED_IPS, or PROXY_AUTH_ENABLED=false if there is no proxy.'
	);
}
