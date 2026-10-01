## ADDED Requirements

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

## MODIFIED Requirements

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
