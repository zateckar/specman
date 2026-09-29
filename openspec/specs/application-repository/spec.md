# One repository per application

## Purpose

Every application gets its own Git repository, and its chapters are Markdown, so a change
reads as prose rather than as machine output. The repository is also self-describing: a
manifest alongside the chapter files mirrors status, open questions and requirements, so a
change can be reviewed as a requirement-level delta without parsing the prose.

## Source

- `src/lib/server/git/repo.ts`
- `src/lib/server/llm/lock.ts`

## Requirements

### Requirement: Export inputs travel with the document revision
Each document commit SHALL include the complete export inputs in specman.export.json,
including prose, application type, applicability, requirement provenance and decisions.

#### Scenario: Approval overlaps a database update
- **WHEN** a proposal is approved after another turn saved newer answers
- **THEN** the bundle can be built from the committed snapshot without reading mutable database content

### Requirement: An application has a repository from the start
The repository and its first working branch SHALL exist before the first conversation turn.

#### Scenario: An application is created
- **WHEN** creation completes
- **THEN** the repository is initialised and a working branch is checked out, so the first
  turn does not pay for it

### Requirement: Chapters are files named by position and key
Each chapter SHALL be written to a file named by its position and key.

#### Scenario: A chapter is written
- **WHEN** the document is committed
- **THEN** its file is `docs/<position>-<key>.md`

#### Scenario: A chapter that was split
- **WHEN** the container is written
- **THEN** its file links to the files of its parts, so a reader following the repository is
  not left at a dead end

### Requirement: The repository carries a manifest
Status, open questions and requirements SHALL be mirrored into a manifest file.

#### Scenario: Comparing two versions
- **WHEN** a change is reviewed
- **THEN** both sides are read from the manifest, which costs no model call

### Requirement: Requirements are serialised beneath the prose
A chapter file SHALL carry its requirements below its prose, separated from it.

#### Scenario: Reading a chapter file
- **WHEN** the chapter has requirements
- **THEN** they appear under their own heading, with the scenarios that make them testable

### Requirement: A repository has one writer at a time
Within one server process, operations that write to an application's repository SHALL be ordered, so that a checkout,
the files it is followed by, and the commit that records them cannot be interleaved with
another write to the same repository.

#### Scenario: Two colleagues send a turn at the same moment
- **WHEN** both turns write the document and commit
- **THEN** the second waits for the first, and each commit contains the turn that made it

#### Scenario: Different applications
- **WHEN** turns arrive for two applications at once
- **THEN** they proceed together, because ordering is per repository and not global

#### Scenario: A write fails
- **WHEN** one of them raises
- **THEN** the repository is released, because one failure must not wedge an application
  until the server is restarted

#### Scenario: The caller times out while Git continues writing
- **WHEN** a write exceeds the caller deadline but its work has not settled
- **THEN** the caller receives an error and subsequent writes to that repository wait for settlement

#### Scenario: Other repositories during timeout
- **WHEN** one repository has a timed-out writer
- **THEN** writes to different repository keys continue independently

#### Scenario: Settlement after timeout
- **WHEN** the timed-out work completes or rejects
- **THEN** the next queued writer proceeds and the failure cannot escape as an unhandled rejection

### Requirement: A commit names the branch it expects
Committing SHALL state the branch it is meant to run on, and SHALL fail rather than commit
when the repository is on any other.

#### Scenario: The repository moved under a write
- **WHEN** a commit meant for a proposal branch finds `main` checked out
- **THEN** it fails and records nothing, because a change reaching `main` without approval
  defeats the review step entirely

#### Scenario: The ordinary case
- **WHEN** the expected branch is the one checked out
- **THEN** the commit proceeds as before, and an unchanged tree still produces no commit

### Requirement: A commit with nothing to commit produces nothing
Committing SHALL be a no-op when the working tree is unchanged, and SHALL take place only on
the branch the caller named.

#### Scenario: The same document is written twice
- **WHEN** nothing differs
- **THEN** no commit is created and the caller is told so

#### Scenario: Staging normalizes unchanged content
- **WHEN** rewriting files changes their working-tree line endings but staging produces an empty diff
- **THEN** committing returns no commit rather than failing with nothing to commit

#### Scenario: Nothing to commit, on the wrong branch
- **WHEN** the tree is unchanged and the repository is not on the expected branch
- **THEN** it fails rather than reporting nothing to do, because "nothing changed" and "this
  is not the branch you think" must not look the same to the caller

### Requirement: The hosting seam is explicit
The repository layer SHALL keep creating, pushing and opening a pull request as a named
seam, so hosting on GitHub changes this capability and no other.

#### Scenario: Today, with no host configured
- **WHEN** a change is approved
- **THEN** the merge happens locally, and the interface still calls it a pull request so
  wording will not change when a host is wired up
