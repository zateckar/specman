import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../env';
import { ADDED_COLUMNS, SCHEMA } from './schema';
import { DEFAULT_CHAPTERS, DEFAULT_TEMPLATE } from './default-template';
import { DEFAULT_STANDARDS } from './default-standards';
import { chapterApplies, reasonForSkipping, toProfile, type Profile } from '../llm/profile';
import { arrangeChapters, claimSectionKeys, distributeContent, reconcileSections } from '../llm/subchapters';
import { nextRef, sameStatement } from '../llm/requirements';
import {
	chaptersToDraft,
	isUntouchedDraft,
	UNCHECKED_CHAPTER,
	type ChapterHoldings,
	type DraftEvidence
} from '../llm/draft';
import { namesChapter } from '../llm/questions';
import type {
	AnswerOption,
	Chapter,
	ChapterStatus,
	Decision,
	Message,
	Project,
	Requirement,
	Standard,
	Template,
	TemplateChapter,
	User
} from './types';

/** A message row as stored: `options` is still JSON text. */
type MessageRow = Omit<Message, 'options'> & { options: string };

let instance: DatabaseSync | null = null;

/**
 * `node:sqlite` returns `Record<string, SQLOutputValue>`, which TypeScript will
 * not narrow to our row interfaces directly. These keep the casts in one place
 * instead of scattering `as unknown as T` through every query.
 */
const asRow = <T>(value: unknown): T | undefined => value as T | undefined;
const asRows = <T>(value: unknown): T[] => value as T[];

/**
 * SQLite's `datetime('now')` is UTC written without a marker, so a browser
 * parses "2026-08-10 12:57:23" as local time and shows the wrong hour. Anything
 * displayed with a time needs this.
 */
function asIsoTime(value: string | null | undefined): string | null {
	if (!value) return null;
	const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Columns holding JSON can predate the column, or be written by hand. */
function parseJson<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function db(): DatabaseSync {
	if (instance) return instance;

	const path = resolve(process.cwd(), config.databasePath);
	mkdirSync(dirname(path), { recursive: true });

	const database = new DatabaseSync(path);
	// Published before migrating because the backfills reach the store through
	// `db()` like everything else — and withdrawn again if migrating fails, so the
	// next caller retries instead of being handed a half-migrated database.
	instance = database;
	try {
		migrate(database);
	} catch (cause) {
		instance = null;
		database.close();
		throw cause;
	}
	return database;
}

/**
 * Bring a database of any age up to date.
 *
 * The schema's pragmas cannot run inside a transaction; everything after them
 * does, in one, so a column and the backfill that gives it meaning arrive
 * together or not at all, and a seed interrupted half-way is not left half-done
 * for every later boot to skip as already present.
 */
function migrate(database: DatabaseSync): void {
	database.exec(SCHEMA);
	database.exec('BEGIN IMMEDIATE');
	try {
		const added = addMissingColumns(database);
		installDocumentRevisionTriggers(database);
		seedDefaultTemplate(database);
		seedStandards(database);
		backfillGoals(database, added);
		backfillUserOrigins(database);
		once(database, 'file-section-content', () => backfillSectionContent(database));
		once(database, 'drop-navigation-questions', () => backfillNavigationQuestions(database));
		database.exec('COMMIT');
	} catch (cause) {
		database.exec('ROLLBACK');
		throw cause;
	}
}

/**
 * Run a one-off repair exactly once per database.
 *
 * Repairs for a past defect used to run on every boot. Each re-evaluated the
 * whole document against today's state, so a chapter added or renamed since
 * could make a legitimate question look like the old defect and be deleted.
 */
function once(database: DatabaseSync, name: string, work: () => void): void {
	if (database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(name)) return;
	work();
	database.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
}

/**
 * `work` as one transaction, or as part of the caller's when there is one.
 *
 * SQLite does not nest `BEGIN`, and several writers here are called both on
 * their own and from inside a larger transaction — a turn's document update, or
 * the migration at boot.
 */
export function atomically<T>(work: () => T): T {
	const database = db();
	if (database.isTransaction) return work();
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = work();
		database.exec('COMMIT');
		return result;
	} catch (cause) {
		database.exec('ROLLBACK');
		throw cause;
	}
}

/** Database triggers also cover section planning and direct SQL migrations. */
function installDocumentRevisionTriggers(database: DatabaseSync): void {
	database.exec(`CREATE TRIGGER IF NOT EXISTS document_revision_insert_guard
		BEFORE INSERT ON projects
		WHEN typeof(NEW.document_revision) <> 'integer' OR NEW.document_revision < 0
			OR NEW.document_revision > 9007199254740991
		BEGIN SELECT RAISE(ABORT, 'Invalid document revision'); END;
		CREATE TRIGGER IF NOT EXISTS document_revision_update_guard
		BEFORE UPDATE OF document_revision ON projects
		WHEN typeof(NEW.document_revision) <> 'integer' OR NEW.document_revision <= OLD.document_revision
			OR NEW.document_revision > 9007199254740991
		BEGIN SELECT RAISE(ABORT, 'Document revision must increase within the safe integer range'); END;`);
	// A chapter's status and open questions are the assessor's reading of the
	// document, not the document. Counting them made every reply a change — the
	// assessment after a turn that only asked a question writes them — so a
	// colleague's question back failed someone else's slower turn and threw away
	// what it had written. Stale assessments are guarded per chapter instead; see
	// `withChapterUnchanged`. The column list is read from the table, so a column
	// added later counts without anyone remembering to list it; and the trigger is
	// rebuilt every boot, because `IF NOT EXISTS` would keep an older definition.
	const assessed = new Set(['status', 'open_questions', 'updated_at']);
	const chapterColumns = (database.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>)
		.map((column) => column.name)
		.filter((name) => !assessed.has(name));
	database.exec('DROP TRIGGER IF EXISTS document_chapters_UPDATE');
	for (const table of ['chapters', 'requirements', 'decisions']) {
		for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
			const row = event === 'DELETE' ? 'OLD' : 'NEW';
			const on = table === 'chapters' && event === 'UPDATE' ? `UPDATE OF ${chapterColumns.join(', ')}` : event;
			database.exec(`CREATE TRIGGER IF NOT EXISTS document_${table}_${event}
				AFTER ${on} ON ${table} BEGIN
				UPDATE projects SET document_revision = document_revision + 1 WHERE id = ${row}.project_id;
				${event === 'UPDATE' ? `UPDATE projects SET document_revision = document_revision + 1
					WHERE id = OLD.project_id AND OLD.project_id <> NEW.project_id;` : ''}
				END;`);
		}
	}
	database.exec(`CREATE TRIGGER IF NOT EXISTS document_project_metadata
		AFTER UPDATE OF name, description, kind, profile, template_id ON projects BEGIN
		UPDATE projects SET document_revision = document_revision + 1 WHERE id = NEW.id;
		END;`);
}

export class DocumentConflict extends Error {
	constructor() {
		super('The document changed while the assistant was working. Your message is saved, but these proposed changes were not applied. Reload the document before trying again.');
		this.name = 'DocumentConflict';
	}
}

export function documentRevision(projectId: number): number {
	const project = getProject(projectId);
	if (!project) throw new Error('No such project');
	if (!Number.isSafeInteger(project.document_revision) || project.document_revision < 0) {
		throw new Error('Invalid document revision');
	}
	return project.document_revision;
}

