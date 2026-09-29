# Chapter progress

## Purpose

The index has to answer "what is left to decide" at a glance, and it has to be right. The
two calls of a turn are independent judgements and they can disagree: the assessor reads the
chapter *text*, so it cannot see that the prose call ended by asking the user something.
Left alone it marks the chapter complete with the question still on screen — and because
each turn rebuilds the prompt from stored state, the next turn reads "finished, nothing
open" and walks off to a different chapter.

The invariant, enforced in code rather than in a prompt:

> **A chapter is complete exactly when nothing is left to ask.**

See `README.md`, *The invariant: complete means nothing left to ask*.

## Source

- `src/lib/server/llm/questions.ts`
- `src/lib/components/ChapterIndex.svelte`
- `src/routes/projects/[id]/+page.server.ts`
- `src/routes/projects/[id]/+page.svelte`

## Requirements

### Requirement: A reply that asks something cannot complete a chapter
Reconciliation SHALL downgrade an assessment of complete when the reply asked the user
anything.

#### Scenario: The assessor says complete while a question is on screen
- **WHEN** the reply contains a question
- **THEN** the stored status is downgraded and the questions are kept

#### Scenario: The assessor supplied its own questions
- **WHEN** the assessment lists open questions
- **THEN** its wording is kept in preference to questions extracted from the prose, so a
  hanging question is never silently dropped

#### Scenario: Detecting a question
- **WHEN** the reply is written in any language the assistant works in
- **THEN** detection keys on the question mark, which is common to all of them

### Requirement: A chapter resting on unconfirmed assumptions is not complete
Displayed status SHALL be derived from the stored verdict together with the state of the
chapter's decisions, rather than being written back to the database.

#### Scenario: An assistant decision is unconfirmed
- **WHEN** the chapter's assessment says complete but a decision made on the user's behalf
  is still proposed
- **THEN** the chapter does not display as complete

#### Scenario: The user confirms it
- **WHEN** the decision is confirmed
- **THEN** the chapter displays as complete immediately, without waiting for some later turn
  to reassess it

### Requirement: Progress counts each piece of work once
Counting SHALL exclude a chapter that has been split into sections, because its progress is
its children's.

#### Scenario: A document with one split chapter
- **WHEN** totals are computed
- **THEN** the container is not counted alongside its sections

### Requirement: The index updates as a turn streams
Status and open-question changes SHALL reach the index during the turn rather than only on
the next page load.

#### Scenario: A turn completes a chapter
- **WHEN** the assessment arrives
- **THEN** the index and the preview show it without a round trip

### Requirement: Only the active chapter's questions are offered
The chat SHALL offer the open questions of the chapter in scope, and the index SHALL carry
the totals for the whole document.

#### Scenario: Three chapters have open questions
- **WHEN** one of them is selected
- **THEN** its questions are offered for answering, and the others are visible as counts in
  the index
