export type Role = 'user' | 'assistant';

/**
 * A turn that carries a tool call or its result. Only `streamChat` sends these,
 * and only for tools whose arguments are an identifier or two — see `gateway.ts`.
 */
export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'tool_result'; tool_use_id: string; content: string };

export interface ChatMessage {
	role: Role;
	content: string | ContentBlock[];
}

/** A turn as plain text: a tool call as a line saying so, its result as itself. */
export function textOf(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content;
	return content
		.map((block) =>
			block.type === 'text'
				? block.text
				: block.type === 'tool_use'
					? `(${block.name} ${JSON.stringify(block.input)})`
					: block.content
		)
		.filter((text) => text.trim())
		.join('\n\n');
}

export interface ToolDef {
	name: string;
	description: string;
	/** JSON Schema. Keep the properties small — see `gateway.ts` for why. */
	input_schema: {
		type: 'object';
		properties: Record<string, unknown>;
		required: string[];
	};
}

export interface ToolCall {
	name: string;
	input: Record<string, unknown>;
}

export interface StreamRequest {
	system?: string;
	messages: ChatMessage[];
	/**
	 * Tools the model may call while it streams. Arguments must stay tiny — a key,
	 * never prose. A call ends the stream; the caller answers it and asks again.
	 */
	tools?: ToolDef[];
	maxTokens?: number;
	model?: string;
	signal?: AbortSignal;
}

export interface ToolRequest {
	system?: string;
	messages: ChatMessage[];
	tools: ToolDef[];
	/** Force a specific tool. Strongly recommended — see `gateway.ts`. */
	forceTool?: string;
	maxTokens?: number;
	model?: string;
	signal?: AbortSignal;
}

export type StreamEvent =
	| { type: 'text'; text: string }
	/** Reasoning-model output. Never shown to the user; useful for debugging. */
	| { type: 'thinking'; text: string }
	/** A tool the model called, its arguments complete. Sent before `done`. */
	| { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'done'; servedBy: string; outputTokens: number };

export interface ToolResponse {
	calls: ToolCall[];
	/** Any text the model emitted alongside the tool call. */
	text: string;
	/** The backend that actually served this request, as the gateway reports it. */
	servedBy: string;
	attempts: number;
}

export interface LlmProvider {
	readonly id: string;
	streamChat(req: StreamRequest): AsyncIterable<StreamEvent>;
	callWithTools(req: ToolRequest): Promise<ToolResponse>;
}