/**
 * Apply `work` only if nobody has changed the document since `expected` was read.
 *
 * The revision is checked here, not bumped: the triggers on the document tables
 * bump it for every row that is actually written. Bumping it here as well made
 * every reply a change, including one that wrote nothing, so a colleague's
 * text-only answer failed someone else's slower turn and threw away everything
 * that turn had written.
 *
 * No await or UI events may occur inside this transaction.
 */
export function withDocumentRevision<T>(projectId: number, expected: number, work: () => T): T {
	const database = db();
	database.exec('BEGIN IMMEDIATE');
	try {
		const current = database.prepare('SELECT document_revision AS revision FROM projects WHERE id = ?')
			.get(projectId) as { revision: number } | undefined;
		if (!current || current.revision !== expected) throw new DocumentConflict();
		const result = work();
		if (result && typeof (result as { then?: unknown }).then === 'function') {
			throw new Error('Document updates must be synchronous');
		}
		database.exec('COMMIT');
		return result;
	} catch (cause) {
		database.exec('ROLLBACK');
		throw cause;
	}
}

/**
 * Apply `work` only if the chapter still reads as it did in `seen`.
 *
 * For an assessment, which is a judgement of one chapter: it is stale when that
 * chapter's prose or state has moved since it was read, and not because
 * something was written somewhere else in the document.
 */
export function withChapterUnchanged<T>(projectId: number, seen: Chapter, work: () => T): T {
	return atomically(() => {
		const now = getChapter(projectId, seen.key);
		if (
			!now ||
			now.content_md !== seen.content_md ||
			now.status !== seen.status ||
			JSON.stringify(now.open_questions) !== JSON.stringify(seen.open_questions)
		) {
			throw new DocumentConflict();
		}
		return work();
	});
}

/**
 * Chapters split before the split moved anything.
 *
 * Creating the sub-chapters and leaving every word in the parent is what the first
 * version did, so any document split by it has empty sections that call themselves
 * not started. This files the prose where it belongs, once, on the same terms as
 * doing it at split time: only into an empty section, and only when the heading
 * clearly matches.
 *
 * Third time a change to the data has needed a line here — a new column, a new
 * condition, and now a new arrangement. **Adding the capability migrates nothing.**
 */
function backfillSectionContent(database: DatabaseSync): void {
	const parents = database
		.prepare(
			`SELECT DISTINCT p.project_id AS project_id, p.key AS key
			   FROM chapters p
			   JOIN chapters c ON c.project_id = p.project_id AND c.parent_key = p.key
			  WHERE trim(coalesce(p.content_md, '')) <> ''`
		)
		.all() as Array<{ project_id: number; key: string }>;

	for (const parent of parents) {
		const moved = distributeSectionContent(parent.project_id, parent.key);
		if (moved.filled.length > 0) noteMigrated(parent.project_id, 'Move the chapter into its sub-chapters');
	}
}

/**
 * Invitations to move on, filed as open questions before reconciliation knew
 * to discard them.
 *
 * A finished chapter's last reply suggested the next one as a question, and
 * that question kept the chapter in progress for good: nothing about the
 * chapter was left to answer, so no later turn would ever clear it. Fixing the
 * reconciliation fixes new turns only. A chapter whose every open question was
 * such an invitation was finished in the agent's own judgement, so it is
 * completed; one with real questions besides keeps them and its status.
 */
function backfillNavigationQuestions(database: DatabaseSync): void {
	const rows = database
		.prepare(
			`SELECT project_id, key, title, status, open_questions FROM chapters
			  ORDER BY project_id`
		)
		.all() as Array<{ project_id: number; key: string; title: string; status: string; open_questions: string }>;

	const update = database.prepare(
		'UPDATE chapters SET status = ?, open_questions = ? WHERE project_id = ? AND key = ?'
	);

	for (const row of rows) {
		const questions = parseJson<string[]>(row.open_questions, []);
		if (questions.length === 0) continue;

		const others = rows
			.filter((c) => c.project_id === row.project_id && c.key !== row.key)
			.map((c) => c.title);
		const kept = questions.filter((q) => !namesChapter(q, others));
		if (kept.length === questions.length) continue;

		const status = kept.length === 0 && row.status === 'in_progress' ? 'complete' : row.status;
		update.run(status, JSON.stringify(kept), row.project_id, row.key);
		noteMigrated(row.project_id, 'Drop invitations to move on from open questions');
	}
}

/**
 * Projects a startup backfill rewrote, with what it did to each.
 *
 * The migration changes the database; the document also lives in a repository,
 * and until it is written there the two disagree — a user approving in that window
 * would merge a document whose sections still read "not written yet". Committing
 * is not this module's job, so the list is handed to whoever boots the server.
 *
 * Stored, not held in memory. The repairs remove their own trigger as they run,
 * so a list kept only for this boot was lost for good if the commit failed or
 * the process stopped before it ran: the next boot found nothing to repair and
 * nothing to commit. An entry is cleared only once a commit has written the
 * whole document out.
 */
function noteMigrated(projectId: number, what: string): void {
	const database = db();
	const row = database.prepare('SELECT summary FROM migrated_documents WHERE project_id = ?').get(projectId) as
		| { summary: string }
		| undefined;
	const done = row ? row.summary.split('; ').filter(Boolean) : [];
	if (done.includes(what)) return;
	done.push(what);
	database
		.prepare(
			`INSERT INTO migrated_documents (project_id, summary) VALUES (?, ?)
			 ON CONFLICT (project_id) DO UPDATE SET summary = excluded.summary`
		)
		.run(projectId, done.join('; '));
}

export function projectsMigratedAtStartup(): Array<{ projectId: number; summary: string }> {
	return asRows<{ project_id: number; summary: string }>(
		db().prepare('SELECT project_id, summary FROM migrated_documents ORDER BY project_id').all()
	).map((row) => ({ projectId: row.project_id, summary: row.summary }));
}

/** The whole document has reached the repository; nothing migrated is outstanding. */
export function clearMigrated(projectId: number): void {
	db().prepare('DELETE FROM migrated_documents WHERE project_id = ?').run(projectId);
}

/**
 * Seed the example standards — **switched off**.
 *
 * They are plausible, not approved. Copying invented rules into every new
 * application's specification, where they would read as company policy, would
 * discredit the document in front of the people who own the real standards. An
 * administrator reviews them and turns on the ones that are genuine.
 */
function seedStandards(database: DatabaseSync): void {
	const existing = database.prepare('SELECT COUNT(*) AS n FROM standards').get() as { n: number };
	if (existing.n > 0) return;

	const insert = database.prepare(
		`INSERT INTO standards (chapter_key, statement, scenarios, applies_when, active, position)
		 VALUES (?, ?, ?, ?, 0, ?)`
	);

	DEFAULT_STANDARDS.forEach((standard, index) => {
		insert.run(
			standard.chapterKey,
			standard.statement,
			JSON.stringify(standard.scenarios),
			JSON.stringify(standard.appliesWhen),
			index
		);
	});

	console.info(
		`[db] seeded ${DEFAULT_STANDARDS.length} example standards, all inactive until reviewed`
	);
}

