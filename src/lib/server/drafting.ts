import { rmSync } from 'node:fs';
import { config } from './env';
import {
	chapterHoldings,
	chapterRequirements,
	deleteUntouchedDraft,
	draftEvidence,
	getProject,
	projectChapters,
	projectDecisions,
	recordDraftedChapter
} from './db';
import type { Chapter, ChapterStatus, Project, User } from './db/types';
import { ChapterStreamParser, assessChapter, normalizeChapterMarkdown } from './llm/agent';
import { toDecisionDraft } from './llm/decisions';
import {
	asDraftBlock,
	buildDraftPrompt,
	chaptersToDraft,
	draftedProse,
	draftRequest,
	draftState,
	isUntouchedDraft,
	UNCHECKED_CHAPTER,
	type DraftState
} from './llm/draft';
import { DRAFT_BUDGET, DRAFT_RETRY_BUDGET } from './llm/budgets';
import { ranOutOfRoom } from './llm/fallback';
import { describeFailure } from './llm/failures';
import { gateway } from './llm/gateway';
import { longCalls } from './llm/parallel';
import { describeProfile, toProfile } from './llm/profile';
import { reconcileAssessment } from './llm/questions';
import { toRequirementDraft } from './llm/requirements';
import { stopMockup } from './mockups';
import { commitDocument, nameDraftProposal, writeAndCommit } from './proposals';
import { withRepo } from './git/repo';

/**
 * The assistant drafting a whole document, run by the server.
 *
 * Drafting takes minutes, and an instruction that depends on a future turn is a
 * plan with no owner: so nothing here waits for a page. The job is started by
 * the creation action, saves and commits each chapter as it lands, and finishes
 * whether or not anyone is watching. What may be drafted and what a reply may
 * change are decided in `llm/draft.ts`; this is the part that calls the model.
 *
 * In memory, one job per application, as the repository lock and presence are:
 * a second process neither sees a running draft nor refuses a turn beside it.
 * Nothing is lost when the job is — every chapter is already stored — and the
 * workspace offers to draft whatever is still unwritten.
 */

/** How long a deletion waits for a stopped draft before refusing. */
const STOP_WAIT_MS = 70_000;
/** Decisions from other chapters passed to each call, to keep parallel calls consistent. */
const DECIDED_ELSEWHERE_LIMIT = 40;

interface Job {
	controller: AbortController;
	/** Settles when the run has finished, whether it succeeded, failed or was stopped. */
	done: Promise<void>;
	/** Chapters this run set out to draft. */
	total: number;
	written: Set<string>;
	writing: Set<string>;
	failed: Set<string>;
	problem: string | null;
}

const jobs = new Map<number, Job>();
/** How the last run in each application ended, for the page that opens next. */
const outcomes = new Map<number, { failed: string[]; problem: string | null }>();

export function modelConfigured(): boolean {
	return config.primaryConfigured || Boolean(config.geminiKey);
}

export function isDrafting(projectId: number): boolean {
	return jobs.has(projectId);
}

/**
 * Why anything that reads the document as finished, or compares the revision it
 * began from, is refused while a draft runs: it would be stale by the time it
 * ended, or describe half a document. Answered with 409 before anything is stored.
 */
export const STILL_DRAFTING = 'The assistant is still drafting this document. Try again once it has finished.';

/** The chapters a draft would write now, in order. */
function chaptersLeft(projectId: number): Chapter[] {
	return chaptersToDraft(projectChapters(projectId), chapterHoldings(projectId));
}

/**
 * Start drafting whatever is still unwritten. False when a run is already going
 * or there is nothing to draft. Returns at once; the run is detached.
 */
