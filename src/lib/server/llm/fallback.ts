/**
 * Which model is asked, and in what order.
 *
 * The primary gateway answers when it is configured. Gemini answers when it is
 * not, and when the primary fails before anything of its answer has been
 * passed on — after that, starting again elsewhere would repeat what the
 * reader already has, or feed a parser the same chapter twice.
 *
 * A primary that has just failed is left alone for a while. A turn makes
 * several calls, and each one waiting through the same failure before turning
 * to Gemini made the fallback slower than the outage. Running out of room is not
 * such a failure: the primary answered, and the request was too big for it.
 *
 * When both fail, the failure reported is the one the caller can act on. The
 * primary running out of room and then Gemini refusing its key was reported as
 * Gemini's refusal, "cannot be reached", so the callers that ask again with more
 * room or for less never did (found live, 2026-10-03).
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type Route = 'primary' | 'fallback';

/** How long a failed primary is passed over. */
export const PRIMARY_REST_MS = 120_000;

export class ModelRouting {
	private restingUntil = 0;
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	/** The providers to ask, in order. Empty when neither is configured. */
	order(primaryConfigured: boolean, fallbackConfigured: boolean): Route[] {
		if (!primaryConfigured) return fallbackConfigured ? ['fallback'] : [];
		if (!fallbackConfigured) return ['primary'];
		return this.resting() ? ['fallback', 'primary'] : ['primary', 'fallback'];
	}

	resting(): boolean {
		return this.now() < this.restingUntil;
	}

	/** A primary that ran out of room answered; only the request was too big for it. */
	failed(route: Route, cause?: unknown): void {
		if (route === 'primary' && !ranOutOfRoom(cause)) this.restingUntil = this.now() + PRIMARY_REST_MS;
	}

	succeeded(route: Route): void {
		if (route === 'primary') this.restingUntil = 0;
	}
}

/**
 * May a failed call be put to the next provider?
 *
 * Not once any of its answer was passed on, and not when the caller gave up on
 * it — an abandoned turn asked again elsewhere is work nobody is waiting for.
 */
export function mayAskNext(passedOn: boolean, abandoned: boolean): boolean {
	return !passedOn && !abandoned;
}

/**
 * Whether a call failed because its answer did not fit in the room it was
 * given. Both providers say so in these words; matched on them, as
 * `failures.ts` does, so this module needs no imports.
 */
export function ranOutOfRoom(cause: unknown): boolean {
	return /ran out of room/i.test(String((cause as { message?: unknown } | null)?.message ?? ''));
}

/**
 * Which of the failures of every provider asked, in the order they were asked,
 * the caller is told about: the first that ran out of room, because that one
 * says something about the request — ask for less, or give it more room — and
 * the caller can act on it; otherwise the last, as before. `causeOf` reads the
 * error from whatever each failure is recorded as.
 */
export function failureToReport<T>(failures: readonly T[], causeOf: (failure: T) => unknown = (failure) => failure): T {
	return failures.find((failure) => ranOutOfRoom(causeOf(failure))) ?? failures[failures.length - 1];
}