/**
 * Fill in template fields added after a database was created.
 *
 * A new column arrives holding its default — and seeding only runs for a
 * template that does not exist yet, so an install predating the column would
 * never receive the seeded values. Adding a column populates nothing; every new
 * one needs a line here.
 *
 * Only when the column has just been added, in this same transaction. Running
 * on every boot, "untouched" could not be told apart from "deliberately left
 * blank": a goal an administrator cleared came back, a chapter they set to
 * apply always was given its default condition again, and — worse — every
 * application's empty chapter goal was filled from whatever the template said
 * that day, which is a template edit reaching documents already under way.
 */
function backfillGoals(database: DatabaseSync, added: Set<string>): void {
	if (added.has('template_chapters.goal')) {
		const seed = database.prepare(`UPDATE template_chapters SET goal = ? WHERE key = ? AND goal = ''`);
		for (const chapter of DEFAULT_CHAPTERS) seed.run(chapter.goal, chapter.key);
	}

	// Conditions likewise: without this the triage silently keeps every chapter,
	// which looks like it is working and is not.
	if (added.has('template_chapters.applies_when')) {
		const conditions = database.prepare(
			`UPDATE template_chapters SET applies_when = ?
			  WHERE key = ? AND applies_when IN ('["always"]', '[]', '')`
		);
		for (const chapter of DEFAULT_CHAPTERS) {
			if (!chapter.appliesWhen) continue;
			conditions.run(JSON.stringify(chapter.appliesWhen), chapter.key);
		}
	}

	if (!added.has('chapters.goal')) return;

	// Projects take the goal from their own template, matched on chapter key.
	database.exec(`
		UPDATE chapters SET goal = (
		  SELECT tc.goal FROM template_chapters tc
		    JOIN projects p ON p.template_id = tc.template_id
		   WHERE p.id = chapters.project_id AND tc.key = chapters.key
		)
		WHERE goal = '' AND EXISTS (
		  SELECT 1 FROM template_chapters tc
		    JOIN projects p ON p.template_id = tc.template_id
		   WHERE p.id = chapters.project_id AND tc.key = chapters.key AND tc.goal <> ''
		)
	`);

	// The goal is written into each chapter's file and the export, so a document
	// this rewrote has to reach its repository too — every goal was empty a
	// moment ago, so any there now came from here.
	const rewritten = asRows<{ project_id: number }>(
		database.prepare("SELECT DISTINCT project_id FROM chapters WHERE goal <> ''").all()
	);
	for (const { project_id } of rewritten) noteMigrated(project_id, 'Add what each chapter is for');
}

/**
 * Say how accounts created before `users.created_via` existed came to exist.
 *
 * Adding the column populates nothing, and the people page reads it. A password
 * or a linked company account each say plainly where an account came from, so
 * those are recoverable; an account with neither predates this and could have
 * arrived any way, so it is left blank and the page falls back to describing
 * what the account can do rather than guessing at its history.
 */
function backfillUserOrigins(database: DatabaseSync): void {
	database.exec(`
		UPDATE users SET created_via = 'password'
		 WHERE created_via = '' AND password_hash IS NOT NULL;

		UPDATE users SET created_via = 'oidc'
		 WHERE created_via = ''
		   AND EXISTS (SELECT 1 FROM oidc_identities i WHERE i.user_id = users.id);
	`);
}

/** Adds what is missing and says what that was, as `table.column`. */
function addMissingColumns(database: DatabaseSync): Set<string> {
	const added = new Set<string>();
	for (const { table, column, definition } of ADDED_COLUMNS) {
		const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
		if (columns.some((c) => c.name === column)) continue;

		database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
		added.add(`${table}.${column}`);
		console.info(`[db] added column ${table}.${column}`);
	}
	return added;
}

