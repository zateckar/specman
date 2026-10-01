## MODIFIED Requirements

### Requirement: Approval identifies the reviewed revision
Review prose diffs and requirement deltas SHALL use immutable proposal and main commits,
and approval SHALL validate both commits and the proposal identity inside the repository
lock before merging that commit.

#### Scenario: The proposal advances after review
- **WHEN** another turn commits after the review page loads
- **THEN** approval returns a conflict with instructions to review the new changes and leaves main unchanged

#### Scenario: Approval queues behind a writer
- **WHEN** a queued approval's reviewed revision changes before it acquires ownership
- **THEN** approval rejects it after acquiring the lock

#### Scenario: The approved base or open proposal changes
- **WHEN** main advances or a replacement proposal is opened after review
- **THEN** the old form cannot approve the current proposal

#### Scenario: A form has no revision
- **WHEN** approval receives missing or malformed revision fields
- **THEN** it returns a conflict asking the user to reload the review

#### Scenario: The user runs the check from the review page
- **WHEN** the whole-document check finishes and commits its report to the proposal
- **THEN** the review page reloads, so the revision it approves is the one that includes the
  report — kept, the old revision made the very next Approve fail with a conflict the user
  had done nothing to cause
