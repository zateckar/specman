# <Capability name>

Deltas only — never the whole capability. Drop the sections you do not need.

## ADDED Requirements

### Requirement: Short name in the imperative
The system SHALL … (one sentence, testable, no implementation detail)

#### Scenario: What situation this is
- **WHEN** the thing happens
- **THEN** the observable result

## MODIFIED Requirements

### Requirement: The existing name, exactly as it appears in specs/
The replacement text in full, with every scenario it should have afterwards — a reviewer
should not have to reconstruct it.

#### Scenario: …
- **WHEN** …
- **THEN** …

## REMOVED Requirements

### Requirement: The existing name
One line saying why it no longer holds, and what covers the case instead.

## RENAMED Requirements

- FROM: `### Requirement: Old name`
- TO: `### Requirement: New name`
