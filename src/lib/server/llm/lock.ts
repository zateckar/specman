/**
 * One writer at a time, per key.
 *
 * A repository has one working tree, and recording a turn is four steps — check
 * out the branch, write the files, stage them, commit. Nothing held the tree
 * across those steps, so two requests to the same application shared it while
 * each believed it was theirs: one turn's `git add .` swept up the other's
 * half-written files, and a turn overlapping an approval could commit to `main`,
 * which is the one thing the review step exists to prevent.
 *
 * This is the ordering. It is not the whole guard — see `commitAll`, which
 * states the branch it expects. Ordering prevents overlapping writers in this
 * process; the assertion detects some interference from outside it. This map
 * is per-process; that limitation is in `PLAN.md`.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface Locks {
	/** Run `work`, but not while anything else holds `key`. */
	run<T>(key: string, work: () => Promise<T>): Promise<T>;
	/** How many keys are held or queued. For tests and diagnostics. */
	readonly pending: number;
}

/**
 * @param timeoutMs How long one holder may take before its turn is failed. Zero
 *   disables it.
 *
 *   Timeout fails the caller without releasing ownership. Only settlement of
 *   work releases it: a timeout cannot cancel a git process mid-write. A truly
 *   stuck writer therefore blocks this key until recovery or server restart.
 */
export function createLocks(timeoutMs = 60_000): Locks {
	// The value is the tail of the queue for that key: a promise that settles
	// once everyone currently waiting has finished. It never rejects — a holder
	// that fails still releases — so one failure cannot wedge the key.
	const tails = new Map<string, Promise<void>>();

	async function run<T>(key: string, work: () => Promise<T>): Promise<T> {
		const previous = tails.get(key);

		let release!: () => void;
		const mine = new Promise<void>((resolve) => {
			release = resolve;
		});

		const tail = (previous ?? Promise.resolve()).then(() => mine);
		tails.set(key, tail);

		if (previous) await previous;

		const finish = () => {
			release();
			// Only if nobody queued behind us, or we would drop their place.
			if (tails.get(key) === tail) tails.delete(key);
		};
		// Promise scheduling also turns a synchronous throw into settlement.
		const completion = Promise.resolve().then(work);
		void completion.then(finish, finish);
		return withTimeout(completion, timeoutMs, key);
	}

	return {
		run,
		get pending() {
			return tails.size;
		}
	};
}

function withTimeout<T>(work: Promise<T>, ms: number, key: string): Promise<T> {
	if (!(ms > 0)) return work;

	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timed out after ${ms}ms waiting for work on "${key}" to finish`)),
			ms
		);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(cause) => {
				clearTimeout(timer);
				reject(cause);
			}
		);
	});
}
