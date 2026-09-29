# Checking the document as a whole

## Purpose

Two things the per-turn flow structurally cannot do: it sees one chapter at a time, so it
cannot notice that two chapters contradict each other; and it judges what was just said, so
it cannot notice that something settled four chapters ago was never written down.

On its first real run this found a genuine contradiction that had survived an entire
interview — one rule said a booking cannot be cancelled on the reserved day, another said
blocking a car cancels bookings inside the blocked period, which can include that day. Two
rules written in different turns, each sound alone.

## Source

- `src/lib/server/llm/verification.ts`
- `src/lib/server/llm/issues.ts`
- `src/routes/api/verify/+server.ts`

## Requirements

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

### Requirement: The whole document is never sent in one request
Verification SHALL run one call per chapter plus a single cross-document pass, and the
cross-document pass SHALL send requirement statements only.

#### Scenario: A long document is checked
- **WHEN** the run is issued
- **THEN** no request carries the entire document, because context windows here vary by
  backend and are not published — a document that fits today may not fit tomorrow

#### Scenario: The cross-chapter pass
- **WHEN** contradictions are looked for across chapters
- **THEN** only statements are sent, which stays small whatever serves it

### Requirement: Four classes of finding
Verification SHALL look for rules that contradict each other, decisions never written down,
parts that no longer match what the application is for, and anything too vague to build
from.

#### Scenario: A decision was acknowledged and never recorded
- **WHEN** the assistant replied that it would record something and did not
- **THEN** the run reports it

### Requirement: Findings are advisory
Findings SHALL NOT block approval or export.

#### Scenario: A run reports contradictions
- **WHEN** the user approves the change anyway
- **THEN** approval proceeds, because a model's opinion about a document is not grounds for
  refusing to save the user's own work

### Requirement: Findings arrive in the text stream
A finding SHALL be emitted as a streamed block rather than as a tool argument.

#### Scenario: A finding is long
- **WHEN** it describes two contradicting rules in full
- **THEN** it is not at risk of the truncation failure that a tool argument would be

### Requirement: A result is stored and written into the repository
The outcome of a run SHALL be kept, and SHALL be committed to the working branch so the
check travels with the change it describes.

#### Scenario: Reopening the review page
- **WHEN** a run completed earlier
- **THEN** the last result is shown without repeating the work, which takes around eighty
  seconds over five chapters

#### Scenario: Someone reviews the change
- **WHEN** they read the working branch
- **THEN** they see what was flagged before approving

### Requirement: Failed coverage cannot be reported as clean
A verification run SHALL retain successful findings and separately record failed chapter
and cross-document calls, counting only successful chapters as checked.

#### Scenario: Every gateway call fails
- **WHEN** the gateway is unavailable for the entire run
- **THEN** the result records no successfully checked chapters and reports incomplete coverage
  both in the interface and repository, without asserting that the document agrees with itself

#### Scenario: One chapter succeeds while another fails
- **WHEN** only some checks finish
- **THEN** their findings survive and the failed coverage survives reopening the review page

#### Scenario: The user retries successfully
- **WHEN** a subsequent run checks all relevant parts successfully
- **THEN** the latest result has no failed coverage and can report a clean check when it finds no issues

### Requirement: Set-aside chapters are not checked
A chapter that does not apply SHALL be excluded from the run.

#### Scenario: Nine of twelve chapters apply
- **WHEN** verification runs
- **THEN** nine per-chapter calls are issued
