# Decisions and who made them

## Purpose

The assistant is told that when the user says "you decide", it should propose a sensible
default and record it. That is right — a non-technical colleague should not have to hold an
opinion about session lengths — but it means part of the finished document was decided by a
machine, and nothing else in the document would show which parts. Every decision therefore
carries its source, and the user can tell their own choices apart from the defaults chosen
on their behalf.

## Source

- `src/lib/server/llm/decisions.ts`
- `src/routes/api/decisions/+server.ts`

## Requirements

### Requirement: Every decision records who made it and why
A decision SHALL carry a statement, a one-sentence rationale, and a source of user,
assistant or standard.

#### Scenario: A decision is recorded
- **WHEN** the assistant records a decision
- **THEN** the reason it was taken is stored with it, so a reader is not left to infer it

### Requirement: Ambiguous authorship resolves to the assistant
A decision whose source is unclear SHALL be recorded as the assistant's.

#### Scenario: The source is not stated
- **WHEN** a decision arrives without an explicit user attribution
- **THEN** it is attributed to the assistant, because mislabelling a machine's default as
  the user's own choice hides it inside their specification, whereas the reverse merely asks
  them to confirm something they already said

### Requirement: An assistant decision stays proposed until confirmed
A decision made on the user's behalf SHALL remain proposed until the user confirms it.

#### Scenario: The user confirms
- **WHEN** they confirm a proposed decision
- **THEN** it becomes confirmed and the time is recorded

#### Scenario: The user wants something else
- **WHEN** they choose to change it
- **THEN** a conversation turn is opened scoped to that decision

### Requirement: Unconfirmed decisions are visible where they matter
Pending assistant decisions SHALL be shown on the review page alongside the change being
approved.

#### Scenario: Approving a change
- **WHEN** decisions taken on the user's behalf are still unconfirmed
- **THEN** the reviewer sees them before approving

### Requirement: Decisions travel with the repository
The decisions of an application SHALL be written into its repository, marking what the
assistant chose and what is still unconfirmed.

#### Scenario: Someone reads the change outside the application
- **WHEN** they read the repository
- **THEN** they can see who decided what, and what nobody has confirmed
