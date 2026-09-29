# Document validation

## Purpose

Deterministic checks that answer "is this well formed?" — never "is this right?". They cost
no gateway call, so they run on every load, and judgement is left to the verification pass
which costs several.

See `README.md`, *Requirements: the checkable half of a chapter*.

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

#### Scenario: A chapter finished with a question open
- **WHEN** a complete chapter still carries an open question
- **THEN** it is reported

### Requirement: Set-aside chapters are not validated
A chapter that does not apply SHALL be excluded from validation.

#### Scenario: A set-aside compliance chapter
- **WHEN** the document is validated
- **THEN** its emptiness is not reported as a fault

### Requirement: Structural faults are stated, not used to withhold work
Validation problems SHALL be shown to the user and carried into the developer bundle, and
SHALL NOT prevent the bundle being produced.

#### Scenario: A document with structural problems is handed over
- **WHEN** the bundle is written
- **THEN** the problems are stated at the top of it, because refusing to write files the
  user's own conversation produced would be withholding their work
