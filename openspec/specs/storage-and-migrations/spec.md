# Storage, boot and migrations

## Purpose

Git holds the prose of each application's document; SQLite holds everything else and caches
the prose so the preview renders without shelling out to git. This capability owns that
split, the schema, and the boot sequence — including the part that has gone wrong three
times: **adding a capability migrates nothing**. A database that already exists gains
neither a new column, nor a new default, nor a new arrangement, unless something explicitly
gives it one.

## Source

- `src/lib/server/db/index.ts`
- `src/lib/server/db/schema.ts`
- `src/lib/server/db/types.ts`
- `src/hooks.server.ts`

## Requirements

### Requirement: Document revisions cover every persisted model input
Storage SHALL migrate existing projects to a monotonic document revision and invalidate
snapshots on chapter, requirement, decision and project-context changes, including section planning.

#### Scenario: An older project is opened
- **WHEN** its schema lacks document revisions
- **THEN** the revision column and mutation triggers are installed while preserving its content

#### Scenario: A guarded update fails
- **WHEN** any part of a reply's synchronous transaction raises
- **THEN** all its mutations and revision changes roll back together

#### Scenario: A counter would rewind or overflow
- **WHEN** a write cannot advance the revision as an exact safe integer
- **THEN** storage rejects it without saving unversioned document changes

#### Scenario: Only the verdict on a chapter is recorded
- **WHEN** a chapter's status or open questions change and nothing else about it does
- **THEN** the revision does not move, because those are the assessor's reading of the
  document rather than the document; counted, the assessment after a reply that only asked a
  question failed a colleague's slower turn and threw away what it had written
- **AND** a verdict is stored only if the chapter's prose, status and questions are still
  the ones it was reached from, so a stale one is refused for that chapter alone

#### Scenario: A column is added to chapters later
- **WHEN** the trigger is installed on a database whose chapters table has gained a column
- **THEN** the column counts, because the list of columns is read from the table and the
  trigger is rebuilt on every boot rather than kept by `IF NOT EXISTS` as it was first written

#### Scenario: A reply's guard writes nothing itself
- **WHEN** a reply is checked against the revision it started from
- **THEN** the check compares and does not advance the counter; only the writes advance it,
  so a reply that changed nothing does not count as a change

#### Scenario: Prose saved unchanged
- **WHEN** a chapter is updated with the content it already holds
- **THEN** the content column is not written, so the counter does not move for it

### Requirement: Verification and recovery migrations preserve evidence
Storage SHALL preserve old reports with unknown input revisions and install a durable
approval journal with at most one unfinished intent per project.

#### Scenario: An old report is read
- **WHEN** it predates revision capture
- **THEN** it remains available as stale coverage rather than being treated as current

#### Scenario: Startup finds an unfinished approval
- **WHEN** the journal contains pending work
- **THEN** recovery is attempted before startup document commits, and every later writer checks it independently

### Requirement: Verification failures survive schema upgrades
Existing databases SHALL gain a failed-coverage column without losing stored verification results.

#### Scenario: A database predates coverage reporting
- **WHEN** the application starts against an older verifications table
- **THEN** the column is added with an empty default, preserving the old result without guessing which old calls failed

### Requirement: The schema is applied idempotently on boot
The server SHALL apply the schema on every boot using statements that do nothing when the
object already exists, so a fresh database and an existing one take the same path.

#### Scenario: Booting against an empty file
- **WHEN** the database file does not exist
- **THEN** every table and index is created and the application starts normally

#### Scenario: Booting against an existing database
- **WHEN** the tables are already present
- **THEN** no data is lost and no statement fails

### Requirement: Columns added later are applied explicitly
A column added after a database may already exist SHALL be applied through a guarded
`ALTER TABLE`, because `CREATE TABLE IF NOT EXISTS` silently skips an existing table and
SQLite has no `ADD COLUMN IF NOT EXISTS`.

#### Scenario: Upgrading a database from before a column existed
- **WHEN** the server boots and the column is missing
- **THEN** it is added with its default

#### Scenario: Booting again afterwards
- **WHEN** the column is already present
- **THEN** the attempt is skipped rather than raising

### Requirement: New data rules are backfilled, not merely enabled
When a change alters what stored data should look like, the boot sequence SHALL migrate
documents written under the earlier rule.

#### Scenario: A template column gains meaning
- **WHEN** a column such as `goal` or `applies_when` is introduced
- **THEN** existing rows are populated, rather than the feature silently behaving as though
  every value were empty

