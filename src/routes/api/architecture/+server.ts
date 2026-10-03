import { error, json } from '@sveltejs/kit';
import {
	getProject,
	projectChapters,
	projectRequirements,
	saveArchitecture
} from '$lib/server/db';
import { deriveArchitecture } from '$lib/server/llm/architect';
import { layoutDiagram } from '$lib/server/llm/diagram';
import { describeFailure } from '$lib/server/llm/failures';
import { isDrafting, STILL_DRAFTING } from '$lib/server/drafting';
import type { RequestHandler } from './$types';

/**
 * Derive the layered model and return it laid out.
 *
 * One gateway call, so it runs on request rather than on every turn, and the
 * model is stored — the picture only changes when the document does.
 *
 * Only a model with something in it is stored. An outage or a reply with
 * nothing usable used to be saved as the application's diagram, so one bad
 * attempt replaced a good picture with an empty one, on screen and in the
 * download. Now the previous picture stays and the reason is said in words.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');

	const { projectId } = (await request.json()) as { projectId: number };

	const project = getProject(projectId);
	if (!project) throw error(404, 'No such project');
	// It would draw, and keep, a picture of half a document.
	if (isDrafting(project.id)) throw error(409, STILL_DRAFTING);

	let model;
	try {
		model = await deriveArchitecture({
			project: { name: project.name, description: project.description },
			chapters: projectChapters(project.id),
			requirements: projectRequirements(project.id),
			signal: request.signal
		});
	} catch (cause) {
		console.warn('[architect] could not derive the model:', cause);
		return json({ message: `The diagram could not be drawn. ${describeFailure(cause, { messageSaved: false })}` }, { status: 503 });
	}

	if (model.elements.length === 0) {
		return json(
			{
				message:
					'Nothing could be drawn from the document as it stands. There needs to be enough written down first — try again once a few chapters have content.'
			},
			{ status: 422 }
		);
	}

	saveArchitecture(project.id, model.elements, model.relations);

	return json({
		elements: model.elements,
		relations: model.relations,
		diagram: layoutDiagram(model)
	});
};