function seedDefaultTemplate(database: DatabaseSync): void {
	const existing = database
		.prepare('SELECT id FROM templates WHERE name = ?')
		.get(DEFAULT_TEMPLATE.name) as { id: number } | undefined;

	// A template with no chapters is a seed that was interrupted before seeding
	// ran in a transaction. Every application created from it would have no
	// chapters at all, so its chapters are seeded now rather than skipped for ever.
	if (existing) {
		const chapters = database
			.prepare('SELECT COUNT(*) AS n FROM template_chapters WHERE template_id = ?')
			.get(existing.id) as { n: number };
		if (chapters.n > 0) return;
	} else {
		database
			.prepare('INSERT INTO templates (name, description, is_default) VALUES (?, ?, 1)')
			.run(DEFAULT_TEMPLATE.name, DEFAULT_TEMPLATE.description);
	}

	const templateId = (
		database.prepare('SELECT id FROM templates WHERE name = ?').get(DEFAULT_TEMPLATE.name) as {
			id: number;
		}
	).id;

	const insert = database.prepare(
		`INSERT INTO template_chapters
		   (template_id, key, title, goal, applies_when, purpose, questions, criteria, position, is_dynamic)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	DEFAULT_CHAPTERS.forEach((chapter, index) => {
		insert.run(
			templateId,
			chapter.key,
			chapter.title,
			chapter.goal,
			JSON.stringify(chapter.appliesWhen ?? ['always']),
			chapter.purpose,
			JSON.stringify(chapter.questions),
			JSON.stringify(chapter.criteria),
			index,
			chapter.is_dynamic ? 1 : 0
		);
	});

	console.info(`[db] seeded default template with ${DEFAULT_CHAPTERS.length} chapters`);
}

/* ---------------------------------------------------------------- templates */

export function defaultTemplate(): Template {
	return asRow<Template>(
		db().prepare('SELECT * FROM templates WHERE is_default = 1 ORDER BY id LIMIT 1').get()
	)!;
}

export function listTemplates(): Template[] {
	return asRows<Template>(db().prepare('SELECT * FROM templates ORDER BY id').all());
}

export function templateChapters(templateId: number): TemplateChapter[] {
	const rows = db()
		.prepare('SELECT * FROM template_chapters WHERE template_id = ? ORDER BY position, id')
		.all(templateId) as Array<Record<string, unknown>>;
	return rows.map(hydrateChapterDefinition) as TemplateChapter[];
}

export function updateTemplateChapter(
	id: number,
	patch: {
		title?: string;
		goal?: string;
		purpose?: string;
		questions?: string[];
		criteria?: string[];
	}
): void {
	const current = db()
		.prepare('SELECT * FROM template_chapters WHERE id = ?')
		.get(id) as Record<string, unknown>;
	if (!current) throw new Error(`No template chapter ${id}`);

	db()
		.prepare(
			`UPDATE template_chapters
			    SET title = ?, goal = ?, purpose = ?, questions = ?, criteria = ?
			  WHERE id = ?`
		)
		.run(
			patch.title ?? (current.title as string),
			patch.goal ?? ((current.goal as string) ?? ''),
			patch.purpose ?? (current.purpose as string),
			JSON.stringify(patch.questions ?? JSON.parse(current.questions as string)),
			JSON.stringify(patch.criteria ?? JSON.parse(current.criteria as string)),
			id
		);
}

/* ----------------------------------------------------------------- projects */

export function createProject(args: {
	name: string;
	description: string;
	ownerId: number;
	templateId: number;
	slug: string;
	repoPath: string;
	profile?: Profile;
	kind?: 'new' | 'change';
	/** `generated` when the assistant is to draft the whole document. */
	origin?: 'interview' | 'generated';
}): Project {
	// One transaction: a failure part-way through the chapters or the standards
	// used to leave an application with some of its chapters, listed on the home
	// page and never repaired.
	return atomically(() => insertProject(args));
}

function insertProject(args: Parameters<typeof createProject>[0]): Project {
	const database = db();
	const profile = toProfile(args.profile);

	database
		.prepare(
			`INSERT INTO projects (name, slug, description, template_id, owner_id, repo_path, profile, kind, origin)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			args.name,
			args.slug,
			args.description,
			args.templateId,
			args.ownerId,
			args.repoPath,
			JSON.stringify(profile),
			args.kind ?? 'new',
			args.origin ?? 'interview'
		);

	const project = asRow<Project>(
		database.prepare('SELECT * FROM projects WHERE slug = ?').get(args.slug)
	)!;

	// Snapshot the template into the project so later template edits don't
	// silently rewrite the questions of a document already under way.
	const insert = database.prepare(
		`INSERT INTO chapters
		   (project_id, key, title, goal, purpose, questions, criteria, position, is_dynamic,
		    applies_when, applicable, skip_reason)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	for (const chapter of templateChapters(args.templateId)) {
		const conditions = chapter.applies_when ?? ['always'];
		const applies = chapterApplies(conditions, profile);

		insert.run(
			project.id,
			chapter.key,
			chapter.title,
			chapter.goal ?? '',
			chapter.purpose,
			JSON.stringify(chapter.questions),
			JSON.stringify(chapter.criteria),
			chapter.position,
			chapter.is_dynamic,
			JSON.stringify(conditions),
			applies ? 1 : 0,
			applies ? '' : reasonForSkipping(conditions, profile)
		);
	}

	inheritStandards(project.id, profile);

	// The chain the draft keeps starts here, after the chapters and standards have
	// moved the revision: nothing of anyone's is in the document yet.
	if (args.origin === 'generated') {
		database.prepare('UPDATE projects SET drafted_revision = document_revision WHERE id = ?').run(project.id);
	}

	// Read again: the row selected above predates every chapter and standard, and
	// the revision they moved.
	return getProject(project.id)!;
}

/**
 * Copy the active standards that match this application into its requirements.
 *
 * They arrive as settled rather than proposed: they are the organisation's
 * decisions, not this user's, and re-litigating them one project at a time is
 * the waste this is meant to remove. The assistant is told to ask only where the
 * application needs to deviate.
 */
function inheritStandards(projectId: number, profile: Profile, onlyChapter?: string): void {
	const database = db();
	// Only chapters that apply: a standard filed under a chapter the triage set
	// aside is a rule for work nobody is doing, reported as an orphan.
	const chapterKeys = new Set(
		asRows<{ key: string }>(
			database.prepare('SELECT key FROM chapters WHERE project_id = ? AND applicable <> 0').all(projectId)
		).map((c) => c.key)
	);
	// What the chapter already holds, so bringing one back twice adds nothing twice.
	const held = new Set(
		asRows<{ chapter_key: string; statement: string }>(
			database
				.prepare("SELECT chapter_key, statement FROM requirements WHERE project_id = ? AND source = 'standard'")
				.all(projectId)
		).map((r) => `${r.chapter_key}\u0000${r.statement}`)
	);

	const standards = asRows<Record<string, unknown>>(
		database.prepare('SELECT * FROM standards WHERE active = 1 ORDER BY position, id').all()
	);

	for (const standard of standards) {
		const chapterKey = standard.chapter_key as string;
		if (onlyChapter !== undefined && chapterKey !== onlyChapter) continue;
		if (!chapterKeys.has(chapterKey)) continue;
		if (held.has(`${chapterKey}\u0000${standard.statement as string}`)) continue;
		if (!chapterApplies(parseJson<string[]>(standard.applies_when as string, ['always']), profile)) {
			continue;
		}

		saveRequirement(projectId, {
			chapterKey,
			statement: standard.statement as string,
			scope: 'now',
			scenarios: parseJson<Array<{ when: string; then: string }>>(
				standard.scenarios as string,
				[]
			),
			source: 'standard'
		});
	}
}

/* ---------------------------------------------------------------- standards */

export function listStandards(): Standard[] {
	return asRows<Record<string, unknown>>(
		db().prepare('SELECT * FROM standards ORDER BY chapter_key, position, id').all()
	).map(
		(row) =>
			({
				...row,
				scenarios: parseJson<Standard['scenarios']>(row.scenarios as string, []),
				applies_when: parseJson<string[]>(row.applies_when as string, ['always'])
			}) as Standard
	);
}

export function updateStandard(
	id: number,
	patch: {
		statement?: string;
		active?: boolean;
		appliesWhen?: string[];
		scenarios?: Array<{ when: string; then: string }>;
	}
): void {
	const current = db().prepare('SELECT * FROM standards WHERE id = ?').get(id) as Record<
		string,
		unknown
	>;
	if (!current) throw new Error(`No standard ${id}`);

	db()
		.prepare('UPDATE standards SET statement = ?, active = ?, applies_when = ?, scenarios = ? WHERE id = ?')
		.run(
			patch.statement ?? (current.statement as string),
			patch.active === undefined ? (current.active as number) : patch.active ? 1 : 0,
			JSON.stringify(patch.appliesWhen ?? parseJson(current.applies_when as string, ['always'])),
			patch.scenarios ? JSON.stringify(patch.scenarios) : (current.scenarios as string),
			id
		);
}

/**
 * Turn a chapter the triage set aside back on, or off again.
 *
 * Turned on, it receives the company standards filed under it, as it would have
 * at creation had the triage not set it aside. It used to come back without
 * them, so an included security chapter was interviewed from nothing and the
 * company's own rules for it were missing from the handoff.
 */
export function setChapterApplicable(
	projectId: number,
	key: string,
	applicable: boolean,
	reason = ''
): void {
	atomically(() => {
		const was = getChapter(projectId, key)?.applicable;
		db()
			.prepare('UPDATE chapters SET applicable = ?, skip_reason = ? WHERE project_id = ? AND key = ?')
			.run(applicable ? 1 : 0, applicable ? '' : reason, projectId, key);
		if (applicable && was === 0) {
			const project = getProject(projectId);
			inheritStandards(projectId, toProfile(parseJson(project?.profile, {})), key);
		}
	});
}

/**
 * Remove an application and everything stored against it.
 *
 * Only for undoing a creation whose repository could not be made. The interface
 * deletes nothing but an untouched draft, through `deleteUntouchedDraft`. Every
 * dependent table cascades.
 */
export function deleteProject(id: number): void {
	db().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------- drafts */

/**
 * What people have put into each chapter: their messages, any decision, and
 * rules other than inherited standards. A chapter missing from the map holds none.
 */
export function chapterHoldings(projectId: number, chapterKey?: string): Map<string, ChapterHoldings> {
	const database = db();
	const only = chapterKey === undefined ? '' : ' AND chapter_key = ?';
	const params = chapterKey === undefined ? [projectId] : [projectId, chapterKey];
	const count = (sql: string) =>
		asRows<{ chapter_key: string; n: number }>(database.prepare(sql).all(...params));

	const holdings = new Map<string, ChapterHoldings>();
	const at = (key: string) => {
		let found = holdings.get(key);
		if (!found) {
			found = { messages: 0, decisions: 0, rules: 0 };
			holdings.set(key, found);
		}
		return found;
	};
	for (const row of count(`SELECT chapter_key, COUNT(*) AS n FROM messages
			WHERE project_id = ? AND role = 'user' AND chapter_key IS NOT NULL${only} GROUP BY chapter_key`)) {
		at(row.chapter_key).messages = Number(row.n);
	}
	for (const row of count(`SELECT chapter_key, COUNT(*) AS n FROM decisions
			WHERE project_id = ?${only} GROUP BY chapter_key`)) {
		at(row.chapter_key).decisions = Number(row.n);
	}
	for (const row of count(`SELECT chapter_key, COUNT(*) AS n FROM requirements
			WHERE project_id = ? AND source <> 'standard'${only} GROUP BY chapter_key`)) {
		at(row.chapter_key).rules = Number(row.n);
	}
	return holdings;
}

/** The facts `isUntouchedDraft` reads. Undefined for an application that is gone. */
export function draftEvidence(projectId: number): DraftEvidence | undefined {
	const row = asRow<{
		origin: string;
		document_revision: number;
		drafted_revision: number | null;
		user_messages: number;
		reviewed: number;
	}>(
		db()
			.prepare(
				`SELECT origin, document_revision, drafted_revision,
				        (SELECT COUNT(*) FROM messages m WHERE m.project_id = p.id AND m.role = 'user') AS user_messages,
				        (SELECT COUNT(*) FROM proposals r WHERE r.project_id = p.id AND r.state <> 'draft')
				      + (SELECT COUNT(*) FROM approval_intents a WHERE a.project_id = p.id) AS reviewed
				   FROM projects p WHERE p.id = ?`
			)
			.get(projectId)
	);
	if (!row) return undefined;
	return {
		origin: row.origin,
		documentRevision: Number(row.document_revision),
		draftedRevision: row.drafted_revision === null ? null : Number(row.drafted_revision),
		userMessages: Number(row.user_messages),
		reviewed: Number(row.reviewed)
	};
}

export function isUntouched(projectId: number): boolean {
	const evidence = draftEvidence(projectId);
	return !!evidence && isUntouchedDraft(evidence);
}

/**
 * File one drafted chapter: its prose, its rules and its decisions, in one
 * transaction. `taken` when the chapter is no longer the drafter's to write —
 * someone has put something into it since the draft began, or it is gone — and
 * nothing is written.
 *
 * The draft's revision follows the document only while nothing else has written
 * to it; once anything has, the chain is broken for good and the application is
 * no longer an untouched draft. See `llm/draft.ts`.
 */
export function recordDraftedChapter(
	projectId: number,
	chapterKey: string,
	draft: {
		prose: string;
		rules: Array<{ statement: string; scope: string; scenarios: Array<{ when: string; then: string }>; existing: boolean }>;
		decisions: Array<{ statement: string; rationale: string }>;
		/** The completeness verdict, taken before the write so one commit holds both. */
		status: ChapterStatus;
		openQuestions: string[];
	}
): 'written' | 'taken' {
	return atomically(() => {
		const database = db();
		const before = asRow<{ document_revision: number; drafted_revision: number | null }>(
			database.prepare('SELECT document_revision, drafted_revision FROM projects WHERE id = ?').get(projectId)
		);
		if (!before) return 'taken';
		const stillOpen = chaptersToDraft(projectChapters(projectId), chapterHoldings(projectId, chapterKey));
		if (!stillOpen.some((c) => c.key === chapterKey)) return 'taken';

		updateChapterState(projectId, chapterKey, {
			status: draft.status,
			openQuestions: draft.openQuestions,
			contentMd: draft.prose
		});

		// Every rule is new: there is nothing of the draft's to change. One worded
		// like a rule already here — a company standard, usually — or like one
		// earlier in the same reply is the same rule.
		const held = chapterRequirements(projectId, chapterKey).map((r) => r.statement);
		for (const rule of draft.rules) {
			if (held.some((statement) => sameStatement(statement, rule.statement))) continue;
			held.push(rule.statement);
			saveRequirement(projectId, { chapterKey, ...rule, source: 'agent' });
		}

		const decisions = draft.decisions.length > 0 ? draft.decisions : [UNCHECKED_CHAPTER];
		for (const decision of decisions) {
			saveDecision(projectId, { chapterKey, ...decision, source: 'agent' });
		}

		if (before.drafted_revision !== null && Number(before.drafted_revision) === Number(before.document_revision)) {
			database.prepare('UPDATE projects SET drafted_revision = document_revision WHERE id = ?').run(projectId);
		}
		return 'written';
	});
}

/**
 * Delete an application only if it is still an untouched draft, judged in the
 * same transaction as the deletion. Every dependent table cascades.
 */
export function deleteUntouchedDraft(projectId: number): boolean {
	return atomically(() => {
		if (!isUntouched(projectId)) return false;
		db().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
		return true;
	});
}

/** Confirm every assumption the assistant made in one chapter. How many were confirmed. */
export function confirmChapterDecisions(projectId: number, chapterKey: string): number {
	const result = db()
		.prepare(
			`UPDATE decisions SET status = 'confirmed', confirmed_at = datetime('now')
			  WHERE project_id = ? AND chapter_key = ? AND source <> 'user' AND status <> 'confirmed'`
		)
		.run(projectId, chapterKey);
	return Number(result.changes);
}

export function listProjects(): Project[] {
	return asRows<Project>(db().prepare('SELECT * FROM projects ORDER BY created_at DESC').all());
}

export function getProject(id: number): Project | undefined {
	return asRow<Project>(db().prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

export function slugExists(slug: string): boolean {
	return !!db().prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug);
}

/* ----------------------------------------------------------------- chapters */

/** One malformed value written by hand used to take the home page down with it. */
function hydrateChapterDefinition(row: Record<string, unknown>) {
	return {
		...row,
		questions: parseJson<string[]>(row.questions as string, []),
		criteria: parseJson<string[]>(row.criteria as string, []),
		applies_when: parseJson<string[]>(row.applies_when as string, ['always']),
		...(row.open_questions !== undefined
			? { open_questions: parseJson<string[]>(row.open_questions as string, []) }
			: {})
	};
}

/**
 * Every chapter, in reading order: each top-level chapter followed by its own
 * sub-chapters. Arranging here means no caller has to know about the hierarchy.
 */
export function projectChapters(projectId: number): Chapter[] {
	const rows = db()
		.prepare('SELECT * FROM chapters WHERE project_id = ?')
		.all(projectId) as Array<Record<string, unknown>>;
	return arrangeChapters(rows.map(hydrateChapterDefinition) as Chapter[]);
}

export function getChapter(projectId: number, key: string): Chapter | undefined {
	const row = db()
		.prepare('SELECT * FROM chapters WHERE project_id = ? AND key = ?')
		.get(projectId, key) as Record<string, unknown> | undefined;
	return row ? (hydrateChapterDefinition(row) as Chapter) : undefined;
}

export function updateChapterState(
	projectId: number,
	key: string,
	patch: { status?: string; openQuestions?: string[]; contentMd?: string }
): void {
	const current = getChapter(projectId, key);
	if (!current) throw new Error(`No chapter ${key} in project ${projectId}`);

	// The prose is set only when it changes. Writing it is a change to the
	// document and recording the assessment is not, and the revision trigger fires
	// on `content_md` being set at all, whatever it is set to.
	const prose = patch.contentMd !== undefined && patch.contentMd !== current.content_md;
	db()
		.prepare(
			`UPDATE chapters
			    SET status = ?, open_questions = ?,${prose ? ' content_md = ?,' : ''} updated_at = datetime('now')
			  WHERE project_id = ? AND key = ?`
		)
		.run(
			patch.status ?? current.status,
			JSON.stringify(patch.openQuestions ?? current.open_questions),
			...(prose ? [patch.contentMd!] : []),
			projectId,
			key
		);
}

/**
 * Apply a sub-chapter plan the agent proposed for one parent chapter.
 *
 * Reconciliation decides what to do (`llm/subchapters.ts`); this only carries it
 * out. A removal is only ever generated for a sub-chapter with nothing in it, so
 * nothing written can be lost here.
 */
export function applySectionPlan(
	projectId: number,
	parent: Chapter,
	planned: Array<{ key: string; title: string }>
): { created: string[]; changed: boolean } {
	const database = db();

	const existing = asRows<Record<string, unknown>>(
		database
			.prepare('SELECT * FROM chapters WHERE project_id = ? AND parent_key = ?')
			.all(projectId, parent.key)
	).map((row) => {
		const key = String(row.key);
		// Anything at all in it counts: prose, a requirement, or even a
		// conversation. Removal must never lose something the user contributed.
		const hasContent =
			String(row.content_md ?? '').trim().length > 0 ||
			!!database
				.prepare('SELECT 1 FROM requirements WHERE project_id = ? AND chapter_key = ? LIMIT 1')
				.get(projectId, key) ||
			!!database
				.prepare('SELECT 1 FROM messages WHERE project_id = ? AND chapter_key = ? LIMIT 1')
				.get(projectId, key);

		return { key, title: String(row.title), position: Number(row.position), hasContent };
	});

	const elsewhere = asRows<{ key: string }>(
		database
			.prepare("SELECT key FROM chapters WHERE project_id = ? AND coalesce(parent_key, '') <> ?")
			.all(projectId, parent.key)
	).map((row) => row.key);
	const ops = reconcileSections(existing, claimSectionKeys(planned, parent.key, elsewhere));
	const created: string[] = [];

	for (const op of ops) {
		switch (op.kind) {
			case 'create':
				database
					.prepare(
						`INSERT INTO chapters
						   (project_id, key, title, goal, purpose, questions, criteria, position,
						    is_dynamic, parent_key, applies_when, applicable)
						 VALUES (?, ?, ?, '', ?, '[]', '[]', ?, 1, ?, '["always"]', 1)`
					)
					.run(projectId, op.key, op.title, parent.purpose, op.position, parent.key);
				created.push(op.key);
				break;

			case 'rename':
				database
					.prepare('UPDATE chapters SET title = ? WHERE project_id = ? AND key = ?')
					.run(op.title, projectId, op.key);
				break;

			case 'move':
				database
					.prepare('UPDATE chapters SET position = ? WHERE project_id = ? AND key = ?')
					.run(op.position, projectId, op.key);
				break;

			case 'remove':
				database
					.prepare('DELETE FROM chapters WHERE project_id = ? AND key = ? AND parent_key = ?')
					.run(projectId, op.key, parent.key);
				break;
		}
	}

	return { created, changed: ops.length > 0 };
}

/**
 * Move a split chapter's prose down into its sections.
 *
 * Only ever into a section that is empty, so nothing written is overwritten, and
 * whatever cannot be placed stays on the parent where it can still be read. See
 * `llm/subchapters.ts` for how a heading is matched to a section.
 *
 * Safe to call repeatedly: once a section holds something it is occupied, and a
 * heading that failed to match will fail again without changing anything.
 */
export function distributeSectionContent(
	projectId: number,
	parentKey: string
): { filled: Array<{ key: string; markdown: string }>; parentMd: string | null } {
	const database = db();

	const parent = database
		.prepare('SELECT content_md FROM chapters WHERE project_id = ? AND key = ?')
		.get(projectId, parentKey) as { content_md?: string } | undefined;

	const content = String(parent?.content_md ?? '');
	if (!content.trim()) return { filled: [], parentMd: null };

	const children = asRows<Record<string, unknown>>(
		database
			.prepare('SELECT key, title, content_md FROM chapters WHERE project_id = ? AND parent_key = ?')
			.all(projectId, parentKey)
	);
	if (children.length === 0) return { filled: [], parentMd: null };

	const { parent: leftover, filed } = distributeContent(
		content,
		children.map((child) => ({
			key: String(child.key),
			title: String(child.title),
			occupied: String(child.content_md ?? '').trim().length > 0
		}))
	);

	if (filed.length === 0) return { filled: [], parentMd: null };

	// Sections and parent together. Apart, a failure between them left the prose
	// in both — and the section, now occupied, would never be filed again.
	atomically(() => {
		const write = database.prepare(
			`UPDATE chapters
			    SET content_md = ?,
			        status = CASE WHEN status = 'empty' THEN 'in_progress' ELSE status END,
			        updated_at = datetime('now')
			  WHERE project_id = ? AND key = ?`
		);
		for (const section of filed) write.run(section.markdown, projectId, section.key);

		database
			.prepare(`UPDATE chapters SET content_md = ?, updated_at = datetime('now')
			           WHERE project_id = ? AND key = ?`)
			.run(leftover, projectId, parentKey);
	});

	console.info(
		`[db] filed ${filed.length} section${filed.length === 1 ? '' : 's'} of ${parentKey} into its sub-chapters`
	);

	return { filled: filed, parentMd: leftover };
}

/** Adds a dynamic sub-chapter the agent decided the document needs. */
export function addDynamicChapter(
	projectId: number,
	args: { key: string; title: string; purpose: string; afterPosition: number }
): void {
	db()
		.prepare(
			`INSERT OR IGNORE INTO chapters
			   (project_id, key, title, purpose, questions, criteria, position, is_dynamic, status)
			 VALUES (?, ?, ?, ?, '[]', '[]', ?, 1, 'empty')`
		)
		.run(projectId, args.key, args.title, args.purpose, args.afterPosition);
}

/* ----------------------------------------------------------------- messages */

export function addMessage(
	projectId: number,
	chapterKey: string | null,
	role: 'user' | 'assistant',
	content: string,
	options: AnswerOption[] = []
): number {
	db()
		.prepare(
			'INSERT INTO messages (project_id, chapter_key, role, content, options) VALUES (?, ?, ?, ?, ?)'
		)
		.run(projectId, chapterKey, role, content, JSON.stringify(options));

	return Number(db().prepare('SELECT last_insert_rowid() AS id').get()!.id);
}

/** Attaches answer options to a message already stored. */
export function setMessageOptions(messageId: number, options: AnswerOption[]): void {
	db()
		.prepare('UPDATE messages SET options = ? WHERE id = ?')
		.run(JSON.stringify(options), messageId);
}

/**
 * The transcript for one scope.
 *
 * A null key means the whole-document conversation, which is a conversation in
 * its own right — NOT every message in the project. Pooling them made the
 * whole-document pane replay fragments of chapter interviews out of context.
 */
export function recentMessages(projectId: number, chapterKey: string | null, limit = 20): Message[] {
	const rows = chapterKey
		? db()
				.prepare(
					`SELECT * FROM messages WHERE project_id = ? AND chapter_key = ?
					  ORDER BY id DESC LIMIT ?`
				)
				.all(projectId, chapterKey, limit)
		: db()
				.prepare(
					`SELECT * FROM messages WHERE project_id = ? AND chapter_key IS NULL
					  ORDER BY id DESC LIMIT ?`
				)
				.all(projectId, limit);

	return asRows<MessageRow>(rows)
		.reverse()
		.map((row) => ({ ...row, options: parseJson<AnswerOption[]>(row.options, []) }));
}

/**
 * The transcript for one scope from its `offset`-th message on, oldest first.
 * With `historyWindowStart`, the window a turn replays: one whose start stays
 * put for several turns, so the gateway's cache can serve it.
 */
export function messagesFrom(projectId: number, chapterKey: string | null, offset: number): Message[] {
	const scope = chapterKey ? 'chapter_key = ?' : 'chapter_key IS NULL';
	const rows = db()
		.prepare(`SELECT * FROM messages WHERE project_id = ? AND ${scope} ORDER BY id LIMIT -1 OFFSET ?`)
		.all(...(chapterKey ? [projectId, chapterKey, offset] : [projectId, offset]));
	return asRows<MessageRow>(rows).map((row) => ({ ...row, options: parseJson<AnswerOption[]>(row.options, []) }));
}

export function messageCount(projectId: number, chapterKey: string | null): number {
	const scope = chapterKey ? 'chapter_key = ?' : 'chapter_key IS NULL';
	const row = db()
		.prepare(`SELECT COUNT(*) AS n FROM messages WHERE project_id = ? AND ${scope}`)
		.get(...(chapterKey ? [projectId, chapterKey] : [projectId])) as { n: number };
	return Number(row.n);
}

/* ------------------------------------------------------------- requirements */

function hydrateRequirement(row: Record<string, unknown>): Requirement {
	return {
		...row,
		scenarios: parseJson<Requirement['scenarios']>(row.scenarios as string, [])
	} as Requirement;
}

export function projectRequirements(projectId: number): Requirement[] {
	const rows = db()
		.prepare(
			`SELECT * FROM requirements WHERE project_id = ?
			  ORDER BY chapter_key, position, id`
		)
		.all(projectId) as Array<Record<string, unknown>>;
	return rows.map(hydrateRequirement);
}

export function chapterRequirements(projectId: number, chapterKey: string): Requirement[] {
	const rows = db()
		.prepare(
			`SELECT * FROM requirements WHERE project_id = ? AND chapter_key = ?
			  ORDER BY position, id`
		)
		.all(projectId, chapterKey) as Array<Record<string, unknown>>;
	return rows.map(hydrateRequirement);
}

export function getRequirement(projectId: number, ref: string): Requirement | undefined {
	const row = db()
		.prepare('SELECT * FROM requirements WHERE project_id = ? AND ref = ?')
		.get(projectId, ref) as Record<string, unknown> | undefined;
	return row ? hydrateRequirement(row) : undefined;
}

/**
 * Inserts or updates one requirement, assigning the ref when it is new.
 *
 * Refs are allocated here rather than by the model: a model that invents its own
 * references collides with itself and silently renumbers, which would sever the
 * traceability that change review and verification depend on.
 */
export function saveRequirement(
	projectId: number,
	input: {
		ref?: string | null;
		chapterKey: string;
		statement: string;
		scope: string;
		scenarios: Array<{ when: string; then: string }>;
		source?: 'user' | 'agent' | 'standard';
		existing?: boolean;
	}
): Requirement {
	const database = db();
	const existing = input.ref ? getRequirement(projectId, input.ref) : undefined;

	if (existing) {
		// `existing` is updated too. It is set by re-stating a requirement with its
		// reference — which is the only way to set it at all on a rule that has
		// already been recorded — so leaving it out of the UPDATE made the flag
		// unsettable in exactly the projects it was built for: the ones changing an
		// application that already runs.
		//
		// `source` is deliberately not updated: who first raised a rule does not
		// change because its wording did, and a company standard must stay marked
		// as one however often it is reworded.
		database
			.prepare(
				`UPDATE requirements
				    SET chapter_key = ?, statement = ?, scope = ?, scenarios = ?, existing = ?,
				        updated_at = datetime('now')
				  WHERE project_id = ? AND ref = ?`
			)
			.run(
				input.chapterKey,
				input.statement,
				input.scope,
				JSON.stringify(input.scenarios),
				input.existing ? 1 : 0,
				projectId,
				existing.ref
			);
		return getRequirement(projectId, existing.ref)!;
	}

	const refs = asRows<{ ref: string }>(
		database.prepare('SELECT ref FROM requirements WHERE project_id = ?').all(projectId)
	).map((r) => r.ref);

	const position =
		Number(
			asRow<{ n: number }>(
				database
					.prepare(
						'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM requirements WHERE project_id = ? AND chapter_key = ?'
					)
					.get(projectId, input.chapterKey)
			)?.n
		) || 0;

	const ref = nextRef(refs);
	database
		.prepare(
			`INSERT INTO requirements
			   (project_id, chapter_key, ref, statement, scope, scenarios, source, position, existing)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			projectId,
			input.chapterKey,
			ref,
			input.statement,
			input.scope,
			JSON.stringify(input.scenarios),
			input.source ?? 'agent',
			position,
			input.existing ? 1 : 0
		);

	return getRequirement(projectId, ref)!;
}

