/**
 * Schema, applied on boot. Statements are idempotent so this doubles as a
 * migration for a fresh database.
 *
 * Git is the source of truth for chapter *content*; `chapters.content_md` is a
 * read cache so the preview pane renders without shelling out to git.
 */
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
-- Wait for another connection's write rather than failing at once. One process
-- never contends with itself, but an overlapping container during a restart, a
-- script or a test run beside the server would otherwise get SQLITE_BUSY.
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oidc_identities (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer   TEXT NOT NULL,
  subject  TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_default  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  title       TEXT NOT NULL,
  goal        TEXT NOT NULL DEFAULT '',
  purpose     TEXT NOT NULL DEFAULT '',
  questions   TEXT NOT NULL DEFAULT '[]',
  criteria    TEXT NOT NULL DEFAULT '[]',
  position    INTEGER NOT NULL DEFAULT 0,
  is_dynamic  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  template_id INTEGER NOT NULL REFERENCES templates(id),
  owner_id    INTEGER NOT NULL REFERENCES users(id),
  repo_path   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  title          TEXT NOT NULL,
  goal           TEXT NOT NULL DEFAULT '',
  purpose        TEXT NOT NULL DEFAULT '',
  questions      TEXT NOT NULL DEFAULT '[]',
  criteria       TEXT NOT NULL DEFAULT '[]',
  position       INTEGER NOT NULL DEFAULT 0,
  is_dynamic     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'empty',
  open_questions TEXT NOT NULL DEFAULT '[]',
  content_md     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_key TEXT,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  options     TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, id);

-- What must always be true. Chapter prose says what the application is for;
-- these say what it must do, each with scenarios concrete enough to build and
-- test against. Serialised into the chapter files on git write.
CREATE TABLE IF NOT EXISTS requirements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_key TEXT NOT NULL,
  ref         TEXT NOT NULL,
  statement   TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'now',
  scenarios   TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL DEFAULT 'agent',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, ref)
);

CREATE INDEX IF NOT EXISTS idx_requirements_chapter
  ON requirements(project_id, chapter_key, position);

-- What was decided, and by whom. An agent-made decision stays 'proposed' until
-- the user confirms it: they must be able to tell their own choices apart from
-- the defaults chosen on their behalf.
CREATE TABLE IF NOT EXISTS decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_key  TEXT NOT NULL,
  statement    TEXT NOT NULL,
  rationale    TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'agent',
  status       TEXT NOT NULL DEFAULT 'proposed',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, chapter_key);

-- Company-wide answers that should not be re-interviewed for every application.
-- Copied into a new project as requirements with source='standard'; the
-- assistant then asks only where the project needs to deviate.
CREATE TABLE IF NOT EXISTS standards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_key  TEXT NOT NULL,
  statement    TEXT NOT NULL,
  scenarios    TEXT NOT NULL DEFAULT '[]',
  applies_when TEXT NOT NULL DEFAULT '["always"]',
  active       INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);

-- The layered model behind the diagram. Derived on request and kept, because
-- deriving it costs a gateway call and it only changes when the document does.
CREATE TABLE IF NOT EXISTS architectures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  elements   TEXT NOT NULL DEFAULT '[]',
  relations  TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The latest mock-up of each application: one page the assistant made from the
-- document. Not part of the document, so not in its repository; replaced by each
-- one that succeeds. The revision it was made from says whether it is out of date.
CREATE TABLE IF NOT EXISTS mockups (
  project_id        INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  html              TEXT NOT NULL,
  document_revision INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The result of a whole-document check. One row per run; the latest is shown.
-- Kept rather than recomputed because the check costs several gateway calls.
CREATE TABLE IF NOT EXISTS verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issues     TEXT NOT NULL DEFAULT '[]',
  checked    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch     TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  merged_at  TEXT
);

CREATE TABLE IF NOT EXISTS approval_intents (
  proposal_id       INTEGER PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_revision TEXT NOT NULL,
  main_revision     TEXT NOT NULL,
  merge_revision    TEXT,
  phase             TEXT NOT NULL CHECK (phase IN ('prepared', 'merged', 'complete')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS approval_active_per_project
ON approval_intents(project_id) WHERE phase <> 'complete';

-- One-off repairs already applied to this database, so each runs exactly once.
CREATE TABLE IF NOT EXISTS migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documents a repair rewrote that have not yet reached their repository. Kept
-- here rather than in memory: the repair removes its own trigger, so a list held
-- for one boot was lost for good when the commit after it failed.
CREATE TABLE IF NOT EXISTS migrated_documents (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  summary    TEXT NOT NULL
);
`;

/**
 * Columns added after a database may already exist. `CREATE TABLE IF NOT EXISTS`
 * silently does nothing for a table that is already there, so a new column needs
 * an explicit ALTER — guarded, because SQLite has no `ADD COLUMN IF NOT EXISTS`.
 */
export const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
	{ table: 'projects', column: 'document_revision', definition: 'INTEGER NOT NULL DEFAULT 0' },
	{ table: 'verifications', column: 'document_revision', definition: 'INTEGER' },
	{ table: 'verifications', column: 'failed', definition: `TEXT NOT NULL DEFAULT '[]'` },
	{ table: 'messages', column: 'options', definition: `TEXT NOT NULL DEFAULT '[]'` },
	{ table: 'template_chapters', column: 'goal', definition: `TEXT NOT NULL DEFAULT ''` },
	{ table: 'chapters', column: 'goal', definition: `TEXT NOT NULL DEFAULT ''` },

	// Which chapters an application needs, and whether it already exists.
	{
		table: 'template_chapters',
		column: 'applies_when',
		definition: `TEXT NOT NULL DEFAULT '["always"]'`
	},
	{ table: 'chapters', column: 'applies_when', definition: `TEXT NOT NULL DEFAULT '["always"]'` },
	{ table: 'chapters', column: 'applicable', definition: 'INTEGER NOT NULL DEFAULT 1' },
	{ table: 'chapters', column: 'skip_reason', definition: `TEXT NOT NULL DEFAULT ''` },
	{ table: 'projects', column: 'profile', definition: `TEXT NOT NULL DEFAULT '{}'` },
	{ table: 'projects', column: 'kind', definition: `TEXT NOT NULL DEFAULT 'new'` },

	// A requirement describing how things already work, rather than new work.
	{ table: 'requirements', column: 'existing', definition: 'INTEGER NOT NULL DEFAULT 0' },

	// Sub-chapters. Empty means top level; otherwise the parent's key, and
	// `position` becomes relative to that parent.
	{ table: 'chapters', column: 'parent_key', definition: `TEXT NOT NULL DEFAULT ''` },

	// How an account came to exist: 'password', 'oidc', 'proxy', or empty for one
	// created before this was recorded. Needed because someone the gateway signs
	// in has neither a password nor a linked company account, and the people page
	// otherwise reports the normal case — everyone, in the usual deployment — as
	// unable to sign in at all.
	{ table: 'users', column: 'created_via', definition: `TEXT NOT NULL DEFAULT ''` },

	// How an application was started: 'interview', or 'generated' when the
	// assistant drafted the whole of it. The default is the backfill — every
	// application from before this was started by interview. `drafted_revision` is
	// the document revision the draft left it at; see `llm/draft.ts`.
	{ table: 'projects', column: 'origin', definition: `TEXT NOT NULL DEFAULT 'interview'` },
	{ table: 'projects', column: 'drafted_revision', definition: 'INTEGER' }
];
