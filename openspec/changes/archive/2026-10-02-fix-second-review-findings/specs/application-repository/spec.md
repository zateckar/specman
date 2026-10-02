## ADDED Requirements

### Requirement: A history that existed is never started again
An application that has had a repository SHALL NOT be given a new, empty one in its place,
and a repository SHALL be found again where this installation keeps it.

#### Scenario: The repository has gone
- **WHEN** an application has a proposal — which exists only once its repository had a first
  commit — and its folder holds no `.git`
- **THEN** writing to it fails and nothing is created, and the user is told the history
  cannot be found and who can restore it; a new repository there recorded the whole document
  as its first change, with the approved history gone and nobody told
- **AND** the user is not told it will be recorded with the next change, because it will not

#### Scenario: The server is started from another folder
- **WHEN** the stored path names nothing and the repository is where this installation would
  put it, under `data/repos/<slug>` of the folder it was started in
- **THEN** the stored path follows it at boot, before anything reads it, because the path was
  stored whole and a different working directory or a restored backup left every one of them
  naming nothing

#### Scenario: Found nowhere
- **WHEN** an application with a history has no repository at either place
- **THEN** that is logged at boot, rather than discovered by the first person to answer a
  question

### Requirement: A lock left by a killed git is cleared
Before writing to a repository, a stale `index.lock` SHALL be removed.

#### Scenario: The container was stopped mid-commit
- **WHEN** the lock is older than any command this application runs
- **THEN** it is removed and the write proceeds, because left in place every commit failed
  until someone deleted it by hand

#### Scenario: A lock that a running git could hold
- **WHEN** the lock is recent
- **THEN** it is left alone, because while this repository is held no writer of ours is
  running, but a read can take the lock for a moment

## MODIFIED Requirements

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

#### Scenario: Git commits nothing and says nothing
- **WHEN** changes were staged but the branch did not move
- **THEN** it fails, because what was committed is read from the repository rather than from
  git's output, and an empty output had read as "nothing changed" while the change sat there
  unrecorded
