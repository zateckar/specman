/**
 * Reading the turn's event stream in the browser.
 *
 * The counterpart to `server/llm/sink.ts`, which writes these frames. Pulled out
 * of the chat component for two reasons: the turn is no longer owned by that
 * component — it belongs to the page, so that switching chapters cannot orphan
 * it — and frame splitting is the kind of thing that is either right or silently
 * loses half a reply, so it is worth testing on its own.
 *
 * A frame is only complete once its blank line has arrived. Anything after the
 * last one is handed back as `rest` to be prepended to the next chunk: a chapter
 * arrives across many reads, and a frame split down the middle must not be
 * parsed as two.
 */

export interface SseEvent {
	name: string;
	data: Record<string, unknown>;
}

export function readFrames(buffer: string): { events: SseEvent[]; rest: string } {
	const events: SseEvent[] = [];
	let rest = buffer;

	for (;;) {
		const split = rest.indexOf('\n\n');
		if (split === -1) break;

		const frame = rest.slice(0, split);
		rest = rest.slice(split + 2);

		let name = '';
		let raw = '';
		for (const line of frame.split('\n')) {
			if (line.startsWith('event:')) name = line.slice(6).trim();
			else if (line.startsWith('data:')) raw = line.slice(5).trim();
		}
		if (!name || !raw) continue;

		try {
			events.push({ name, data: JSON.parse(raw) as Record<string, unknown> });
		} catch {
			// A frame we cannot read is dropped rather than ending the stream: the
			// rest of the turn is still worth having.
		}
	}

	return { events, rest };
}