export function deleteRequirement(projectId: number, ref: string): boolean {
	const existing = getRequirement(projectId, ref);
	if (!existing) return false;
	db().prepare('DELETE FROM requirements WHERE project_id = ? AND ref = ?').run(projectId, ref);
	return true;
}

/* ---------------------------------------------------------------- decisions */

export function projectDecisions(projectId: number): Decision[] {
	return asRows<Decision>(
		db()
			.prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY chapter_key, id')
			.all(projectId)
	);
}

export function getDecision(id: number): Decision | undefined {
	return asRow<Decision>(db().prepare('SELECT * FROM decisions WHERE id = ?').get(id));
}

/**
 * Records a decision, or returns the existing one if it is already known.
 *
 * The agent re-states settled decisions as it rewrites a chapter, so matching on
 * the wording keeps a confirmed decision from reverting to "proposed" every turn
 * and asking the user to agree to the same thing repeatedly.
 */
export function saveDecision(
	projectId: number,
	input: { chapterKey: string; statement: string; rationale: string; source: string }
): Decision {
	const database = db();

	const existing = asRow<Decision>(
		database
			.prepare(
				`SELECT * FROM decisions
				  WHERE project_id = ? AND chapter_key = ? AND lower(statement) = lower(?)`
			)
			.get(projectId, input.chapterKey, input.statement)
	);

	if (existing) {
		if (input.rationale && !existing.rationale) {
			database.prepare('UPDATE decisions SET rationale = ? WHERE id = ?').run(input.rationale, existing.id);
			return getDecision(existing.id)!;
		}
		return existing;
	}

	// A decision the user stated themselves needs no confirming.
	const status = input.source === 'user' ? 'confirmed' : 'proposed';

	database
		.prepare(
			`INSERT INTO decisions (project_id, chapter_key, statement, rationale, source, status, confirmed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			projectId,
			input.chapterKey,
			input.statement,
			input.rationale,
			input.source,
			status,
			status === 'confirmed' ? new Date().toISOString() : null
		);

	const id = Number(database.prepare('SELECT last_insert_rowid() AS id').get()!.id);
	return getDecision(id)!;
}

/** Idempotent: confirming twice keeps the time it was first confirmed. */
export function confirmDecision(projectId: number, id: number): Decision | undefined {
	db()
		.prepare(
			`UPDATE decisions SET status = 'confirmed', confirmed_at = datetime('now')
			  WHERE id = ? AND project_id = ? AND status <> 'confirmed'`
		)
		.run(id, projectId);
	return getDecision(id);
}

export function deleteDecision(projectId: number, id: number): void {
	db().prepare('DELETE FROM decisions WHERE id = ? AND project_id = ?').run(id, projectId);
}
/* ----------------------------------------------------------- architectures */

export interface StoredArchitecture {
	elements: unknown[];
	relations: unknown[];
	created_at: string | null;
}

export function saveArchitecture(
	projectId: number,
	elements: unknown[],
	relations: unknown[]
): void {
	db()
		.prepare('INSERT INTO architectures (project_id, elements, relations) VALUES (?, ?, ?)')
		.run(projectId, JSON.stringify(elements), JSON.stringify(relations));
}

/**
 * The most recent diagram with something in it. Failed drawings used to be
 * stored as empty models; skipping them here means one of those, left from
 * before, does not hide the good picture drawn ahead of it.
 */
export function latestArchitecture(projectId: number): StoredArchitecture | undefined {
	const row = db()
		.prepare(
			`SELECT * FROM architectures
			  WHERE project_id = ? AND elements NOT IN ('', '[]')
			  ORDER BY id DESC LIMIT 1`
		)
		.get(projectId) as Record<string, unknown> | undefined;
	if (!row) return undefined;

	return {
		elements: parseJson<unknown[]>(row.elements as string, []),
		relations: parseJson<unknown[]>(row.relations as string, []),
		created_at: asIsoTime(row.created_at as string)
	};
}

/* ---------------------------------------------------------------- mockups */

export interface StoredMockup {
	html: string;
	/** The document revision it was made from. */
	document_revision: number;
	created_at: string | null;
}

/**
 * Keep a mock-up as the application's, replacing the one before. Nothing is
 * stored for an application deleted while its mock-up was being made.
 */
export function saveMockup(projectId: number, html: string, documentRevision: number): void {
	db()
		.prepare(
			`INSERT INTO mockups (project_id, html, document_revision)
			 SELECT id, ?, ? FROM projects WHERE id = ?
			 ON CONFLICT (project_id) DO UPDATE SET
			   html = excluded.html,
			   document_revision = excluded.document_revision,
			   created_at = datetime('now')`
		)
		.run(html, documentRevision, projectId);
}

export function latestMockup(projectId: number): StoredMockup | undefined {
	const row = db().prepare('SELECT * FROM mockups WHERE project_id = ?').get(projectId) as
		| Record<string, unknown>
		| undefined;
	if (!row) return undefined;
	return {
		html: row.html as string,
		document_revision: Number(row.document_revision),
		created_at: asIsoTime(row.created_at as string)
	};
}

/* ------------------------------------------------------------ verifications */

export interface VerificationRow {
	id: number;
	project_id: number;
	issues: unknown[];
	checked: string[];
	failed: string[];
	document_revision: number | null;
	stale: boolean;
	created_at: string;
}

export function saveVerification(
	projectId: number,
	issues: unknown[],
	checked: string[],
	failed: string[] = [],
	revision: number | null = null
): VerificationRow {
	const database = db();
	if (revision === null) {
		database.prepare('INSERT INTO verifications (project_id, issues, checked, failed) VALUES (?, ?, ?, ?)')
			.run(projectId, JSON.stringify(issues), JSON.stringify(checked), JSON.stringify(failed));
	} else {
		const saved = database.prepare(`INSERT INTO verifications (project_id, issues, checked, failed, document_revision)
			SELECT id, ?, ?, ?, document_revision FROM projects WHERE id = ? AND document_revision = ?`)
			.run(JSON.stringify(issues), JSON.stringify(checked), JSON.stringify(failed), projectId, revision);
		if (!saved.changes) throw new DocumentConflict();
	}

	return latestVerification(projectId)!;
}

export function latestVerification(projectId: number): VerificationRow | undefined {
	const row = db()
		.prepare('SELECT * FROM verifications WHERE project_id = ? ORDER BY id DESC LIMIT 1')
		.get(projectId) as Record<string, unknown> | undefined;
	if (!row) return undefined;

	return {
		...row,
		issues: parseJson<unknown[]>(row.issues as string, []),
		checked: parseJson<string[]>(row.checked as string, []),
		failed: parseJson<string[]>(row.failed as string, []),
		stale: row.document_revision == null || row.document_revision !== getProject(projectId)?.document_revision,
		created_at: asIsoTime(row.created_at as string)
	} as VerificationRow;
}

/* -------------------------------------------------------------------- users */

export function getUserByUsername(username: string): (User & { password_hash: string; password_salt: string }) | undefined {
	return db().prepare('SELECT * FROM users WHERE username = ?').get(username) as
		| (User & { password_hash: string; password_salt: string })
		| undefined;
}

/**
 * Named columns, not `SELECT *`.
 *
 * This row becomes `locals.user`, which a load function may return to the
 * browser. `SELECT *` cast to `User` type-checks — the interface does not
 * declare the credential columns — while the object still carries
 * `password_hash` and `password_salt` at runtime, and serialisation follows the
 * object rather than the type. Ask for the columns that may leave the server.
 */
export function getUser(id: number): User | undefined {
	return db()
		.prepare(
			'SELECT id, username, display_name, is_admin, created_at FROM users WHERE id = ?'
		)
		.get(id) as User | undefined;
}

export function countUsers(): number {
	return (db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/**
 * Everyone, for the people page — with how each of them signs in.
 *
 * `has_password` and `sso` are derived in SQL rather than returned raw so the
 * credential columns never leave the database, on the same terms as `getUser`.
 *
 * `created_via` is here because neither of those two describes the usual case:
 * behind the gateway an account has no password and no linked company account,
 * and is signed in perfectly well regardless.
 */
export function listUsers(): Array<
	User & { has_password: number; sso: number; identities: string; created_via: string }
> {
	return db()
		.prepare(
			`SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at, u.created_via,
			        CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
			        CASE WHEN i.n > 0 THEN 1 ELSE 0 END AS sso,
			        COALESCE(i.issuers, '') AS identities
			   FROM users u
			   LEFT JOIN (
			     SELECT user_id, COUNT(*) AS n, GROUP_CONCAT(issuer, ', ') AS issuers
			       FROM oidc_identities GROUP BY user_id
			   ) i ON i.user_id = u.id
			  ORDER BY u.is_admin DESC, u.username`
		)
		.all() as unknown as Array<
		User & { has_password: number; sso: number; identities: string; created_via: string }
	>;
}

export function countAdmins(): number {
	return (db().prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number })
		.n;
}

/**
 * Grant or withdraw administrator rights.
 *
 * Refuses to remove the last one. An installation with no administrator cannot
 * appoint one — the bootstrap account is created only while the user table is
 * empty, so the way back is editing the database by hand.
 */
export function setUserAdmin(id: number, isAdmin: boolean): void {
	const user = getUser(id);
	if (!user) throw new Error(`No user ${id}`);

	if (!isAdmin && user.is_admin && countAdmins() <= 1) {
		throw new Error('Refusing to remove the only administrator.');
	}

	db().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
}
