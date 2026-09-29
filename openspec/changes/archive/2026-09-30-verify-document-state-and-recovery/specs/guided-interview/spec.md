## ADDED Requirements

### Requirement: A delayed reply cannot replace newer document state
Chat document mutations SHALL compare the captured project revision and apply atomically,
retaining the transcript and reporting a conflict when the document has changed.

#### Scenario: Two replies share a starting revision
- **WHEN** one finishes after the other has saved changes
- **THEN** its chapter, requirement, decision and section mutations are rejected together

#### Scenario: Completeness becomes stale
- **WHEN** document changes occur while the completeness assessor is running
- **THEN** its verdict cannot replace the newer status or open questions