export function startDraft(project: Project): boolean {
	if (jobs.has(project.id)) return false;
	const order = chaptersLeft(project.id);
	if (order.length === 0) return false;

	const job: Job = {
		controller: new AbortController(),
		done: Promise.resolve(),
		total: order.length,
		written: new Set(),
		writing: new Set(),
		failed: new Set(),
		problem: null
	};
	jobs.set(project.id, job);
	outcomes.delete(project.id);

	// Detached, so nothing above it would catch a rejection — and an unhandled
	// one ends the process.
	job.done = run(project, order, job)
		.catch((cause) => {
			console.error(`[draft] the draft of "${project.name}" stopped:`, cause);
			job.problem ??= describeFailure(cause);
		})
		.finally(() => {
			jobs.delete(project.id);
			const failed = [...job.failed];
			if (failed.length > 0 || job.problem) outcomes.set(project.id, { failed, problem: job.problem });
			console.info(
				`[draft] "${project.name}": ${job.written.size} of ${job.total} chapters drafted` +
					(job.controller.signal.aborted ? ', stopped' : '') +
					(failed.length ? `, ${failed.length} failed` : '')
			);
		});
	return true;
}

async function run(project: Project, order: Chapter[], job: Job): Promise<void> {
	nameDraftProposal(project.id);

	// The Overview alone first: every other chapter is written against it. If it
	// fails, the rest still run, from the name and the description.
	const [first, ...rest] = order;
	if (first.key === 'overview') {
		await draftChapter(project, first, job);
		await Promise.all(rest.map((chapter) => draftChapter(project, chapter, job)));
	} else {
		await Promise.all(order.map((chapter) => draftChapter(project, chapter, job)));
	}

	// Does nothing unless a chapter's own commit failed, and then records it.
	if (!job.controller.signal.aborted && getProject(project.id)) {
		try {
			await commitDocument(project, 'Draft the document');
		} catch (cause) {
			console.error(`[draft] could not record the draft of "${project.name}":`, cause);
		}
	}
}

/**
 * One chapter: its call, at most one retry, the assessment, then the write and
 * its commit together. Never throws.
 *
 * Assessed before it is written, against the reply, so the write and the commit
 * are one held section and the commit named for this chapter holds this chapter.
 */
async function draftChapter(project: Project, chapter: Chapter, job: Job): Promise<void> {
	const signal = job.controller.signal;
	let ready: (DraftedChapter & { status: ChapterStatus; openQuestions: string[] }) | null = null;

	try {
		// Shared with mock-ups: three long calls at a time across the installation.
		await longCalls.run(async () => {
			if (signal.aborted) return;
			job.writing.add(chapter.key);
			try {
				let reply = await attempt(project, chapter, false, signal).catch((cause) => {
					// Out of room is reported as an error, not as an empty reply; it gets
					// the second attempt. Anything else was already retried by the client.
					if (signal.aborted || !ranOutOfRoom(cause)) throw cause;
					return null;
				});
				if (!reply && !signal.aborted) reply = await attempt(project, chapter, true, signal);
				if (signal.aborted) return;
				if (!reply) {
					job.failed.add(chapter.key);
					job.problem ??= 'The assistant did not write some chapters.';
					return;
				}
				ready = { ...reply, ...(await assess(project, chapter, reply.prose, signal)) };
			} finally {
				job.writing.delete(chapter.key);
			}
		}, signal);
		if (!ready || signal.aborted) return;

		// Someone may have put something of their own into it meanwhile, or deleted
		// the application; then the reply is dropped.
		const drafted: typeof ready = ready;
		const { written, failure } = await writeAndCommit(
			project,
			`Draft ${chapter.title}`,
			() => recordDraftedChapter(project.id, chapter.key, drafted) === 'written'
		);
		if (written) job.written.add(chapter.key);
		// The chapter is stored; the final commit of the run picks it up.
		if (failure) console.error(`[draft] could not record "${chapter.title}" in "${project.name}":`, failure);
	} catch (cause) {
		if (signal.aborted) return;
		console.warn(`[draft] chapter "${chapter.key}" of "${project.name}" failed:`, cause);
		job.failed.add(chapter.key);
		job.problem ??= describeFailure(cause);
	}
}

interface DraftedChapter {
	prose: string;
	rules: Array<{ statement: string; scope: string; scenarios: Array<{ when: string; then: string }>; existing: boolean }>;
	decisions: Array<{ statement: string; rationale: string }>;
}

