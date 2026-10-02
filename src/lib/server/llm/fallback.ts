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
 * to Gemini made the fallback slower than the outage.
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

	failed(route: Route): void {
		if (route === 'primary') this.restingUntil = this.now() + PRIMARY_REST_MS;
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
