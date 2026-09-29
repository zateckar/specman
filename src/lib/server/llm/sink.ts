/**
 * Delivering a turn's events to the browser, without the turn depending on the
 * browser still being there.
 *
 * A turn streams its events as it works: text, then the chapter it rewrote, the
 * requirements it settled, the decisions it recorded, the commit that stored
 * them. Writing straight to the stream controller ties those two things
 * together, because enqueueing to a cancelled stream throws — so closing the tab
 * mid-turn used to abort the work at whatever point it had reached. The user's
 * answer was already in the database; the chapter written from it was not.
 *
 * That is the shape the project has a rule about: an instruction that depends on
 * a future turn is a plan with no owner. "Send this again once they come back"
 * has no owner. So delivery is allowed to fail and the work is not: once the
 * browser is gone the events are counted and dropped, and the turn runs to the
 * end regardless.
 *
 * A failure to *serialise* an event is deliberately not caught here. That is a
 * bug in what we are sending, not a browser that left, and the two must not look
 * the same — one should be loud and the other is routine.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface TurnSink {
	/** Queue one event. Never throws because the browser went away. */
	send(event: string, data: unknown): void;
	/** The browser has gone; stop writing. Repeated calls are harmless. */
	disconnect(): void;
	/** False once the browser has gone. */
	readonly connected: boolean;
	/** Events the browser never received. */
	readonly dropped: number;
}

/**
 * One server-sent-events frame.
 *
 * `JSON.stringify` escapes newlines inside the payload, so a multi-line chapter
 * stays on the single `data:` line the framing requires.
 */
export function sseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSink(write: (frame: string) => void): TurnSink {
	let connected = true;
	let dropped = 0;

	return {
		get connected() {
			return connected;
		},
		get dropped() {
			return dropped;
		},

		disconnect() {
			connected = false;
		},

		send(event: string, data: unknown) {
			if (!connected) {
				dropped += 1;
				return;
			}

			// Built before the write is attempted: a payload that cannot be
			// serialised is our bug and should surface as one, not be mistaken for
			// a browser that left.
			const frame = sseFrame(event, data);

			try {
				write(frame);
			} catch {
				// Cancelled between the last write and this one — the tab closed and
				// `cancel` has not run yet, or will not.
				connected = false;
				dropped += 1;
			}
		}
	};
}