/** One drafting call. Null when it wrote no prose for this chapter. */
async function attempt(project: Project, chapter: Chapter, brief: boolean, signal: AbortSignal): Promise<DraftedChapter | null> {
	const current = getProject(project.id);
	if (!current) return null;

	const chapters = projectChapters(project.id);
	const parents = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
	const titles = new Map(chapters.map((c) => [c.key, c.title]));
	const overview = chapters.find((c) => c.key === 'overview');
	const decidedElsewhere = projectDecisions(project.id)
		.filter((d) => d.chapter_key !== chapter.key && d.statement !== UNCHECKED_CHAPTER.statement)
		.slice(0, DECIDED_ELSEWHERE_LIMIT)
		.map((d) => ({ chapter: titles.get(d.chapter_key) ?? d.chapter_key, statement: d.statement }));

	let profile = {};
	try {
		profile = JSON.parse(current.profile);
	} catch {
		// An unreadable profile is the default one, as everywhere else.
	}

	const system = buildDraftPrompt({
		project: { name: current.name, description: current.description, kind: current.kind },
		profile: describeProfile(toProfile(profile)),
		chapter,
		chapters: chapters
			.filter((c) => c.applicable !== 0 && !parents.has(c.key))
			.map((c) => ({ key: c.key, title: c.title, goal: c.goal })),
		overview: overview ? normalizeChapterMarkdown(overview.content_md, overview.title) : '',
		decidedElsewhere,
		standards: chapterRequirements(project.id, chapter.key)
			.filter((r) => r.source === 'standard')
			.map((r) => r.statement),
		brief
	});

	const parser = new ChapterStreamParser();
	for await (const event of gateway.streamChat({
		system,
		messages: [{ role: 'user', content: draftRequest(chapter.title) }],
		maxTokens: brief ? DRAFT_RETRY_BUDGET : DRAFT_BUDGET,
		signal
	})) {
		if (event.type === 'text') parser.push(event.text);
	}
	parser.end();

	const prose = draftedProse(chapter, parser.drafts, normalizeChapterMarkdown);
	if (!prose) return null;

	const rules: DraftedChapter['rules'] = [];
	for (const block of parser.blocksOf('requirement')) {
		const filed = asDraftBlock(block);
		const rule = filed && toRequirementDraft(filed.attrs, filed.body);
		if (rule && !rule.remove) {
			rules.push({ statement: rule.statement, scope: rule.scope, scenarios: rule.scenarios, existing: rule.existing });
		}
	}
	const decisions: DraftedChapter['decisions'] = [];
	for (const block of parser.blocksOf('decision')) {
		const filed = asDraftBlock(block);
		const decision = filed && toDecisionDraft(filed.attrs, filed.body);
		if (decision) decisions.push({ statement: decision.statement, rationale: decision.rationale });
	}
	return { prose, rules, decisions };
}

/**
 * The completeness verdict on the drafted prose, as after a turn. A draft has no
 * reply, so the reconciliation is given none: stray question marks in model
 * chatter cannot become open questions. A failed assessment leaves the chapter
 * in progress.
 */
async function assess(
	project: Project,
	chapter: Chapter,
	prose: string,
	signal: AbortSignal
): Promise<{ status: ChapterStatus; openQuestions: string[] }> {
	const assessment = reconcileAssessment(
		await assessChapter({ chapter, chapterContent: prose, conversation: [], latestReply: '', signal }),
		'',
		projectChapters(project.id)
			.filter((c) => c.key !== chapter.key)
			.map((c) => c.title),
		true
	);
	return {
		status: (assessment?.status as ChapterStatus | undefined) ?? 'in_progress',
		openQuestions: assessment?.openQuestions ?? []
	};
}

/**
 * Stop a running draft and wait for it to settle. True once nothing of it is
 * running; false if it was still running when the wait ran out.
 */
