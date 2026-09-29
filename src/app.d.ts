import type { User } from '$lib/server/db/types';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			/** True when the identity came from the reverse proxy rather than a session. */
			viaProxy: boolean;
		}
	}
}

export {};
