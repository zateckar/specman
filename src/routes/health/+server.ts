import { json } from '@sveltejs/kit';
import { accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db } from '$lib/server/db';
import { config } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Liveness and readiness, for whatever restarts this.
 *
 * Deliberately not `/health/llm`. That one is administrators-only and spends up
 * to twenty gateway calls against a quota the whole company shares — a probe
 * runs every few seconds, for ever, so pointing one at it would drain the quota
 * on nothing. This route makes no gateway call at all.
 *
 * `/health` is exempt from the session check in `hooks.server.ts`. It has to be:
 * a probe that needs credentials cannot be run by the thing whose job is to
 * restart the container.
 */
export const GET: RequestHandler = async () => {
	try {
		// Two checks, because one of them on its own is a lie.
		//
		// `SELECT 1` proves the handle is alive, and nothing more: SQLite keeps
		// the file open, so a query still answers long after the volume behind it
		// has gone away or been remounted read-only. That is precisely the failure
		// this probe exists for — the server goes on serving pages and silently
		// stops being able to store a word of what anyone says.
		//
		// So the directory is checked for writability too. Not the file: the write
		// that matters is SQLite creating its `-wal` and `-shm` alongside.
		db().prepare('SELECT 1').get();
		accessSync(dirname(resolve(process.cwd(), config.databasePath)), constants.W_OK);
	} catch (cause) {
		return json(
			{ ok: false, storage: cause instanceof Error ? cause.message : String(cause) },
			{ status: 503 }
		);
	}

	return json({ ok: true, storage: 'ready' });
};
