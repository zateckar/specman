## ADDED Requirements

### Requirement: Coverage names its document revision
Verification SHALL retain its input revision and SHALL NOT describe an obsolete result as
agreement of the current document.

#### Scenario: The document changes during checking
- **WHEN** a verification finishes against an older document
- **THEN** it cannot replace the current result or be recorded as current coverage

#### Scenario: An older report is displayed
- **WHEN** its input revision differs from the current document or is unknown
- **THEN** it is labeled stale and the user is asked to check again

### Requirement: Excluded content does not affect coverage
The cross-document pass and outstanding-assumption count SHALL use only applicable chapters.

#### Scenario: A skipped chapter has rules and unconfirmed assumptions
- **WHEN** in-scope coverage is computed
- **THEN** its rules do not trigger unnecessary cross-check calls and its assumptions do not count as unfinished in-scope work
