## ADDED Requirements

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

## MODIFIED Requirements

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
