import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader.
 *
 * We do not use `$env/static/private`, so that server-side scripts (health
 * checks, seeds) work without booting SvelteKit.
 *
 * Nothing about a particular gateway belongs in this file. Which models answer,
 * how requests are routed and which backends misbehave are all settings — they
 * live in `.env`, not in source, and not in the documentation either.
 */
function loadDotEnv(): void {
	const path = resolve(process.cwd(), '.env');
	if (!existsSync(path)) return;

	for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		const eq = line.indexOf('=');
		if (eq === -1) continue;

		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();

		// Strip matching surrounding quotes, if present.
		if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
			value = value.slice(1, -1);
		}

		// Real environment variables win over the file.
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

loadDotEnv();

export function env(key: string): string | undefined {
	const value = process.env[key];
	return value === undefined || value === '' ? undefined : value;
}

export function requireEnv(key: string): string {
	const value = env(key);
	if (value === undefined) {
		throw new Error(`Missing required environment variable: ${key}. See .env.example.`);
	}
	return value;
}

export const config = {
	/**
	 * Whether the primary gateway is set up at all. Without it, Gemini answers
	 * everything — an installation with only a Gemini key is a working one.
	 */
	get primaryConfigured() {
		return Boolean(env('LLM_URL') && env('LLM_API_KEY') && env('LLM_MODEL'));
	},
	get gatewayUrl() {
		return requireEnv('LLM_URL');
	},
	get gatewayKey() {
		return requireEnv('LLM_API_KEY');
	},
	/**
	 * Model used for structured (tool) calls. No default that names a real model
	 * group: an installation says what its own gateway calls things.
	 */
	get toolModel() {
		return requireEnv('LLM_MODEL');
	},
	/** Model used for prose. May emit `thinking` blocks, which the client strips. */
	get proseModel() {
		return env('LLM_PROSE_MODEL') ?? config.toolModel;
	},
	/**
	 * Extra substrings that mark a 400 from this gateway as worth retrying.
	 *
	 * Comma-separated. Empty by default, and empty is a safe default: the client
	 * already retries the two failures that are generic to this API shape. What
	 * goes here names a particular backend and its defect, which is an operator's
	 * business and not something to publish in a repository.
	 */
	get retryable400() {
		return (env('LLM_RETRYABLE_400') ?? '')
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
	},
	get geminiKey() {
		return env('GEMINI_API_KEY');
	},
	get geminiModel() {
		return env('GEMINI_MODEL') ?? 'gemini-flash-latest';
	},
	/** Google's API unless set; a company relay, or a stub in a test, can stand in. */
	get geminiBaseUrl() {
		return (env('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
	},
	get databasePath() {
		return env('DATABASE_PATH') ?? 'data/specman.db';
	},
	get adminPassword() {
		return env('ADMIN_PASSWORD');
	},
	get oidcIssuer() {
		return env('OIDC_ISSUER');
	},
	get oidcClientId() {
		return env('OIDC_CLIENT_ID');
	},
	get oidcClientSecret() {
		return env('OIDC_CLIENT_SECRET');
	},
	get publicUrl() {
		return env('PUBLIC_URL') ?? 'http://localhost:5173';
	},
	/**
	 * Accept an identity a reverse proxy has already authenticated. On unless
	 * explicitly switched off: the intended deployment always has a proxy in
	 * front, and an installation without one sends none of these headers, so the
	 * setting has no effect there.
	 */
	get proxyAuthEnabled() {
		return (env('PROXY_AUTH_ENABLED') ?? 'true').toLowerCase() !== 'false';
	},
	/** Where the proxy ends its own session, offered on the sign-in page when configured. */
	get proxyAuthLogoutUrl() {
		return env('PROXY_AUTH_LOGOUT_URL');
	}
};
