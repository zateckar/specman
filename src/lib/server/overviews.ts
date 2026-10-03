import { getProject, latestOverview, projectChapters, projectRequirements, saveOverview } from './db';
import type { Project } from './db/types';
import { OVERVIEW_BUDGET, OVERVIEW_RETRY_BUDGET } from './llm/budgets';
import { ranOutOfRoom } from './llm/fallback';
import { describeFailure } from './llm/failures';
import { gateway } from './llm/gateway';
import { mockupDocument } from './llm/mockup';
import {
	buildOverviewPrompt,
	buildReport,
	extractOverview,
	overviewRequest,
	readOverview,
	settleOverview,
	type Report
} from './llm/overview';
import { longCalls } from './llm/parallel';
import { describeProfile, toProfile } from './llm/profile';

/**
 * Making an overview, run by the server.
 *
 * One call writes the judgements; `llm/overview.ts` reads them, settles them
 * against the reference architecture and calculates every figure. It takes
 * minutes, as a drafted chapter does, so the request starts the job and the page
 * follows its progress, as for the mock-up.
 *
 * In memory, one job per application. A restart loses a job part-way; nothing is
 * stored until the end, so nothing is lost but the wait.
 */

type Phase = 'waiting' | 'thinking' | 'writing';

interface Job {
	controller: AbortController;
	done: Promise<void>;
	/** Waiting for one of the shared places; thinking; then writing. */
	phase: Phase;
	/** Characters written so far, in this attempt. */
	written: number;
	/** The second attempt. */
	retrying: boolean;
}

const jobs = new Map<number, Job>();
/** Why the last attempt in each application made nothing, for the page that opens next. */
const failures = new Map<number, string>();

const STOPPED = 'Stopped before it was finished.';

export function isMakingOverview(projectId: number): boolean {
	return jobs.has(projectId);
}

/**
 * The document as the call sees it, or '' when nothing is written yet: the same
 * as the mock-up's — what applies, as the first version will have it.
 */
export function overviewInput(project: Pick<Project, 'id' | 'name' | 'description'>): string {
	return mockupDocument(project, projectChapters(project.id), projectRequirements(project.id));
}

function profileOf(project: Project) {
	try {
		return toProfile(JSON.parse(project.profile));
	} catch {
		// An unreadable profile is the default one, as everywhere else.
		return toProfile({});
	}
}

/**
 * Start making an overview. False when one is already being made, or there is
 * nothing written to make it from. Returns at once; the job is detached.
 */
export function startOverview(project: Project): boolean {
	if (jobs.has(project.id)) return false;
	// Read together, with nothing awaited between: the revision kept is the one the
	// document was read at, so "changed since" is never wrong in the safe direction.
	const current = getProject(project.id);
	if (!current) return false;
	const document = overviewInput(current);
	if (!document) return false;

	const job: Job = {
		controller: new AbortController(),
		done: Promise.resolve(),
		phase: 'waiting',
		written: 0,
		retrying: false
	};
	jobs.set(project.id, job);
	failures.delete(project.id);

	// Detached, so nothing above it would catch a rejection — and an unhandled one
	// ends the process.
	job.done = run(current, document, job)
		.catch((cause) => {
			if (job.controller.signal.aborted) return;
			console.warn(`[overview] could not make an overview of "${current.name}":`, cause);
			failures.set(project.id, failureInWords(cause));
		})
		.finally(() => {
			jobs.delete(project.id);
		});
	return true;
}

function failureInWords(cause: unknown): string {
	if (ranOutOfRoom(cause)) {
		return 'The overview was more than the assistant could write in one go, even when asked for a shorter one. Try again in a minute.';
	}
	return `The overview could not be made. ${describeFailure(cause, { messageSaved: false })}`;
}

async function run(project: Project, document: string, job: Job): Promise<void> {
	const signal = job.controller.signal;
	const profile = profileOf(project);
	const request = overviewRequest(document, describeProfile(profile), project.kind === 'change');

	// Shared with drafting and mock-ups: three long calls at a time across the installation.
	await longCalls.run(async () => {
		let reply = null;
		try {
			reply = await attempt(request, false, job);
		} catch (cause) {
			// Out of room is reported as an error, not an empty reply; it gets the
			// second attempt. Anything else was already retried by the client.
			if (signal.aborted || !ranOutOfRoom(cause)) throw cause;
			console.warn(`[overview] the overview of "${project.name}" ran out of room; asking again`);
		}
		if (!reply && !signal.aborted) {
			job.retrying = true;
			reply = await attempt(request, true, job);
		}
		if (signal.aborted) return;

		if (!reply) {
			failures.set(project.id, 'The assistant did not write an overview this time. Try again in a minute.');
			return;
		}
		saveOverview(project.id, settleOverview(reply, { reach: profile.reach }), project.document_revision);
	}, signal);
}

/** One call. Null when the reply is not an overview. */
async function attempt(request: string, brief: boolean, job: Job) {
	job.phase = 'thinking';
	job.written = 0;
	let text = '';
	for await (const event of gateway.streamChat({
		system: buildOverviewPrompt(brief),
		messages: [{ role: 'user', content: request }],
		maxTokens: brief ? OVERVIEW_RETRY_BUDGET : OVERVIEW_BUDGET,
		signal: job.controller.signal
	})) {
		if (event.type === 'text') {
			text += event.text;
			job.phase = 'writing';
			job.written = text.length;
		}
	}
	const overview = extractOverview(text);
	if (!overview) console.warn(`[overview] no overview in ${text.length} characters of reply`);
	return overview;
}

/**
 * Stop an overview being made. Does not wait: it stores nothing until the end,
 * and nothing once stopped. `byPerson` leaves a word for the page; an
 * application being deleted needs none.
 */
export function stopOverview(projectId: number, byPerson = false): boolean {
	const job = jobs.get(projectId);
	if (!job) return false;
	job.controller.abort(new Error('The overview was stopped.'));
	if (byPerson) failures.set(projectId, STOPPED);
	return true;
}

export interface OverviewView {
	running: boolean;
	phase: Phase | null;
	/** Characters written so far. */
	written: number;
	retrying: boolean;
	/** Why the last attempt made nothing, in words for the user. */
	problem: string | null;
	/** The overview kept now, if any. */
	made: {
		createdAt: string | null;
		/** The document has changed since it was made. */
		stale: boolean;
		report: Report;
	} | null;
}

/** Where making an overview stands, with the report when there is one, for the pages. */
export function overviewView(project: Pick<Project, 'id'>): OverviewView {
	const job = jobs.get(project.id);
	const current = getProject(project.id);
	const stored = latestOverview(project.id);
	const overview = stored ? readOverview(stored.content) : null;
	const stale = !!stored && !!current && current.document_revision !== stored.document_revision;
	return {
		running: !!job,
		phase: job?.phase ?? null,
		written: job?.written ?? 0,
		retrying: job?.retrying ?? false,
		problem: job ? null : (failures.get(project.id) ?? null),
		made:
			stored && overview && current
				? {
						createdAt: stored.created_at,
						stale,
						report: buildReport(overview, {
							name: current.name,
							madeOn: (stored.created_at ?? '').slice(0, 10),
							stale
						})
					}
				: null
	};
}
