import { error } from '@sveltejs/kit';
import {
	getProject,
	projectChapters,
	projectDecisions,
	projectRequirements,
	recentMessages
} from '$lib/server/db';
import { effectiveStatus, pendingByChapter } from '$lib/server/llm/decisions';
import { validateDocument } from '$lib/server/llm/validation';
import { openProposal, proposalDiff, reviewRevision } from '$lib/server/proposals';
import { stripChapterHeading } from '$lib/server/markdown';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const project = getProject(Number(params.id));
	if (!project) throw error(404, 'No such application');

	const chapters = projectChapters(project.id);
	const activeKey = url.searchParams.get('chapter');
	const active = activeKey && chapters.some((c) => c.key === activeKey) ? activeKey : null;

	const proposal = openProposal(project.id);
	let pendingChanges = false;
	if (proposal) {
		try {
			pendingChanges = (await proposalDiff(project, await reviewRevision(project, proposal))).trim().length > 0;
		} catch {
			pendingChanges = false;
		}
	}

	const requirements = projectRequirements(project.id);
	const decisions = projectDecisions(project.id);
	const pending = pendingByChapter(decisions);

	return {
		project: {
			id: project.id,
			name: project.name,
			description: project.description
		},
		chapters: chapters.map((c) => ({
			key: c.key,
			title: c.title,
			goal: c.goal ?? '',
			parent_key: c.parent_key ?? '',
			depth: c.depth ?? 0,
			applicable: c.applicable !== 0,
			skip_reason: c.skip_reason ?? '',
			status: effectiveStatus(c.status, pending.get(c.key) ?? 0),
			open_questions: c.open_questions,
			content_md: stripChapterHeading(c.content_md, c.title),
			is_dynamic: c.is_dynamic
		})),
		requirements: requirements.map((r) => ({
			ref: r.ref,
			chapter_key: r.chapter_key,
			statement: r.statement,
			scope: r.scope,
			scenarios: r.scenarios
		})),
		decisions: decisions.map((d) => ({
			id: d.id,
			chapter_key: d.chapter_key,
			statement: d.statement,
			rationale: d.rationale,
			source: d.source,
			status: d.status
		})),
		findings: validateDocument({
			// A chapter set aside is not unfinished — it was never in scope.
			chapters: chapters.filter((c) => c.applicable !== 0),
			requirements,
			decisions
		}),
		activeKey: active,
		messages: recentMessages(project.id, active, 50).map((m) => ({
			role: m.role,
			content: m.content,
			options: m.options
		})),
		proposal: proposal ? { id: proposal.id, branch: proposal.branch } : null,
		pendingChanges
	};
};
