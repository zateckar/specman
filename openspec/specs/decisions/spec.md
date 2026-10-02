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

### Requirement: A blocked choice reports whether it was applied
Decision errors SHALL distinguish a saved choice awaiting a commit from a choice blocked
before it could be applied.

#### Scenario: Recovery blocks confirmation
- **WHEN** the repository cannot recover pending approval before confirming a decision
- **THEN** the decision stays proposed and the error does not claim the choice was saved

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

#### Scenario: The model calls its choice a company standard
- **WHEN** a decision in a reply claims `source="standard"`
- **THEN** it is the assistant's, because standards are copied in from the administrators'
  list, and a model writing the word does not make its choice the company's — stored so, it
  was never offered for confirmation

#### Scenario: The user handed the choice back
- **WHEN** the model labels a decision as the user's, and the user's message this turn says
  "you decide", "up to you", "I don't know" or the like — in English, Czech, Slovak or German
- **THEN** it is the assistant's and waits for confirmation, because a decision labelled the
  user's is stored as confirmed, and this is exactly the case the prompt warns about and the
  models get wrong

### Requirement: An assistant decision stays proposed until confirmed
A decision made on the user's behalf SHALL remain proposed until the user confirms it.

#### Scenario: The user confirms
- **WHEN** they confirm a proposed decision
- **THEN** it becomes confirmed and the time is recorded

#### Scenario: The same decision is confirmed twice
- **WHEN** a second window confirms a decision already confirmed
- **THEN** nothing changes, and the time it was first confirmed is kept

#### Scenario: The user wants something else
- **WHEN** they choose to change it
- **THEN** a conversation turn is opened scoped to that decision

### Requirement: Saying an assumption is wrong reopens it
Discarding a decision the assistant made SHALL put its chapter back in progress, with a
question asking what it should be instead first among the chapter's open questions and asked
in that chapter's conversation — all in one transaction with removing the decision.

#### Scenario: The user says "not right"
- **WHEN** they discard a proposed decision
- **THEN** the chapter it belongs to is in progress, the assistant's last message there quotes
  the rejected choice and asks what it should be, and the chapter cannot read as complete
  while the question stands — because deleting the row was all this used to do, the rejected
  assumption stayed in the prose, and the page's promise that it would be raised again had no
  owner

### Requirement: A decision settled elsewhere is reported, not failed
Acting on a decision that no longer exists SHALL be answered with a conflict saying so.

#### Scenario: Two windows on the same review
- **WHEN** one discards a decision and the other then confirms it
- **THEN** the second is told the decision is no longer there and may have been settled in
  another window, rather than shown a server error

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

#### Scenario: A confirmation or discard changes no prose
- **WHEN** the user confirms or discards an assumption
- **THEN** the change and updated chapter status are committed to the working proposal under
  the same repository lock as approval, so approval cannot merge a stale decision log

#### Scenario: A conversation records only a decision
- **WHEN** a turn records a decision without rewriting chapter prose or requirements
- **THEN** that decision still triggers a document commit

#### Scenario: The decision cannot be committed
- **WHEN** Git refuses to record the user's choice
- **THEN** the choice remains saved in the database and the interface reports that it has not
  reached the history, rather than treating the request as successful
