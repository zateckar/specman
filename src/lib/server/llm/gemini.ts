import { config } from '../env';
import { DEFAULT_BUDGET } from './budgets';
import { ending, geminiBody, geminiModelPath, geminiRetryable, geminiRoom, readGeminiPayload } from './gemini-format';
import { GatewayError, MAX_ATTEMPTS, backoffMs, eventPayloads, sleep, withinIdleLimit } from './transport';
import { textOf, type LlmProvider, type StreamEvent, type StreamRequest, type ToolRequest, type ToolResponse } from './types';

/**
 * Client for Google's Gemini API, the fallback behind the primary gateway.
 *
 * The same two call shapes, held to the same rules: a streamed answer is
 * complete only when Gemini says how it finished, retries happen only before
 * anything has been passed on, and an answer that spent the whole budget on
 * reasoning is a failure rather than an empty answer.
 *
 * The model is always `GEMINI_MODEL`. A caller naming a model names one of the
 * primary gateway's, which Gemini has never heard of.
 */

/** Truncation inside a tool call is as fatal here as on the gateway. */
const MIN_TOOL_MAX_TOKENS = 1500;

function endpoint(method: 'streamGenerateContent' | 'generateContent'): string {
	const url = `${config.geminiBaseUrl}/models/${geminiModelPath(config.geminiModel)}:${method}`;
	return method === 'streamGenerateContent' ? `${url}?alt=sse` : url;
}

async function post(url: string, body: unknown, signal: AbortSignal): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		headers: { 'x-goog-api-key': config.geminiKey ?? '', 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal
	});
}

/** A failed answer, in the error the rest of Specman already knows how to describe. */
function declined(reason: string, body: string): GatewayError {
	return reason === 'MAX_TOKENS'
		? new GatewayError('Gemini ran out of room before completing its response.', 200, body, false)
		: new GatewayError(`Gemini declined to answer (${reason}).`, 200, body, false);
}

export class GeminiProvider implements LlmProvider {
	readonly id = 'gemini';

	async *streamChat(req: StreamRequest): AsyncIterable<StreamEvent> {
		// Brought within Gemini's ceiling here too: running out is judged against
		// the room it was given, not the room the caller asked for.
		const maxTokens = geminiRoom(req.maxTokens ?? DEFAULT_BUDGET);
		// No tools here: Gemini is asked only when the gateway fails, and is given
		// any chapter already read as text in the conversation instead.
		const messages = req.messages.map((m) => ({ role: m.role, content: textOf(m.content) }));
		const body = geminiBody({ system: req.system, messages, maxTokens });

		for (let attempt = 1; ; attempt++) {
			let wrote = false;
			try {
				for await (const event of this.streamOnce(body, maxTokens, req.signal)) {
					if (event.type === 'text') wrote = true;
					yield event;
				}
				return;
			} catch (cause) {
				// A network failure is as transient as a 503; a refusal is not.
				const retryable = cause instanceof GatewayError ? cause.retryable : true;
				const again = retryable && !wrote && attempt < MAX_ATTEMPTS && !req.signal?.aborted;
				if (!again) throw cause;
				console.warn(
					`[gemini] stream attempt ${attempt}/${MAX_ATTEMPTS} failed before any text (retryable): ` +
						(cause instanceof Error ? cause.message : String(cause))
				);
				await sleep(backoffMs(attempt));
			}
		}
	}

