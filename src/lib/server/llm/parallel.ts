/**
 * Running a handful of gateway calls at once, but not all of them.
 *
 * Checking a whole document in a single call is fragile here: context windows
 * vary by backend and are not published, so a document that fits today may not
 * fit tomorrow when the request is routed elsewhere. Splitting the work by
 * chapter keeps every call small, and a modest amount of concurrency keeps the
 * wait reasonable without flooding a shared corporate gateway.
 *
 * Results keep the order of the input, whatever order they finish in.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

/**
 * Map over `items`, running at most `limit` at a time.
 *
 * `fn` is expected to handle its own failures: one rejection aborts the whole
 * run, which is right for a bug and wrong for a flaky call, and this cannot tell
 * them apart. Callers doing gateway work should catch inside `fn` and return an
 * empty result, so one unlucky chapter does not lose the other eleven.
 */
export async function mapWithLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	if (items.length === 0) return results;

	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});

	await Promise.all(workers);
	return results;
}

/** A limit shared by callers that know nothing of each other. */
export interface Slots {
	/**
	 * Run `work` once fewer than the limit are running, in the order asked. Aborted
	 * while still waiting, it leaves the queue and rejects with the signal's reason.
	 */
	run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
	/** Running now. For tests and diagnostics. */
	readonly busy: number;
	/** Waiting for a slot. */
	readonly waiting: number;
}

/**
 * At most `limit` pieces of work at once, across every caller.
 *
 * `mapWithLimit` bounds one run. Drafts are started by different people at
 * different moments, each its own run, so five colleagues drafting at once was
 * fifteen long streams on a shared gateway — and everyone's conversation waited
 * behind them. A slot is handed straight to the next in line when one finishes,
 * so nobody can overtake the queue.
 *
 * Work given up while it waits leaves the queue at once. A deleted draft waits
 * for its job to settle, and its chapters queued behind other people's long
 * calls would otherwise hold the deletion until each got a slot only to return.
 */
export function createSlots(limit: number): Slots {
	const max = Math.max(1, limit);
	let busy = 0;
	const queue: Array<() => void> = [];
	const reason = (signal: AbortSignal) => signal.reason ?? new Error('Aborted');

	async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		if (signal?.aborted) throw reason(signal);
		if (busy < max) busy++;
		else {
			await new Promise<void>((resolve, reject) => {
				const onAbort = () => {
					const at = queue.indexOf(admit);
					if (at >= 0) queue.splice(at, 1);
					reject(reason(signal!));
				};
				const admit = () => {
					signal?.removeEventListener('abort', onAbort);
					resolve();
				};
				queue.push(admit);
				signal?.addEventListener('abort', onAbort, { once: true });
			});
		}
		try {
			return await work();
		} finally {
			const next = queue.shift();
			if (next) next();
			else busy--;
		}
	}

	return {
		run,
		get busy() {
			return busy;
		},
		get waiting() {
			return queue.length;
		}
	};
}

/**
 * The long streamed calls nobody is waiting on — drafted chapters, mock-ups and overviews —
 * three at a time across the whole installation, not per job. Each runs for
 * minutes on a shared gateway, and everyone's conversation waits behind them.
 */
export const longCalls = createSlots(3);
