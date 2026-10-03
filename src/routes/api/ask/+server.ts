import { error, json } from '@sveltejs/kit';
import { addMessage, getChapter, getProject, setMessageOptions } from '$lib/server/db';
import { suggestOptions } from '$lib/server/llm/agent';
import { isDrafting, STILL_DRAFTING } from '$lib/server/drafting';
import type { RequestHandler } from './$types';

/**
 * Put one of the chapter's open questions to the user.
 *
 * An open question is something the *agent* wants to know, so clicking it in the
 * index must add an agent turn asking it — not a user turn, which would have the
 * user asking their own question and the agent answering it for them. The answer
 * is always the user's to give.
 *
 * The question is stored before options are generated: if the suggestion call
 * fails the question still stands, and the user simply types their answer.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId, chapterKey, question } = (await request.json()) as {
		projectId: number;
		chapterKey: string | null;
		question: string;
	};

	if (!question?.trim()) throw error(400, 'No question given');

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	// The conversation is closed while a draft runs; this would open it.
	if (isDrafting(project.id)) throw error(409, STILL_DRAFTING);

	const chapter = chapterKey ? getChapter(project.id, chapterKey) : null;
	if (chapterKey && !chapter) throw error(404, 'No such chapter');

	const messageId = addMessage(project.id, chapterKey, 'assistant', question.trim());

	const options = chapter ? await suggestOptions({ chapter, question }) : [];
	if (options.length > 0) setMessageOptions(messageId, options);

	return json({ question: question.trim(), options });
};
