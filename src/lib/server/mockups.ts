import { getProject, latestMockup, projectChapters, projectRequirements, saveMockup } from './db';
import type { Project } from './db/types';
import { MOCKUP_BUDGET, SCREENS_BUDGET } from './llm/budgets';
import { ranOutOfRoom } from './llm/fallback';
import { describeFailure } from './llm/failures';
import { gateway } from './llm/gateway';
import {
	betterMockup,
	buildMockupPrompt,
	buildScreensPrompt,
	extractMockup,
	extractScreens,
	loadsFromOutside,
	mockupDocument,
	mockupRequest,
	prepareMockup,
	screensRequest,
	worthAnotherTry
} from './llm/mockup';
import { longCalls } from './llm/parallel';

/**
 * Making a mock-up, run by the server.
 *
 * Two calls: one decides the screens, the next writes the page from them, which
 * takes minutes — a drafted chapter of the same size took six. A proxy need not
 * hold a silent request that long and a closed tab would lose it, so the request
 * starts the job and the page follows its progress. What each call is given and
 * which reply is a page are decided in `llm/mockup.ts`.
 *
 * In memory, one job per application, as drafting is. A restart loses a job
 * part-way; nothing is stored until the end, so nothing is lost but the wait.
 */

type Phase = 'waiting' | 'planning' | 'thinking' | 'writing';

interface Job {
	controller: AbortController;
	done: Promise<void>;
	/** Waiting for one of the shared places; deciding the screens; thinking; then writing the page. */
	phase: Phase;
	/** Characters of the page written so far, in this attempt. */
	written: number;
	/** The second attempt, smaller and self-contained. */
	retrying: boolean;
}

const jobs = new Map<number, Job>();
/** Why the last attempt in each application made nothing, for the page that opens next. */
const failures = new Map<number, string>();

const STOPPED = 'Stopped before it was finished.';

export function isMakingMockup(projectId: number): boolean {
	return jobs.has(projectId);
}

/** The document as the call would see it; empty when nothing is written yet. */
export function mockupInput(project: Pick<Project, 'id' | 'name' | 'description'>): string {
	return mockupDocument(project, projectChapters(project.id), projectRequirements(project.id));
}

/**
 * Start making a mock-up. False when one is already being made, or there is
 * nothing written to make it from. Returns at once; the job is detached.
 */
export function startMockup(project: Project): boolean {
	if (jobs.has(project.id)) return false;
	// Read together, with nothing awaited between: the revision kept is the one the
	// document was read at, so "changed since" is never wrong in the safe direction.
	const current = getProject(project.id);
	if (!current) return false;
	const document = mockupInput(current);
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
			console.warn(`[mockup] could not make a mock-up of "${current.name}":`, cause);
			failures.set(project.id, failureInWords(cause));
		})
		.finally(() => {
			jobs.delete(project.id);
		});
	return true;
}

/** The general advice for running out of room is to ask for less, which is the retry's job here. */
function failureInWords(cause: unknown): string {
	if (ranOutOfRoom(cause)) {
		return 'The mock-up was more than the assistant could write in one go, even when asked for a smaller one. Try again in a minute.';
	}
	return `The mock-up could not be made. ${describeFailure(cause, { messageSaved: false })}`;
}

async function run(project: Project, document: string, job: Job): Promise<void> {
	const signal = job.controller.signal;
	// Shared with drafting: three long calls at a time across the installation.
	// One place for both calls, which follow each other.
	await longCalls.run(async () => {
		const screens = await decideScreens(project, document, job);
		if (signal.aborted) return;

		let first: string | null = null;
		try {
			first = await attempt(document, screens, false, job);
		} catch (cause) {
			// Out of room is reported as an error, not an empty reply; it gets the
			// second attempt. Anything else was already retried by the client.
			if (signal.aborted || !ranOutOfRoom(cause)) throw cause;
			console.warn(`[mockup] the page for "${project.name}" ran out of room; asking for a smaller one`);
		}

		let page = first;
		if (worthAnotherTry(first) && !signal.aborted) {
			job.retrying = true;
			try {
				page = betterMockup(first, await attempt(document, screens, true, job));
			} catch (cause) {
				// A page that loads from outside is still worth more than none.
				if (signal.aborted || !first) throw cause;
				console.warn(`[mockup] the second attempt for "${project.name}" failed; keeping the first:`, cause);
			}
		}
		if (signal.aborted) return;

		if (!page) {
			failures.set(project.id, 'The assistant did not write a page this time. Try again in a minute.');
			return;
		}
		if (loadsFromOutside(page).length > 0) {
			console.warn(`[mockup] the mock-up of "${project.name}" loads files from outside it`);
		}
		saveMockup(
			project.id,
			prepareMockup(page, { name: project.name, madeOn: new Date().toISOString().slice(0, 10) }),
			project.document_revision
		);
	}, signal);
}

