## ADDED Requirements

### Requirement: A blocked choice reports whether it was applied
Decision errors SHALL distinguish a saved choice awaiting a commit from a choice blocked
before it could be applied.

#### Scenario: Recovery blocks confirmation
- **WHEN** the repository cannot recover pending approval before confirming a decision
- **THEN** the decision stays proposed and the error does not claim the choice was saved
