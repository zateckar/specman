# Change review

## ADDED Requirements

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
