import { config } from '../env';
import { mayAskNext, ModelRouting, type Route } from './fallback';
import { GeminiProvider } from './gemini';
import { GatewayError, MAX_ATTEMPTS, Stalled, backoffMs, sleep, withinIdleLimit } from './transport';
import type {
	LlmProvider,
	StreamEvent,
	StreamRequest,
	ToolCall,
	ToolRequest,
	ToolResponse
} from './types';

export { GatewayError };

/**
 * Client for the LLM gateway.
 *
 * The gateway speaks the Anthropic Messages API shape, but what answers it is
 * not Claude. These behaviours were established by measurement and are
 * load-bearing:
 *
 *  1. Auth is `Authorization: Bearer`. `x-api-key` returns 401.
 *
 *  2. A model name may be a load-balanced *group* rather than one model, so two
 *     identical requests can be served by different backends and capability
 *     varies between them. Anything that must hold is enforced here, not asked
 *     for in a prompt.
 *
 *  3. A backend can reject a request that another backend would have accepted,
 *     including with a 400 that looks permanent. Retrying re-rolls the routing,
 *     so specific 400s are treated as retryable despite the 4xx status.
 *
 *  4. Truncation inside a tool call is a hard 400, not a partial response. If
 *     the model runs out of `max_tokens` mid-argument the JSON cannot be parsed
 *     and nothing usable comes back. The defence is twofold: generous
 *     `max_tokens` on every tools request, and — far more importantly — never
 *     putting long prose inside a tool argument. Measured: with long prose in
 *     the argument a minority of identical attempts failed outright; with small
 *     metadata only, none did.
 *
 *  5. A reasoning model spends its budget thinking before it writes, and may
 *     burn thousands of tokens before reaching a forced tool call — which is why
 *     prose and structured calls are configured separately.
 *
 * Which models sit behind this gateway, and which of its backends misbehave, are
 * settings rather than facts about the code. They belong in `.env`.
 */

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Substrings that mark a 400 as a transient gateway or routing fault rather than
 * a malformed request from us. See notes 3 and 4 above.
 *
 * The two built in are generic to this API shape. Anything that names a
 * particular backend is installation-specific — it says which models an operator
 * runs and which of them are broken — so it is configured through
 * `LLM_RETRYABLE_400` instead of being written down here.
 */
const RETRYABLE_400_MARKERS = [
	'Failed to parse tool call arguments',
	'Error doing the fallback',
	...config.retryable400
];

/** Truncation is fatal on this gateway, so never send a stingy budget with tools. */
const MIN_TOOL_MAX_TOKENS = 1500;

/** An error the gateway sent inside a stream it had already started. */
class StreamInterrupted extends GatewayError {
	constructor(payload: string, retryable: boolean) {
		super('The gateway interrupted its response.', 200, payload, retryable);
	}
}

/** The in-stream equivalents of a 429 or a 5xx. */
const RETRYABLE_STREAM_ERRORS = ['overloaded_error', 'api_error', 'rate_limit_error', 'timeout_error'];

function isRetryable(status: number, body: string): boolean {
	if (status === 429 || status >= 500) return true;
	if (status === 400) return RETRYABLE_400_MARKERS.some((m) => body.includes(m));
	return false;
}

interface AnthropicContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: Record<string, unknown>;
}

interface AnthropicResponse {
	model?: string;
	content?: AnthropicContentBlock[];
	stop_reason?: string;
	usage?: { output_tokens?: number };
}

