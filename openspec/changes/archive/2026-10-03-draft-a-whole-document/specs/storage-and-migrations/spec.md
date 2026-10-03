## ADDED Requirements

### Requirement: Where an application came from is recorded
Each application SHALL record whether it was started by interview or drafted by the
assistant, and the revision its draft left the document at; the draft revision SHALL advance
only with the drafter's own writes, and only while nothing else has written since.

#### Scenario: Upgrading a database with applications in it
- **WHEN** the columns are added to a database that already has applications
- **THEN** each reads as started by interview with no draft revision, and nothing is
  backfilled, because every application that exists was started that way: the default is the
  correct value, and is stated here so that nobody concludes a backfill was forgotten

#### Scenario: A drafted application is created
- **WHEN** an application is created to be drafted
- **THEN** its draft revision is the document revision at the end of the same transaction
  that wrote its chapters and inherited standards

#### Scenario: Something else wrote in between
- **WHEN** the drafter saves a chapter after any other write to the document
- **THEN** the draft revision is not advanced, so it can never again equal the document
  revision, which only increases
