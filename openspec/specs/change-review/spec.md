# Proposing and approving a change

## Purpose

Everything said in conversation lands on a working branch, and the user reviews it before it
becomes part of the document. Reviewing is done as **rules, not lines**: a prose diff tells a
non-technical reader nothing useful, whereas "three requirements added, one changed, one
removed" is a sentence they can act on.

## Source

- `src/lib/server/proposals.ts`
- `src/lib/server/llm/delta.ts`
- `src/routes/projects/[id]/review/+page.server.ts`
- `src/routes/projects/[id]/review/+page.svelte`

## Requirements

### Requirement: Conversation accumulates on one open proposal
There SHALL be at most one open proposal per application, and every turn's changes SHALL be
committed to it.

#### Scenario: Several turns before a review
- **WHEN** the user talks through three chapters
- **THEN** all of it is on the same working branch, ready to be reviewed together

#### Scenario: After approval
- **WHEN** a proposal is merged
- **THEN** the next turn opens a new one

### Requirement: Approving cannot overlap a conversation turn
Approval SHALL hold the application's repository for the whole of its merge, so no turn can
write to that repository while the branch is being moved.

#### Scenario: A turn arrives while an approval is merging
- **WHEN** both reach the repository at once
- **THEN** the merge completes and the turn is recorded on the proposal that follows it —
  never on `main`

#### Scenario: The merge fails
- **WHEN** approval cannot complete
- **THEN** the repository is released and the proposal stays open, so the change is still
  there to approve rather than half-merged

### Requirement: A change that was not recorded says so
When a turn's changes cannot be written to the repository, the user SHALL be told that the
change is not yet part of what will be reviewed.

#### Scenario: The repository refused the write
- **WHEN** a commit is refused because the repository was not on the expected branch
- **THEN** the message says the change has not been added to the application's history, not
  "saved, but could not be recorded", which reads as a change that is safe

#### Scenario: What happens to the change afterwards
- **WHEN** the next change is recorded
- **THEN** it carries the earlier one with it, because the document is written out of the
  database in full each time — so the user is told to expect that rather than to repeat a
  turn that is already stored

### Requirement: A change is summarised as a requirement-level delta
The review SHALL report requirements added, changed and removed, naming the chapter and what
moved, computed deterministically.

#### Scenario: A requirement is reworded
- **WHEN** its statement changes
- **THEN** the review says so, distinguishing a change of wording from a change of timing or
  of the example

#### Scenario: Cost of producing the summary
- **WHEN** the review page loads
- **THEN** no model call is made, because both sides come from the manifest

### Requirement: The text diff remains available
The prose diff SHALL remain reachable behind a toggle.

#### Scenario: A reviewer wants the exact text
- **WHEN** they open the diff
- **THEN** they see the change line by line

### Requirement: Approval merges and refreshes the developer bundle
Approving SHALL merge the working branch and rewrite the build-ready bundle on the main
branch.

#### Scenario: A colleague clones the repository after approval
- **WHEN** they read the bundle
- **THEN** it matches the approved document rather than whatever was approved last time

#### Scenario: The bundle cannot be written
- **WHEN** producing it fails
- **THEN** the merge still stands and the failure is logged, rather than the approval being
  lost

### Requirement: What was checked travels with the change
A verification result and the pending decisions SHALL be visible on the review page.

#### Scenario: Reviewing a change
- **WHEN** decisions made on the user's behalf are unconfirmed, or a check flagged something
- **THEN** the reviewer sees both before approving

### Requirement: Approval is never blocked by a model's opinion
Approval SHALL proceed regardless of verification findings and structural validation
problems.

#### Scenario: The document has open problems
- **WHEN** the user approves
- **THEN** their work is saved, and the problems travel with it
