/**
 * What every model client shares: how a failure is described, how long silence
 * is allowed, how retries are spaced, and how a server-sent event stream is cut
 * into its payloads.
 *
 * Kept apart from the clients themselves so the primary gateway and the Gemini
 * fallback give up, retry and fail in the same words.
 */

export const MAX_ATTEMPTS = 4;

export class GatewayError extends Error {
	readonly status: number;
	readonly body: string;
	readonly retryable: boolean;
	constructor(message: string, status: number, body: string, retryable: boolean) {
		super(message);
		this.status = status;
		this.body = body;
		this.retryable = retryable;
		this.name = 'GatewayError';
	}
}

/**
 * A call that sent nothing for the whole idle limit. Its own class because a
 * client with somewhere else to turn should turn there, rather than waiting
 * through the same silence again.
 */
export class Stalled extends GatewayError {
	constructor(doing: 'answer' | 'continue', limit: number) {
		super(`The model did not ${doing} within ${Math.round(limit / 1000)} seconds.`, 504, '', true);
	}
}

/**
 * How long a model may go without sending anything.
 *
 * A reasoning model streams its thinking as it goes, so silence this long is a
 * backend that has stopped, not one that is thinking hard. Without a limit, a
 * stalled call held the turn — and the colleague's "writing" mark — for ever.
 */
function idleLimitMs(): number {
	const configured = Number(process.env.LLM_IDLE_TIMEOUT_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : 180_000;
}

/** `stop` abandons the request itself, so a stalled call does not linger after it is given up on. */
export async function withinIdleLimit<T>(work: Promise<T>, doing: 'answer' | 'continue', stop: () => void): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = idleLimitMs();
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			stop();
			reject(new Stalled(doing, limit));
		}, limit);
	});
	try {
		return await Promise.race([work, expired]);
	} finally {
		clearTimeout(timer);
	}
}

export function backoffMs(attempt: number): number {
	// 300ms, 900ms, 2.7s — with jitter so concurrent turns don't retry in lockstep.
	return Math.round(300 * 3 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Token counts as the Anthropic-shaped API reports them. */
export interface Usage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

/**
 * What a call cost, for the log: its output, and how much of its prompt the
 * gateway's prefix cache supplied. `input_tokens` counts only what was not
 * cached, so the prompt is the three added together. The cache serves a prompt
 * only as far as it starts the same as an earlier one, which is decided by how
 * the prompt is laid out; without this line nobody can see whether it does.
 */
export function describeUsage(usage: Usage | undefined, outputTokens = usage?.output_tokens ?? 0): string {
	const cached = usage?.cache_read_input_tokens ?? 0;
	const prompt = (usage?.input_tokens ?? 0) + cached + (usage?.cache_creation_input_tokens ?? 0);
	if (prompt === 0) return `${outputTokens} output tokens`;
	return `${outputTokens} output tokens; prompt ${prompt}, ${cached} of it cached (${Math.round((100 * cached) / prompt)}%)`;
}

/**
 * A streamed tool call's arguments, put together. Arguments that do not parse
 * are an empty object rather than a failed turn: the tool then answers that it
 * was not told what to do, and the model can ask again.
 */
export function toolInput(json: string): Record<string, unknown> {
	try {
		const value = JSON.parse(json.trim() || '{}');
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

/**
 * The `data:` payloads of a server-sent event stream, in order.
 *
 * A frame is complete only once its blank line has arrived; line endings are
 * normalised first, because a CRLF split across two reads is otherwise never
 * seen as a frame boundary at all.
 */
export async function* eventPayloads(body: ReadableStream<Uint8Array>, stop: () => void): AsyncIterable<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await withinIdleLimit(reader.read(), 'continue', stop);
			if (done) break;
			buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

			let split: number;
			while ((split = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, split);
				buffer = buffer.slice(split + 2);
				for (const line of frame.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (payload) yield payload;
				}
			}
		}
		// A last frame the server did not end with a blank line is still a frame.
		for (const line of buffer.split('\n')) {
			if (line.startsWith('data:') && line.slice(5).trim()) yield line.slice(5).trim();
		}
	} catch (cause) {
		await reader.cancel().catch(() => {});
		throw cause;
	} finally {
		reader.releaseLock();
	}
}
