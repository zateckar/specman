import { config } from '../env';
import type {
	LlmProvider,
	StreamEvent,
	StreamRequest,
	ToolCall,
	ToolRequest,
	ToolResponse
} from './types';

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

const MAX_ATTEMPTS = 4;

/** Truncation is fatal on this gateway, so never send a stingy budget with tools. */
const MIN_TOOL_MAX_TOKENS = 1500;

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

function isRetryable(status: number, body: string): boolean {
	if (status === 429 || status >= 500) return true;
	if (status === 400) return RETRYABLE_400_MARKERS.some((m) => body.includes(m));
	return false;
}

function backoffMs(attempt: number): number {
	// 300ms, 900ms, 2.7s — with jitter so concurrent turns don't retry in lockstep.
	return Math.round(300 * 3 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

		let response: Response | undefined;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			let res: Response;
			try {
				res = await postJson(body, req.signal);
			} catch (cause) {
				if (req.signal?.aborted) throw cause;
				if (attempt === MAX_ATTEMPTS) throw cause;
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
				const { done, value } = await reader.read();
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
							throw new GatewayError('The gateway interrupted its response.', 200, payload, false);
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
			try {
				res = await postJson(body, req.signal);
			} catch (cause) {
				if (req.signal?.aborted) throw cause;
				lastError = cause;
				if (attempt === MAX_ATTEMPTS) break;
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

			const json = (await res.json()) as AnthropicResponse;
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

export const gateway = new GatewayProvider();
