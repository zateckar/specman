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
