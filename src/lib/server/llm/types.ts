export type Role = 'user' | 'assistant';

export interface ChatMessage {
	role: Role;
	content: string;
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