async function postJson(body: unknown, signal?: AbortSignal): Promise<Response> {
	return fetch(config.gatewayUrl, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.gatewayKey}`,
			'anthropic-version': ANTHROPIC_VERSION,
			'content-type': 'application/json'
		},
		body: JSON.stringify(body),
		signal
	});
}

export class GatewayProvider implements LlmProvider {
	readonly id = 'llm-gateway';

	/**
	 * @param retryStalls Whether a call that went silent for the whole idle limit
	 *   is made again. Not when there is a fallback to ask instead: four waits of
	 *   three minutes each is a quarter of an hour before Gemini is tried.
	 */
	private readonly retryStalls: () => boolean;

	constructor(retryStalls: () => boolean = () => true) {
		this.retryStalls = retryStalls;
	}

	/**
	 * Streamed, tool-free generation. Used for chapter prose and chat replies.
	 *
	 * Retries only apply before the first byte reaches the caller; once we have
	 * started yielding text we cannot silently restart.
	 */
	async *streamChat(req: StreamRequest): AsyncIterable<StreamEvent> {
		const body = {
			model: req.model ?? config.proseModel,
			max_tokens: req.maxTokens ?? 4000,
			stream: true,
			...(req.system ? { system: req.system } : {}),
			messages: req.messages
		};

		// An error the gateway sends inside the stream, before any text has reached
		// the caller, is the same transient fault as one sent as a status code — an
		// overloaded backend says so either way. Restarting is invisible until a
		// word has been yielded; after that it would repeat the reply.
		for (let attempt = 1; ; attempt++) {
			let wrote = false;
			try {
				for await (const event of this.streamOnce(body, req.signal, attempt)) {
					if (event.type === 'text') wrote = true;
					yield event;
				}
				return;
			} catch (cause) {
				const again =
					cause instanceof StreamInterrupted && cause.retryable && !wrote &&
					attempt < MAX_ATTEMPTS && !req.signal?.aborted;
				if (!again) throw cause;
				console.warn(`[llm] stream attempt ${attempt}/${MAX_ATTEMPTS} interrupted before any text (retryable)`);
				await sleep(backoffMs(attempt));
			}
		}
	}

	/** One request to the gateway, retried only up to its first byte. */
	private async *streamOnce(
		body: { model: string; max_tokens: number },
		signal: AbortSignal | undefined,
		firstAttempt: number
	): AsyncIterable<StreamEvent> {
		let response: Response | undefined;
		let stop = () => {};

		for (let attempt = firstAttempt; attempt <= MAX_ATTEMPTS; attempt++) {
			let res: Response;
			const own = new AbortController();
			stop = () => own.abort();
			try {
				res = await withinIdleLimit(
					postJson(body, signal ? AbortSignal.any([signal, own.signal]) : own.signal),
					'answer',
					stop
				);
			} catch (cause) {
				if (signal?.aborted) throw cause;
				if (attempt === MAX_ATTEMPTS) throw cause;
				if (cause instanceof Stalled && !this.retryStalls()) throw cause;
				await sleep(backoffMs(attempt));
				continue;
			}

			if (res.ok) {
				response = res;
				break;
			}

			const text = await res.text();
			const retryable = isRetryable(res.status, text);
			console.warn(
				`[llm] stream attempt ${attempt}/${MAX_ATTEMPTS} failed: ${res.status}` +
					`${retryable ? ' (retryable)' : ''} ${text.slice(0, 200)}`
			);
			if (!retryable || attempt === MAX_ATTEMPTS) {
				throw new GatewayError(
					`Gateway stream failed with ${res.status}`,
					res.status,
					text,
					retryable
				);
			}
			await sleep(backoffMs(attempt));
		}

		if (!response?.body) throw new Error('Gateway returned no response body');

		let servedBy = body.model;
		let outputTokens = 0;
		let completed = false;
		let wrote = false;

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await withinIdleLimit(reader.read(), 'continue', stop);
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				buffer = buffer.replace(/\r\n/g, '\n');

				// SSE frames are separated by a blank line.
				let split: number;
				while ((split = buffer.indexOf('\n\n')) !== -1) {
					const frame = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);

					for (const line of frame.split('\n')) {
						if (!line.startsWith('data:')) continue;

						const payload = line.slice(5).trim();
						if (!payload) continue;
						if (payload === '[DONE]') {
							completed = true;
							continue;
						}

						let event: Record<string, any>;
						try {
							event = JSON.parse(payload);
						} catch {
							continue; // Ignore malformed frames rather than killing the stream.
						}

						if (event.type === 'error') {
							const kind = String(event.error?.type ?? '');
							throw new StreamInterrupted(payload, RETRYABLE_STREAM_ERRORS.includes(kind));
						} else if (event.type === 'message_stop') {
							completed = true;
						} else if (event.type === 'message_start' && event.message?.model) {
							servedBy = event.message.model;
						} else if (event.type === 'content_block_delta') {
							const delta = event.delta ?? {};
							if (delta.type === 'text_delta' && delta.text) {
								wrote = true;
								yield { type: 'text', text: delta.text };
							} else if (delta.type === 'thinking_delta' && delta.thinking) {
								// Reasoning-model output — never surfaced to the user.
								yield { type: 'thinking', text: delta.thinking };
							}
						} else if (event.type === 'message_delta') {
							if (event.delta?.stop_reason === 'max_tokens') {
								throw new GatewayError('The gateway ran out of room before completing its response.', 200, payload, false);
							}
							outputTokens = event.usage?.output_tokens ?? outputTokens;
						}
					}
				}
			}
		} catch (cause) {
			await reader.cancel().catch(() => {});
			throw cause;
		} finally {
			reader.releaseLock();
		}

		if (!completed) throw new GatewayError('The gateway response ended before it was complete.', 200, '', false);
		// Silence is a valid answer, but not silence that spent the whole budget: that
		// is the model reasoning until it hit the ceiling, reported by a backend that
		// does not say max_tokens. Accepting it let a starved check read as a clean one.
		if (!wrote && outputTokens > 0 && outputTokens >= body.max_tokens) {
			throw new GatewayError('The gateway ran out of room before completing its response.', 200, '', false);
		}
		console.info(`[llm] stream served by ${servedBy} (${outputTokens} output tokens)`);
		yield { type: 'done', servedBy, outputTokens };
	}

	/**
	 * Structured call with forced tool choice.
	 *
	 * Callers must keep tool arguments small: identifiers, enums, short question
	 * strings. Prose belongs in `streamChat`. See note 4 at the top of the file.
	 */
	async callWithTools(req: ToolRequest): Promise<ToolResponse> {
		const maxTokens = Math.max(req.maxTokens ?? MIN_TOOL_MAX_TOKENS, MIN_TOOL_MAX_TOKENS);

		const body = {
			model: req.model ?? config.toolModel,
			max_tokens: maxTokens,
			tools: req.tools,
			...(req.forceTool ? { tool_choice: { type: 'tool', name: req.forceTool } } : {}),
			...(req.system ? { system: req.system } : {}),
			messages: req.messages
		};

		let lastError: unknown;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			let res: Response;
			let json: AnthropicResponse | undefined;
			const own = new AbortController();
			try {
				res = await withinIdleLimit(
					postJson(body, req.signal ? AbortSignal.any([req.signal, own.signal]) : own.signal),
					'answer',
					() => own.abort()
				);
				// Not streamed, so the whole answer is one wait.
				if (res.ok) json = (await withinIdleLimit(res.json(), 'answer', () => own.abort())) as AnthropicResponse;
			} catch (cause) {
				if (req.signal?.aborted) throw cause;
				lastError = cause;
				if (attempt === MAX_ATTEMPTS) break;
				if (cause instanceof Stalled && !this.retryStalls()) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			if (!res.ok) {
				const text = await res.text();
				const retryable = isRetryable(res.status, text);
				console.warn(
					`[llm] tool attempt ${attempt}/${MAX_ATTEMPTS} failed: ${res.status}` +
						`${retryable ? ' (retryable)' : ''} ${text.slice(0, 200)}`
				);
				lastError = new GatewayError(
					`Gateway tool call failed with ${res.status}`,
					res.status,
					text,
					retryable
				);
				if (!retryable || attempt === MAX_ATTEMPTS) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			if (!json) throw new Error('Gateway returned no response body');
			const blocks = json.content ?? [];

			const calls: ToolCall[] = blocks
				.filter((b) => b.type === 'tool_use' && b.name)
				.map((b) => ({ name: b.name!, input: b.input ?? {} }));

			const text = blocks
				.filter((b) => b.type === 'text' && b.text)
				.map((b) => b.text!)
				.join('');

			const servedBy = json.model ?? body.model;

			// A forced tool call that produced no tool_use means the backend ran out
			// of budget while reasoning (see note 5). Retry — routing may differ.
			if (req.forceTool && calls.length === 0) {
				console.warn(
					`[llm] tool attempt ${attempt}/${MAX_ATTEMPTS}: no tool_use from ${servedBy}` +
						` (stop_reason=${json.stop_reason})`
				);
				lastError = new GatewayError(
					`Model ${servedBy} returned no tool call (stop_reason=${json.stop_reason})`,
					200,
					text.slice(0, 500),
					true
				);
				if (attempt === MAX_ATTEMPTS) break;
				await sleep(backoffMs(attempt));
				continue;
			}

			console.info(`[llm] tool call served by ${servedBy} on attempt ${attempt}`);
			return { calls, text, servedBy, attempts: attempt };
		}

		throw lastError instanceof Error
			? lastError
			: new Error(`Gateway tool call failed after ${MAX_ATTEMPTS} attempts`);
	}
}

/** Neither the primary gateway nor Gemini is set up. */
export class NoModelConfigured extends Error {
	constructor() {
		super('No language model is configured. Set LLM_URL, LLM_API_KEY and LLM_MODEL, or GEMINI_API_KEY. See .env.example.');
		this.name = 'NoModelConfigured';
	}
}

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const label = (route: Route) => (route === 'primary' ? 'the primary gateway' : 'Gemini');

/**
 * Every model call goes through here: to the primary gateway when it is
 * configured and answering, and to Gemini when it is not. The rule for when a
 * failed call may go elsewhere is in `fallback.ts`.
 */
export class ModelProvider implements LlmProvider {
	readonly id = 'models';
	readonly routing = new ModelRouting();
	readonly primary: LlmProvider;
	readonly fallback: LlmProvider;

	constructor(primary: LlmProvider, fallback: LlmProvider) {
		this.primary = primary;
		this.fallback = fallback;
	}

	private order(): Route[] {
		const order = this.routing.order(config.primaryConfigured, Boolean(config.geminiKey));
		if (order.length === 0) throw new NoModelConfigured();
		return order;
	}

	private provider(route: Route): LlmProvider {
		return route === 'primary' ? this.primary : this.fallback;
	}

	async *streamChat(req: StreamRequest): AsyncIterable<StreamEvent> {
		const order = this.order();
		for (const [index, route] of order.entries()) {
			let passedOn = false;
			try {
				for await (const event of this.provider(route).streamChat(req)) {
					if (event.type === 'text') passedOn = true;
					yield event;
				}
				this.routing.succeeded(route);
				return;
			} catch (cause) {
				if (!req.signal?.aborted) this.routing.failed(route);
				const next = order[index + 1];
				if (!next || !mayAskNext(passedOn, Boolean(req.signal?.aborted))) throw cause;
				console.warn(`[llm] ${label(route)} failed (${describe(cause)}); asking ${label(next)} instead`);
			}
		}
	}

	async callWithTools(req: ToolRequest): Promise<ToolResponse> {
		const order = this.order();
		for (const [index, route] of order.entries()) {
			try {
				const result = await this.provider(route).callWithTools(req);
				this.routing.succeeded(route);
				return result;
			} catch (cause) {
				if (!req.signal?.aborted) this.routing.failed(route);
				const next = order[index + 1];
				if (!next || !mayAskNext(false, Boolean(req.signal?.aborted))) throw cause;
				console.warn(`[llm] ${label(route)} failed (${describe(cause)}); asking ${label(next)} instead`);
			}
		}
		throw new NoModelConfigured();
	}
}

export const gateway = new ModelProvider(
	new GatewayProvider(() => !config.geminiKey),
	new GeminiProvider()
);
