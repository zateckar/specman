## MODIFIED Requirements

### Requirement: Structural faults are reported
Validation SHALL report a requirement with no scenario, a duplicate reference, two
requirements with identical statements, a requirement belonging to a chapter that does not
exist, and a chapter marked complete with questions still open.

#### Scenario: A duplicate reference
- **WHEN** two requirements share a reference
- **THEN** it is reported, because traceability depends on references being unique

#### Scenario: One rule held in three places
- **WHEN** three requirements share a statement
- **THEN** it is reported once, as recorded three times, because reported pair by pair it read
  "is recorded twice" — twice

#### Scenario: A chapter finished with a question open
- **WHEN** a complete chapter still carries an open question
- **THEN** it is reported

#### Scenario: A chapter waiting on a confirmation
- **WHEN** a chapter is stored complete but an assumption in it is unconfirmed
- **THEN** it is not called finished — neither "finished with questions open" nor "finished
  but states nothing" — because its badge reads "in progress" and the finding contradicted
  the badge on the same chapter; the unconfirmed assumption is reported instead
