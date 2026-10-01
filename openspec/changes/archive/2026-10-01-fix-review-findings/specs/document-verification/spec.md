## ADDED Requirements

### Requirement: A check has room to reason
Each verification call SHALL be given a budget large enough to read a chapter and its
conversation and reason about them before answering.

#### Scenario: A long chapter is checked
- **WHEN** the model deliberates at length before reporting
- **THEN** it still answers, because a check starved of budget returns nothing, and nothing
  is what a clean chapter looks like

## MODIFIED Requirements

### Requirement: Four classes of finding
Verification SHALL look for rules that contradict each other, decisions never written down,
parts that no longer match what the application is for, and anything too vague to build
from.

#### Scenario: A decision was acknowledged and never recorded
- **WHEN** the assistant replied that it would record something and did not
- **THEN** the run reports it, because each chapter's check reads that chapter's recent
  conversation alongside its text — without it the promise is in neither place the check
  looks

#### Scenario: A chapter was discussed but never written
- **WHEN** a chapter has conversation from the user and no prose or rules
- **THEN** it is still checked, because that is exactly where an answer was given and lost