	private async *streamOnce(body: unknown, maxTokens: number, signal?: AbortSignal): AsyncIterable<StreamEvent> {
		const own = new AbortController();
		const stop = () => own.abort();
		const res = await withinIdleLimit(
			post(endpoint('streamGenerateContent'), body, signal ? AbortSignal.any([signal, own.signal]) : own.signal),
			'answer',
			stop
		);
		if (!res.ok) {
			const text = await res.text();
			throw new GatewayError(`Gemini stream failed with ${res.status}`, res.status, text, geminiRetryable(res.status));
		}
		if (!res.body) throw new GatewayError('Gemini returned no response body', 200, '', true);

		let servedBy = config.geminiModel;
		let outputTokens = 0;
		let finish: string | null = null;
		let wrote = false;

		for await (const payload of eventPayloads(res.body, stop)) {
			let json: unknown;
			try {
				json = JSON.parse(payload);
			} catch {
				continue; // Ignore a malformed frame rather than killing the stream.
			}
			const part = readGeminiPayload(json);
			if (part.error) {
				throw new GatewayError(
					`Gemini interrupted its response: ${part.error.status || part.error.code}`,
					200,
					payload,
					geminiRetryable(part.error.code, part.error.status)
				);
			}
			if (part.model) servedBy = part.model;
			if (part.outputTokens !== null) outputTokens = part.outputTokens;
			if (part.thinking) yield { type: 'thinking', text: part.thinking };
			if (part.text) {
				wrote = true;
				yield { type: 'text', text: part.text };
			}
			if (part.finishReason) finish = part.finishReason;
		}

		// No closing event on this API: a stream that stopped without saying how it
		// finished was cut off, not done.
		if (finish === null) throw new GatewayError('The Gemini response ended before it was complete.', 200, '', false);
		if (ending(finish) !== 'complete') throw declined(finish, '');
		if (!wrote && outputTokens > 0 && outputTokens >= maxTokens) throw declined('MAX_TOKENS', '');

		console.info(`[gemini] stream served by ${servedBy} (${outputTokens} output tokens)`);
		yield { type: 'done', servedBy, outputTokens };
	}

	async callWithTools(req: ToolRequest): Promise<ToolResponse> {
		const maxTokens = geminiRoom(Math.max(req.maxTokens ?? MIN_TOOL_MAX_TOKENS, MIN_TOOL_MAX_TOKENS));
		const body = geminiBody({
			system: req.system,
			messages: req.messages.map((m) => ({ role: m.role, content: textOf(m.content) })),
			maxTokens,
			tools: req.tools,
			forceTool: req.forceTool
		});

		let lastError: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const own = new AbortController();
			const stop = () => own.abort();
			let res: Response;
			let json: unknown;
			try {
				res = await withinIdleLimit(
					post(endpoint('generateContent'), body, req.signal ? AbortSignal.any([req.signal, own.signal]) : own.signal),
					'answer',
					stop
				);
				if (res.ok) json = await withinIdleLimit(res.json(), 'answer', stop);
			} catch (cause) {
				if (req.signal?.aborted) throw cause;
				lastError = cause;
				if (attempt === MAX_ATTEMPTS) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			if (!res.ok) {
				const text = await res.text();
				const retryable = geminiRetryable(res.status);
				console.warn(`[gemini] tool attempt ${attempt}/${MAX_ATTEMPTS} failed: ${res.status} ${text.slice(0, 200)}`);
				lastError = new GatewayError(`Gemini tool call failed with ${res.status}`, res.status, text, retryable);
				if (!retryable || attempt === MAX_ATTEMPTS) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			const part = readGeminiPayload(json);
			const servedBy = part.model ?? config.geminiModel;

			// A forced call that came back without one is a model that reasoned until
			// it ran out, or wrote a call it could not form. Asking again may land.
			if (req.forceTool && part.calls.length === 0) {
				console.warn(`[gemini] tool attempt ${attempt}/${MAX_ATTEMPTS}: no function call (finishReason=${part.finishReason})`);
				lastError = new GatewayError(
					`Gemini returned no tool call (finishReason=${part.finishReason})`,
					200,
					part.text.slice(0, 500),
					true
				);
				if (attempt === MAX_ATTEMPTS) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			console.info(`[gemini] tool call served by ${servedBy} on attempt ${attempt}`);
			return { calls: part.calls, text: part.text, servedBy, attempts: attempt };
		}

		throw lastError instanceof Error ? lastError : new Error(`Gemini tool call failed after ${MAX_ATTEMPTS} attempts`);
	}
}