export async function stopDraft(projectId: number, waitMs = STOP_WAIT_MS): Promise<boolean> {
	const job = jobs.get(projectId);
	if (!job) return true;
	job.controller.abort(new Error('The draft was stopped.'));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const settled = await Promise.race([
		job.done.then(() => true),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(false), waitMs);
		})
	]);
	clearTimeout(timer);
	return settled;
}

export function mayDelete(project: Project, user: Pick<User, 'id' | 'is_admin'>): boolean {
	return project.owner_id === user.id || user.is_admin === 1;
}

export interface DraftView {
	state: DraftState | null;
	/** Nobody has put anything of their own into it: the "AI draft" mark. */
	untouched: boolean;
	/** While running: chapters this run set out to draft, and how many are done. */
	total: number;
	done: number;
	/** Titles being written now, and their keys, for marking them in the document. */
	writing: string[];
	writingKeys: string[];
	/** Titles that apply and are still unwritten. */
	remaining: string[];
	/** Titles the last run could not draft, and why, in words for the user. */
	failed: string[];
	problem: string | null;
	canDelete: boolean;
}

/** Where a draft stands, for the pages. Read from the document; the job adds progress. */
export function draftView(project: Project, user: Pick<User, 'id' | 'is_admin'>): DraftView {
	const evidence = draftEvidence(project.id);
	const untouched = !!evidence && isUntouchedDraft(evidence);
	const chapters = projectChapters(project.id);
	const titles = new Map(chapters.map((c) => [c.key, c.title]));
	const left = chaptersToDraft(chapters, chapterHoldings(project.id));
	const parents = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
	const written = chapters.filter((c) => c.applicable !== 0 && !parents.has(c.key) && c.content_md.trim()).length;
	const job = jobs.get(project.id);
	const outcome = outcomes.get(project.id);
	const leftKeys = new Set(left.map((c) => c.key));

	return {
		state: draftState({ origin: project.origin, running: !!job, remaining: left.length, written, untouched }),
		untouched,
		total: job?.total ?? 0,
		done: job?.written.size ?? 0,
		writing: job ? [...job.writing].map((k) => titles.get(k) ?? k) : [],
		writingKeys: job ? [...job.writing] : [],
		remaining: left.map((c) => c.title),
		failed: job ? [] : (outcome?.failed ?? []).filter((k) => leftKeys.has(k)).map((k) => titles.get(k) ?? k),
		problem: job ? null : (outcome?.problem ?? null),
		canDelete: untouched && mayDelete(project, user)
	};
}

export type DeleteOutcome = 'deleted' | 'forbidden' | 'touched' | 'busy';

/**
 * Delete an untouched draft: from the database and from disk.
 *
 * Checked again here rather than trusted from the page, and again inside the
 * deleting transaction. A running draft is stopped first and waited for; if it
 * will not settle, nothing is deleted. Under the repository lock, so no writer
 * is part-way through the folder as it goes — and any queued behind it finds
 * the application gone rather than making the repository again.
 */
export async function deleteDraft(project: Project, user: Pick<User, 'id' | 'is_admin'>): Promise<DeleteOutcome> {
	if (!mayDelete(project, user)) return 'forbidden';
	const evidence = draftEvidence(project.id);
	if (!evidence || !isUntouchedDraft(evidence)) return 'touched';
	if (!(await stopDraft(project.id))) return 'busy';

	return withRepo(project.repo_path, async () => {
		if (!deleteUntouchedDraft(project.id)) return 'touched';
		outcomes.delete(project.id);
		// Its row went with the application, and nothing would keep what it made;
		// the call would otherwise run on for minutes. Only once the deletion stands.
		stopMockup(project.id);
		try {
			// A page reading the history can hold a file open on Windows for a moment.
			rmSync(project.repo_path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch (cause) {
			// The deletion stands. A folder left behind is never adopted: a new
			// application skips a name whose folder exists.
			console.error(`[draft] deleted "${project.name}", but its folder is still at ${project.repo_path}:`, cause);
		}
		console.info(`[draft] deleted the untouched draft "${project.name}"`);
		return 'deleted';
	});
}
