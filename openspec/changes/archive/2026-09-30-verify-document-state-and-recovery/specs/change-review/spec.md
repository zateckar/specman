## ADDED Requirements

### Requirement: Authorized approval survives interruption
Approval SHALL journal its immutable reviewed revisions before merging and recover pending
work before subsequent repository writes, closing the proposal only after merge evidence exists.

#### Scenario: Crash after authorization or merge
- **WHEN** the next startup or repository write finds pending approval
- **THEN** it resumes that exact authorized revision and closes the proposal without opening it for new changes

#### Scenario: Unexpected working-tree changes
- **WHEN** pending recovery finds dirty files outside the generated bundle
- **THEN** it blocks further repository writes and reports recovery needs attention

#### Scenario: An unfinished merge has a clean tree
- **WHEN** Git still records unfinished merge work despite a clean porcelain status
- **THEN** recovery and new writes are blocked until that merge state is resolved

#### Scenario: Crash during bundle generation
- **WHEN** the merge was recorded but bundle completion was interrupted
- **THEN** recovery rebuilds from the saved merge revision and repeated recovery produces no extra changes

## MODIFIED Requirements

### Requirement: Approving cannot overlap a conversation turn
Approval SHALL hold the application's repository for the whole of its merge, so no turn can
write to that repository while the branch is being moved.

#### Scenario: A turn arrives while an approval is merging
- **WHEN** both reach the repository at once
- **THEN** the merge completes and the turn is recorded on the proposal that follows it, never on main

#### Scenario: The merge fails
- **WHEN** approval cannot complete
- **THEN** ownership is released when work settles and the authorized intent remains
  recoverable, so subsequent repository writes resume it before accepting new changes
