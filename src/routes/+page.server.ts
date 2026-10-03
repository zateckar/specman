import { existsSync, rmSync } from 'node:fs';
import { fail, redirect } from '@sveltejs/kit';
import {
	createProject,
	defaultTemplate,
	deleteProject,
	getProject,
	listProjects,
	projectChapters,
	projectDecisions,
	slugExists
} from '$lib/server/db';
import { repoPathFor } from '$lib/server/git/repo';
import { effectiveStatus, pendingByChapter } from '$lib/server/llm/decisions';
import { describeFailure } from '$lib/server/llm/failures';
import { toProfile } from '$lib/server/llm/profile';
import { uniqueSlug } from '$lib/server/llm/slug';
import { countableChapters } from '$lib/server/llm/subchapters';
import { ensureWorkingProposal } from '$lib/server/proposals';
import { deleteDraft, draftView, modelConfigured, startDraft } from '$lib/server/drafting';
import type { Actions, PageServerLoad } from './$types';

/** Sent with every drafting call, and shown on the card in three lines. */
const DESCRIPTION_LIMIT = 2000;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	const projects = listProjects().map((project) => {
		const chapters = projectChapters(project.id);
		const pending = pendingByChapter(projectDecisions(project.id));
		// The same rules the chapter index uses — which chapters count, and the
		// status derived from unconfirmed decisions — or the card and the index
		// disagree about the same document.
		const counted = countableChapters(chapters);
		const draft = project.origin === 'generated' && user ? draftView(project, user) : null;
		return {
			id: project.id,
			name: project.name,
			description: project.description,
			created_at: project.created_at,
			total: counted.length,
			complete: counted.filter((c) => effectiveStatus(c.status, pending.get(c.key) ?? 0) === 'complete').length,
			open: counted.reduce((sum, c) => sum + c.open_questions.length, 0),
			draft: draft && {
				running: draft.state === 'running',
				untouched: draft.untouched,
				done: draft.done,
				total: draft.total,
				canDelete: draft.canDelete
			}
		};
	});

	return { projects, canDraft: modelConfigured() };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		// Sent back with any refusal, so the form reopens as it was submitted.
		const values = Object.fromEntries(
			['name', 'description', 'kind', 'reach', 'personalData', 'critical', 'start'].map((field) => [
				field,
				String(form.get(field) ?? '')
			])
		);
		const drafted = form.get('start') === 'draft';

		if (!name) return fail(400, { message: 'Give the application a name.', values });
		if (description.length > DESCRIPTION_LIMIT) {
			return fail(400, {
				message: `Keep the description under ${DESCRIPTION_LIMIT} characters — a few sentences is plenty.`,
				values
			});
		}
		// Every chapter is drafted from the description; without one there is only
		// a name to go on, and the draft would be invented from nothing.
		if (drafted && !description) {
			return fail(400, {
				message: 'Describe what the application should do, so the assistant has something to draft from.',
				values
			});
		}
		if (drafted && !modelConfigured()) {
			return fail(503, {
				message: 'The assistant is not available here, so it cannot draft the document. Start with questions instead.',
				values
			});
		}

		// A few questions decide which chapters this application actually needs.
		// Unanswered means the cautious answer — see `toProfile`.
		const profile = toProfile({
			reach: String(form.get('reach') ?? ''),
			personalData: form.get('personalData') !== 'no',
			critical: form.get('critical') === 'yes'
		});

		// Free in the database and on disk: a folder left behind by anything else
		// must not be adopted as this application's repository.
		const slug = uniqueSlug(name, (candidate) => slugExists(candidate) || existsSync(repoPathFor(candidate)));
		const project = createProject({
			name,
			description,
			ownerId: locals.user.id,
			templateId: defaultTemplate().id,
			slug,
			repoPath: repoPathFor(slug),
			profile,
			kind: form.get('kind') === 'change' ? 'change' : 'new',
			origin: drafted ? 'generated' : 'interview'
		});

		// Create the repository and its first working branch up front, so the
		// first conversation turn doesn't pay for it — and so an application whose
		// repository cannot be made is not created at all. Left in place, it was
		// listed on the home page, every turn in it failed, and trying again made a
		// second one beside it.
		try {
			await ensureWorkingProposal(project);
		} catch (cause) {
			console.error(`[projects] could not create the repository for "${name}":`, cause);
			deleteProject(project.id);
			rmSync(project.repo_path, { recursive: true, force: true });
			return fail(503, {
				message: `The application could not be created. ${describeFailure(cause, { messageSaved: false })}`,
				values
			});
		}

		// Only now that the repository exists for each chapter's commit. Detached:
		// the draft runs on the server whether or not anyone is watching.
		if (drafted) startDraft(project);

		throw redirect(303, `/projects/${project.id}`);
	},

	/** Only an untouched draft, and only by whoever asked for it or an administrator. */
	delete: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');
		const form = await request.formData();
		const project = getProject(Number(form.get('project')));
		// Posted from the card or from the workspace; either way, home afterwards.
		if (!project) throw redirect(303, '/');

		const outcome = await deleteDraft(project, locals.user);
		if (outcome === 'deleted') throw redirect(303, '/');
		return fail(outcome === 'forbidden' ? 403 : 409, {
			deleteMessage:
				outcome === 'forbidden'
					? 'Only the person who asked for this draft, or an administrator, can delete it.'
					: outcome === 'busy'
						? 'The draft could not be stopped just now. Try again in a minute.'
						: 'Someone has worked in this document since it was drafted, so it is kept.',
			project: project.id
		});
	}
};
