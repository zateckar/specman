## ADDED Requirements

### Requirement: A chapter's assumptions can be confirmed together
Where a chapter holds more than one unconfirmed assistant decision, the user SHALL be able to
confirm all of that chapter's at once, in one transaction and one commit.

#### Scenario: The user agrees with a drafted chapter
- **WHEN** they choose "All of these are right" under a chapter's assumptions
- **THEN** every unconfirmed assistant decision in that chapter is confirmed and recorded in
  the history once, because a draft carries several per chapter and confirming them one click
  and one commit at a time is dozens of round trips for someone who has read it and agrees

#### Scenario: Decisions in other chapters
- **WHEN** the chapter's assumptions are confirmed together
- **THEN** no other chapter's decisions change, because agreeing to what one has read is not
  agreeing to what one has not, and there is no way to confirm the whole document at once

#### Scenario: One was settled in another window
- **WHEN** some of them were already confirmed or discarded elsewhere
- **THEN** the rest are confirmed and nothing is reported as failed, because the choice that
  was made still stands
