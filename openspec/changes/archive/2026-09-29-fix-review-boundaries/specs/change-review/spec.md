## MODIFIED Requirements

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

#### Scenario: Newer answers are not yet committed
- **WHEN** the database contains a newer revision while an earlier proposal is approved
- **THEN** the developer bundle uses the proposal's committed export snapshot, and the newer
  answers remain pending rather than reaching main without review

#### Scenario: A proposal predates export snapshots
- **WHEN** an older working branch is approved
- **THEN** its bundle is reconstructed from its committed manifest and chapter files,
  with a warning about metadata the older format did not retain, never from live database content

#### Scenario: A failed commit left files in the working tree
- **WHEN** approval finds staged, modified or untracked files
- **THEN** it reports that the changes need to be recorded and leaves the proposal open,
  so the bundle commit cannot sweep those unreviewed files onto main

### Requirement: What was checked travels with the change
A verification result and the pending decisions SHALL be visible on the review page.

#### Scenario: Reviewing a change
- **WHEN** decisions made on the user's behalf are unconfirmed, or a check flagged something
- **THEN** the reviewer sees both before approving

#### Scenario: A check did not cover the whole document
- **WHEN** any verification calls failed
- **THEN** the review names the unavailable coverage and offers a retry, alongside findings
  from successful calls, instead of claiming that nothing was flagged
