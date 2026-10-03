import { error } from '@sveltejs/kit';
import { getProject, latestMockup } from '$lib/server/db';
import { forTheFrame, mockupHeaders } from '$lib/server/llm/mockup';
import type { RequestHandler } from './$types';

/** Said in the frame, with its policy, rather than as the error page, which may not be framed. */
function plain(status: number, text: string): Response {
	return new Response(text, {
		status,
		headers: { ...mockupHeaders(), 'content-type': 'text/plain; charset=utf-8' }
	});
}

/**
 * The mock-up itself, for the frame on its page.
 *
 * Its own address so that it carries its own policy: whatever the page does, it
 * runs sandboxed with no network. The frame repeats the sandbox in Specman's own
 * markup, so it holds even if something between here and the browser drops the
 * header — which is why the address is not answered as a page of its own.
 */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	if (!forTheFrame(request.headers.get('sec-fetch-dest'))) {
		return plain(403, 'The mock-up opens on its page in Specman, where it can be shown full screen or downloaded.');
	}

	const stored = latestMockup(project.id);
	if (!stored) return plain(404, 'No mock-up has been made for this application yet.');

	return new Response(stored.html, { headers: mockupHeaders() });
};
