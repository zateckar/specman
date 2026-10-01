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

#### Scenario: A structural rule changes
- **WHEN** a chapter was split under a rule that left its sections empty
- **THEN** the boot sequence files the prose into those sections on the same terms as a
  split performed today

#### Scenario: A reconciliation rule changes
- **WHEN** a chapter holds open questions that only invite the user to another chapter,
  filed before reconciliation discarded them
- **THEN** the boot sequence removes them, and completes a chapter left in progress with
  nothing else open, on the same terms as a turn reconciled today

### Requirement: A migration that changes a document reaches the repository
Any document rewritten by a startup migration SHALL be written out and committed to its
application's repository.

#### Scenario: A document is migrated at boot
- **WHEN** the migration changes chapter content in the database
- **THEN** the same content is committed to the application's working branch
- **AND** a user approving in that window merges the migrated document rather than the old
  arrangement

#### Scenario: Booting twice with nothing to do
- **WHEN** the repository already matches the database
- **THEN** no commit is produced

### Requirement: Git is the source of truth for prose
Chapter content SHALL be written to the application's repository, with `chapters.content_md`
kept as a read cache for rendering.

#### Scenario: Rendering the document pane
- **WHEN** the preview is loaded
- **THEN** it reads from the database without invoking git

### Requirement: Boot order is fixed
The server SHALL open the database and run migrations, bootstrap the administrator, and
only then record migrated documents into their repositories.

#### Scenario: A first boot of a new deployment
- **WHEN** the server starts
- **THEN** no request is served against a schema that has not been applied
