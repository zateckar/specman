## ADDED Requirements

### Requirement: Reading the manifest distinguishes absent from broken
Reading a branch's manifest SHALL report nothing when there is no repository or no manifest
on that branch, and SHALL raise when Git itself fails.

#### Scenario: The branch does not exist
- **WHEN** the manifest is read from a branch Git does not know
- **THEN** the read fails, because reporting "no manifest" made the review compare against an
  empty document and show every requirement as new

## MODIFIED Requirements

### Requirement: An application has a repository from the start
The repository and its first working branch SHALL exist before the first conversation turn.

#### Scenario: An application is created
- **WHEN** creation completes
- **THEN** the repository is initialised and a working branch is checked out, so the first
  turn does not pay for it

#### Scenario: Initialisation stopped part-way
- **WHEN** a repository has `.git` but no commit on `main` — interrupted after `init`, before
  its identity was set, or before its first commit
- **THEN** the next call finishes each step not yet taken, because the only guard used to be
  whether `.git` existed, and a half-made repository then stayed half-made for good

#### Scenario: History without `main`
- **WHEN** the repository has commits but no `main` branch
- **THEN** `main` is created at the first commit, which every branch here was made from

### Requirement: Chapters are files named by position and key
Each chapter SHALL be written to a file named by its position and key.

#### Scenario: A chapter is written
- **WHEN** the document is committed
- **THEN** its file is `docs/<position × 10>-<key>.md`, the number three digits wide — the
  seventh chapter on security is `docs/070-security.md` — so a chapter added between two
  others has room for a number

#### Scenario: A part of a split chapter is written
- **WHEN** a section of a split chapter is committed
- **THEN** its file carries its parent's number and its own place under it —
  `docs/020-01-booking.md` — so the parts sort beside their container

#### Scenario: A chapter that was split
- **WHEN** the container is written
- **THEN** its file links to the files of its parts, so a reader following the repository is
  not left at a dead end
