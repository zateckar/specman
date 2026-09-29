# One repository per application

## ADDED Requirements

### Requirement: A repository has one writer at a time
Operations that write to an application's repository SHALL be ordered, so that a checkout,
the files it is followed by, and the commit that records them cannot be interleaved with
another write to the same repository.

#### Scenario: Two colleagues send a turn at the same moment
- **WHEN** both turns write the document and commit
- **THEN** the second waits for the first, and each commit contains the turn that made it

#### Scenario: Different applications
- **WHEN** turns arrive for two applications at once
- **THEN** they proceed together, because ordering is per repository and not global

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

## MODIFIED Requirements

### Requirement: A commit with nothing to commit produces nothing
Committing SHALL be a no-op when the working tree is unchanged, and SHALL take place only on
the branch the caller named.

#### Scenario: The same document is written twice
- **WHEN** nothing differs
- **THEN** no commit is created and the caller is told so

#### Scenario: Nothing to commit, on the wrong branch
- **WHEN** the tree is unchanged and the repository is not on the expected branch
- **THEN** it fails rather than reporting nothing to do, because "nothing changed" and "this
  is not the branch you think" must not look the same to the caller
