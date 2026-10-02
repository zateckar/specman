/**
 * Translating between Specman's calls and Gemini's API.
 *
 * Specman's calls are Anthropic-shaped: a system prompt, alternating user and
 * assistant turns, tools described by JSON Schema. Gemini's differ in every
 * name — the assistant is `model`, the system prompt is a `systemInstruction`,
 * a forced tool is a function-calling mode — and in how an answer ends: there
 * is no closing event, only a `finishReason` on the last chunk.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface PlainTurn {
	role: 'user' | 'assistant';
	content: string;
}

export interface PlainTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

/** The body of a `generateContent` or `streamGenerateContent` request. */
export function geminiBody(args: {
	system?: string;
	messages: PlainTurn[];
	maxTokens: number;
	tools?: PlainTool[];
	forceTool?: string;
}): Record<string, unknown> {
	return {
		...(args.system ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
		contents: args.messages.map((turn) => ({
			role: turn.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: turn.content }]
		})),
		// The whole budget, reasoning included: Gemini counts its thinking against
		// the same ceiling, exactly as the primary gateway's models do.
		generationConfig: { maxOutputTokens: args.maxTokens },
		...(args.tools?.length
			? {
					tools: [
						{
							// As JSON Schema, which is what the tools are written in. The
							// older `parameters` field takes a subset of OpenAPI instead.
							functionDeclarations: args.tools.map((tool) => ({
								name: tool.name,
								description: tool.description,
								parametersJsonSchema: tool.input_schema
							}))
						}
					]
				}
			: {}),
		...(args.forceTool
			? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [args.forceTool] } } }
			: {})
	};
}

/** How a Gemini answer ended. */
export type Ending = 'complete' | 'out-of-room' | 'refused';

/**
 * `STOP` is the only ordinary ending. `MAX_TOKENS` is the budget; everything
 * else — a safety block, recitation, a malformed function call — is an answer
 * Gemini declined to give, which is not an empty one.
 */
export function ending(finishReason: string): Ending {
	if (finishReason === 'STOP') return 'complete';
	if (finishReason === 'MAX_TOKENS') return 'out-of-room';
	return 'refused';
}

export interface GeminiPart {
	text: string;
	thinking: string;
	calls: Array<{ name: string; input: Record<string, unknown> }>;
	/** Set on the last chunk, or on the only one. */
	finishReason: string | null;
	/** Reasoning and answer together, as they count against the budget. */
	outputTokens: number | null;
	model: string | null;
	error: { code: number; status: string; message: string } | null;
}

/** One streamed chunk, or a whole answer — they have the same shape. */
export function readGeminiPayload(payload: unknown): GeminiPart {
	const json = (payload ?? {}) as Record<string, any>;
	const part: GeminiPart = { text: '', thinking: '', calls: [], finishReason: null, outputTokens: null, model: null, error: null };

	if (json.error) {
		part.error = {
			code: Number(json.error.code ?? 0),
			status: String(json.error.status ?? ''),
			message: String(json.error.message ?? '')
		};
		return part;
	}

	const candidate = Array.isArray(json.candidates) ? json.candidates[0] : undefined;
	for (const piece of candidate?.content?.parts ?? []) {
		if (piece?.functionCall?.name) {
			part.calls.push({ name: String(piece.functionCall.name), input: piece.functionCall.args ?? {} });
		} else if (typeof piece?.text === 'string') {
			// A thought summary, when one is asked for. Never the answer.
			if (piece.thought) part.thinking += piece.text;
			else part.text += piece.text;
		}
	}

	if (candidate?.finishReason) part.finishReason = String(candidate.finishReason);
	// The question itself was refused: there is no candidate to finish.
	else if (json.promptFeedback?.blockReason) part.finishReason = String(json.promptFeedback.blockReason);

	const usage = json.usageMetadata;
	if (usage) part.outputTokens = Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0);
	if (json.modelVersion) part.model = String(json.modelVersion);
	return part;
}

const RETRYABLE_STATUSES = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED']);

/** Busy, rate-limited or failing on Google's side — worth asking again. */
export function geminiRetryable(code: number, status = ''): boolean {
	return code === 429 || code >= 500 || RETRYABLE_STATUSES.has(status);
}

/** `models/gemini-…` and `gemini-…` name the same model; the URL wants the second. */
export function geminiModelPath(model: string): string {
	return encodeURIComponent(model.trim().replace(/^models\//, ''));
}
