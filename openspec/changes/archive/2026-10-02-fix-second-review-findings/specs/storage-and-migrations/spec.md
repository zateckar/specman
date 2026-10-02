## ADDED Requirements

### Requirement: A stored list that cannot be read does not stop the page
A chapter's stored questions, criteria, conditions and open questions SHALL be read with a
default when what is stored is not valid JSON.

#### Scenario: One chapter's list was damaged
- **WHEN** a value cannot be parsed
- **THEN** the chapter is read with an empty list, or `always` for its conditions, rather than
  the whole application failing to open over one field

## MODIFIED Requirements

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
