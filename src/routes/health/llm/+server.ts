import { error, json } from '@sveltejs/kit';
import { gateway } from '$lib/server/llm/gateway';
import { config } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Diagnostics for the gateway.
 *
 * Exercises both call shapes and reports which backend actually served each —
 * the only way to see the load-balancer routing that drives the retry logic.
 *
 * GET /health/llm?runs=3
 *
 * Administrators only. `/health` is exempt from the session check in
 * `hooks.server.ts` so that liveness probes work, and this route is not a
 * liveness probe: one request spends up to `runs` × 2 gateway calls, each
 * retrying up to four times, against a quota the whole company shares. Left
 * open it is a way for anyone who can reach the host to exhaust that quota, and
 * it names the gateway and both model groups while doing it.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');

	const runs = Math.min(Number(url.searchParams.get('runs') ?? '1') || 1, 10);
	const started = Date.now();

	const prose: unknown[] = [];
	const tools: unknown[] = [];

	for (let i = 0; i < runs; i++) {
		// --- Prose path: streamed, no tools.
		try {
			let text = '';
			let thinking = 0;
			let servedBy = '';
			let outputTokens = 0;

			for await (const event of gateway.streamChat({
				system: 'You are terse. Answer in under 10 words.',
				messages: [{ role: 'user', content: 'Name one benefit of writing a design document.' }],
				maxTokens: 2000
			})) {
				if (event.type === 'text') text += event.text;
				else if (event.type === 'thinking') thinking += event.text.length;
				else if (event.type === 'done') {
					servedBy = event.servedBy;
					outputTokens = event.outputTokens;
				}
			}

			prose.push({ ok: true, servedBy, outputTokens, thinkingChars: thinking, text: text.trim() });
		} catch (error) {
			prose.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
		}

		// --- Structured path: forced tool call, small arguments only.
		try {
			const result = await gateway.callWithTools({
				system:
					'You help specify software. Record the state of a design chapter. ' +
					'Never include chapter prose in tool arguments.',
				messages: [
					{
						role: 'user',
						content:
							'The user wants a booking app for company cars. ' +
							'Record the state of the Data Classification chapter.'
					}
				],
				tools: [
					{
						name: 'record_chapter_state',
						description:
							'Record status and remaining open questions for a chapter. ' +
							'Do NOT include chapter prose here — questions only.',
						input_schema: {
							type: 'object',
							properties: {
								chapter_key: { type: 'string' },
								status: { type: 'string', enum: ['empty', 'in_progress', 'complete'] },
								open_questions: { type: 'array', items: { type: 'string' } }
							},
							required: ['chapter_key', 'status', 'open_questions']
						}
					}
				],
				forceTool: 'record_chapter_state'
			});

			tools.push({
				ok: true,
				servedBy: result.servedBy,
				attempts: result.attempts,
				call: result.calls[0]?.input ?? null
			});
		} catch (error) {
			tools.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}

	const okCount = (list: unknown[]) => list.filter((r: any) => r.ok).length;

	return json({
		gateway: config.gatewayUrl,
		models: { prose: config.proseModel, tools: config.toolModel },
		runs,
		summary: {
			prose: `${okCount(prose)}/${runs}`,
			tools: `${okCount(tools)}/${runs}`,
			elapsedMs: Date.now() - started
		},
		prose,
		tools
	});
};
