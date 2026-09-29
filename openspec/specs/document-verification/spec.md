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

### Requirement: Set-aside chapters are not checked
A chapter that does not apply SHALL be excluded from the run.

#### Scenario: Nine of twelve chapters apply
- **WHEN** verification runs
- **THEN** nine per-chapter calls are issued
