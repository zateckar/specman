import { error, json } from '@sveltejs/kit';
import { getDecision, getProject, projectDecisions } from '$lib/server/db';
import { confirmChapter, DecisionNotFound, recordDecision } from '$lib/server/proposals';
import type { RequestHandler } from './$types';

/**
 * Confirming or discarding a decision the assistant made on the user's behalf.
 *
 * Only the user can do this — that is the entire point of recording the source.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId, id, action, chapterKey } = (await request.json()) as {
		projectId: number;
		id: number;
		action: 'confirm' | 'discard' | 'confirm-chapter';
		chapterKey?: string;
	};

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');

	// Every assumption in one chapter at once — for someone who has read a drafted
	// chapter and agrees with it. One commit, not one per assumption.
	if (action === 'confirm-chapter') {
		if (!chapterKey) throw error(400, 'No chapter given');
		try {
			const confirmed = await confirmChapter(project, chapterKey);
			return json({ chapterKey, confirmed });
		} catch (cause) {
			console.error('[decisions] could not record the chapter confirmation:', cause);
			const left = projectDecisions(project.id).filter(
				(d) => d.chapter_key === chapterKey && d.source !== 'user' && d.status !== 'confirmed'
			);
			throw error(503, left.length === 0
				? 'Your choice is saved, but it could not be added to the application’s history. It will be included when the next change is recorded.'
				: 'Your choice has not been recorded. The repository could not finish its pending work. Check the document before trying again.');
		}
	}

	const decision = getDecision(id);
	if (!decision || decision.project_id !== project.id) {
		throw error(409, 'That decision is no longer there. It may have been settled in another window.');
	}
	if (action !== 'confirm' && action !== 'discard') throw error(400, 'Unknown decision action');

	try {
		await recordDecision(project, id, action);
	} catch (cause) {
		// Settled in another window while this request waited for the repository.
		// Not a storage failure, and saying it was one would be untrue.
		if (cause instanceof DecisionNotFound) throw error(409, cause.message);
		console.error('[decisions] could not record the decision:', cause);
		const applied = action === 'discard' ? !getDecision(id) : getDecision(id)?.status === 'confirmed';
		throw error(503, applied
			? 'Your choice is saved, but it could not be added to the application’s history. It will be included when the next change is recorded.'
			: 'Your choice has not been recorded. The repository could not finish its pending work. Check the document before trying again.');
	}

	return json(action === 'discard' ? { id, discarded: true } : getDecision(id));
};
