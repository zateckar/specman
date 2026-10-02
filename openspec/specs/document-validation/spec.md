# Document validation

## Purpose

Deterministic checks that answer "is this well formed?" — never "is this right?". They cost
no gateway call, so they run on every load, and judgement is left to the verification pass
which costs several.

## Source

- `src/lib/server/llm/validation.ts`

## Requirements

### Requirement: Validation is deterministic and free
Validation SHALL make no model call.

#### Scenario: Loading a document
- **WHEN** any page renders the document
- **THEN** the checks have already run, with no gateway request

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

### Requirement: Set-aside chapters are not validated
A chapter that does not apply SHALL be excluded from validation.

#### Scenario: A set-aside compliance chapter
- **WHEN** the document is validated
- **THEN** its emptiness is not reported as a fault

#### Scenario: A rule in a chapter that was set aside
- **WHEN** a requirement belongs to a chapter that is set aside
- **THEN** it is reported as a warning that the chapter was set aside as not applying, with an
  invitation to open it if it does — not as an error saying the chapter does not exist, which
  it does

### Requirement: A finding names the rule in the user's words
A finding about a requirement SHALL quote the rule's statement, shortened if long, and SHALL NOT
name it by its reference.

#### Scenario: Two rules say the same thing
- **WHEN** a duplicate is reported to the user
- **THEN** the message quotes the rule — `the rule “Bookings can be cancelled until noon”` —
  because `REQ-014` is storage the user never sees, and a finding they cannot place is one
  they cannot fix

### Requirement: Structural faults are stated, not used to withhold work
Validation problems SHALL be shown to the user and carried into the developer bundle, and
SHALL NOT prevent the bundle being produced.

#### Scenario: A document with structural problems is handed over
- **WHEN** the bundle is written
- **THEN** the problems are stated at the top of it, because refusing to write files the
  user's own conversation produced would be withholding their work
