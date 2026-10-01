/**
 * Failed sign-in attempts, so a password cannot be guessed at the speed of the network.
 *
 * Keyed on the caller's address and the name tried together. Keying on the name
 * alone would let anyone lock a colleague out by guessing badly on purpose;
 * keying on the address alone would let one office behind a shared address lock
 * out the rest. A few free attempts, then a wait that doubles with each further
 * failure up to a ceiling, and a success forgets the history.
 *
 * Kept in memory. A restart forgets it, which costs an attacker a restart they
 * cannot cause, and a table for this would outlive its purpose.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const LONGEST_WAIT_MS = 15 * 60_000;

interface Record {
	failures: number;
	until: number;
}

export class SignInAttempts {
	private readonly records = new Map<string, Record>();
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	private key(address: string, username: string): string {
		return `${address}\u0000${username.toLowerCase()}`;
	}

	/** Milliseconds the caller must still wait, or 0 if they may try. */
	waitFor(address: string, username: string): number {
		const record = this.records.get(this.key(address, username));
		if (!record) return 0;
		return Math.max(0, record.until - this.now());
	}

	failed(address: string, username: string): void {
		const key = this.key(address, username);
		const record = this.records.get(key) ?? { failures: 0, until: 0 };
		record.failures += 1;
		const over = record.failures - FREE_ATTEMPTS;
		record.until = over < 0 ? 0 : this.now() + Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** over);
		this.records.set(key, record);
		this.prune();
	}

	succeeded(address: string, username: string): void {
		this.records.delete(this.key(address, username));
	}

	/** Bounded memory: records whose wait has passed and that carry no penalty yet go first. */
	private prune(): void {
		if (this.records.size < 10_000) return;
		const now = this.now();
		for (const [key, record] of this.records) {
			if (record.until <= now) this.records.delete(key);
		}
	}
}