/**
 * The first call: the screens, or null. Running out of room or writing no list
 * leaves the page call to decide them itself, as one call did before there were
 * two — slower to succeed, but not a reason to give up. An outage is thrown: the
 * page call would meet the same one.
 */
async function decideScreens(project: Project, document: string, job: Job): Promise<string | null> {
	job.phase = 'planning';
	let text = '';
	try {
		for await (const event of gateway.streamChat({
			system: buildScreensPrompt(),
			messages: [{ role: 'user', content: screensRequest(document) }],
			maxTokens: SCREENS_BUDGET,
			signal: job.controller.signal
		})) {
			if (event.type === 'text') text += event.text;
		}
	} catch (cause) {
		if (job.controller.signal.aborted || !ranOutOfRoom(cause)) throw cause;
		console.warn(`[mockup] deciding the screens of "${project.name}" ran out of room; the page call decides them`);
		return null;
	}
	const screens = extractScreens(text);
	if (!screens) console.warn(`[mockup] no screens decided for "${project.name}"; the page call decides them`);
	return screens;
}

/** One call for the page. Null when the reply holds no page. */
async function attempt(document: string, screens: string | null, brief: boolean, job: Job): Promise<string | null> {
	job.phase = 'thinking';
	job.written = 0;
	let text = '';
	for await (const event of gateway.streamChat({
		system: buildMockupPrompt(brief, screens !== null),
		messages: [{ role: 'user', content: mockupRequest(document, screens) }],
		maxTokens: MOCKUP_BUDGET,
		signal: job.controller.signal
	})) {
		if (event.type === 'text') {
			text += event.text;
			job.phase = 'writing';
			job.written = text.length;
		}
	}
	const page = extractMockup(text);
	if (!page) console.warn(`[mockup] no page in ${text.length} characters of reply`);
	return page;
}

/**
 * Stop a mock-up being made. Does not wait: it stores nothing until the end,
 * and nothing once stopped. `byPerson` leaves a word for the page; an
 * application being deleted needs none.
 */
export function stopMockup(projectId: number, byPerson = false): boolean {
	const job = jobs.get(projectId);
	if (!job) return false;
	job.controller.abort(new Error('The mock-up was stopped.'));
	if (byPerson) failures.set(projectId, STOPPED);
	return true;
}

export interface MockupView {
	running: boolean;
	phase: Phase | null;
	/** Characters of the page written so far. */
	written: number;
	retrying: boolean;
	/** Why the last attempt made nothing, in words for the user. */
	problem: string | null;
	/** The mock-up kept now, if any. */
	made: {
		createdAt: string | null;
		/** The document has changed since it was made. */
		stale: boolean;
		/** It loads scripts or styles from outside itself, which cannot load here. */
		incomplete: boolean;
	} | null;
}

/** Where making a mock-up stands, for the pages. */
export function mockupView(project: Pick<Project, 'id'>): MockupView {
	const job = jobs.get(project.id);
	const stored = latestMockup(project.id);
	const current = getProject(project.id);
	return {
		running: !!job,
		phase: job?.phase ?? null,
		written: job?.written ?? 0,
		retrying: job?.retrying ?? false,
		problem: job ? null : (failures.get(project.id) ?? null),
		made: stored
			? {
					createdAt: stored.created_at,
					stale: !!current && current.document_revision !== stored.document_revision,
					incomplete: loadsFromOutside(stored.html).length > 0
				}
			: null
	};
}