#### Scenario: An administrator clears a value the backfill once filled
- **WHEN** the server restarts after an administrator emptied a template chapter's goal
- **THEN** the goal stays empty, because a backfill runs in the boot that adds its column and
  never again — run on every boot, it overwrote the administrator's edit each time

#### Scenario: A structural rule changes
- **WHEN** a chapter was split under a rule that left its sections empty
- **THEN** the boot sequence files the prose into those sections on the same terms as a
  split performed today

#### Scenario: A reconciliation rule changes
- **WHEN** a chapter holds open questions that only invite the user to another chapter,
  filed before reconciliation discarded them
- **THEN** the boot sequence removes them, and completes a chapter left in progress with
  nothing else open, on the same terms as a turn reconciled today

### Requirement: A one-off repair runs once
A repair for a past defect SHALL be recorded by name when it has run, and SHALL NOT run again
against the same database.

#### Scenario: Booting after a repair has run
- **WHEN** the server starts and the `migrations` table names the repair
- **THEN** the repair is skipped, because re-evaluating every document against today's state
  made a chapter added or renamed since look like the old defect, and its legitimate
  questions were deleted

### Requirement: Booting is one transaction after the pragmas
Everything the boot sequence does after the schema's pragmas SHALL run in one transaction, and a
boot that fails SHALL leave no open handle for the next caller to reuse.

#### Scenario: A boot is interrupted part-way through a seed
- **WHEN** a column, a trigger, a seed or a backfill raises
- **THEN** all of them roll back together, so the next boot starts from the same place instead
  of skipping a half-written seed as already present

#### Scenario: Migrating raises
- **WHEN** the first call to open the database fails while migrating
- **THEN** the handle is closed and withdrawn, and the next call retries the migration rather
  than being handed a half-migrated database

#### Scenario: Two writers meet
- **WHEN** a second connection finds the database locked
- **THEN** it waits up to five seconds for the lock before failing, because the restart check
  and a running server are both writers of the same file

### Requirement: Creating an application is all or nothing
The project row, its chapters and its inherited standards SHALL be written in one transaction.

#### Scenario: A chapter cannot be written
- **WHEN** inserting the new application's chapters raises
- **THEN** no project row remains, so there is no application in the list with no chapters

### Requirement: A migration that changes a document reaches the repository
Any document rewritten by a startup migration SHALL be written out and committed to its
application's repository, and SHALL stay marked as waiting for that commit until it happens.

#### Scenario: The commit at boot fails
- **WHEN** a document was repaired but writing it to the repository failed
- **THEN** the repair is still listed in `migrated_documents` at the next boot, because it is
  stored rather than held in memory — and the next commit of that document, whoever makes it,
  clears it

#### Scenario: A document is migrated at boot
- **WHEN** the migration changes chapter content in the database
- **THEN** the same content is committed to the application's working branch
- **AND** a user approving in that window merges the migrated document rather than the old
  arrangement

#### Scenario: Booting twice with nothing to do
- **WHEN** the repository already matches the database
- **THEN** no commit is produced

#### Scenario: Chapters gain what they are for
- **WHEN** the boot that adds the chapter goal fills it in for existing applications
- **THEN** each of those applications is recorded as waiting for a commit, because the goal is
  written at the head of every chapter file and the repository otherwise went on without it

### Requirement: A stored list that cannot be read does not stop the page
A chapter's stored questions, criteria, conditions and open questions SHALL be read with a
default when what is stored is not valid JSON.

#### Scenario: One chapter's list was damaged
- **WHEN** a value cannot be parsed
- **THEN** the chapter is read with an empty list, or `always` for its conditions, rather than
  the whole application failing to open over one field

### Requirement: Git is the source of truth for prose
Chapter content SHALL be written to the application's repository, with `chapters.content_md`
kept as a read cache for rendering.

#### Scenario: Rendering the document pane
- **WHEN** the preview is loaded
- **THEN** it reads from the database without invoking git

### Requirement: Boot order is fixed
The server SHALL open the database and run migrations, bootstrap the administrator, find
each application's repository, and only then recover approvals and record migrated
documents into their repositories.

#### Scenario: A first boot of a new deployment
- **WHEN** the server starts
- **THEN** no request is served against a schema that has not been applied

#### Scenario: Recovery fails at boot
- **WHEN** recovering an approval or committing a migrated document raises
- **THEN** the failure is logged and the server stays up, because an unhandled rejection ends
  the process on Node's default settings and both steps are retried by the next writer anyway
