# The guided interview

## ADDED Requirements

### Requirement: The interviewer reads the whole document
A conversation turn SHALL show the model every other chapter that applies, with its prose and
its rules, so that what the colleague says can be checked against what the document already
says.

#### Scenario: An answer contradicts another chapter
- **WHEN** the colleague says something in one chapter that another chapter says differently
- **THEN** the assistant corrects the other chapter in the same reply and says which chapter
  it changed and what it said before, because with only the other chapters' titles it wrote
  the new answer down and left the contradiction for nobody to find (seen on 2026-10-03:
  missed on the old prompt, corrected in seven of eight replies on the new one); and it does
  not merely offer to, because an offer depends on a later turn that may never come

#### Scenario: It cannot tell which is meant
- **WHEN** it is unclear whether the colleague means to change the other chapter
- **THEN** the assistant asks instead of changing it

#### Scenario: A long document
- **WHEN** the rest of the document is longer than the prompt allows for it
- **THEN** each chapter is shortened to an equal share, longest first, and says it was
  shortened, rather than the later chapters being dropped

#### Scenario: A set-aside chapter
- **WHEN** the triage set a chapter aside
- **THEN** it is not shown, because it is not part of what will be built

### Requirement: What changes each turn comes last
The system prompt SHALL hold only what stays the same from turn to turn within a chapter, and
the chapter's current state and the closing checklist SHALL travel with the colleague's
message in the last turn of the request.

#### Scenario: The next answer in the same chapter
- **WHEN** the colleague answers again and no other chapter has changed
- **THEN** the system prompt is the same, character for character, as on the turn before,
  because the gateway's cache serves a prompt only as far as it starts the same as an earlier
  one, and with the rest of the document in it a prompt that changed near its start was read
  afresh every turn

#### Scenario: What is stored
- **WHEN** the turn is saved
- **THEN** the transcript keeps the colleague's own words, not the state wrapped around them,
  so earlier turns are replayed as they were said and the state is never repeated

#### Scenario: The checklist
- **WHEN** the request is built
- **THEN** the checklist comes after the colleague's message, the last thing the model reads,
  because it is the rule the model is most likely to drop

### Requirement: A change a reply claims is a change it made
When a reply names another chapter by title without writing it, the server SHALL ask the
model once more, for that chapter's block and nothing else, and SHALL save what comes back as
though the reply had carried it.

#### Scenario: The reply says it corrected a chapter and wrote nothing
- **WHEN** a reply says "I changed Users and roles" and carries no block for it
- **THEN** the server asks for the chapter by key and saves it, because seen on the live
  gateway on 2026-10-03 a reply said it had changed three chapters, wrote none of them, and
  the colleague was told their document said something it did not

#### Scenario: The reply only mentioned the chapter
- **WHEN** the follow-up sends nothing back
- **THEN** nothing changes, because naming a chapter is not always claiming to have changed it

#### Scenario: What the follow-up may write
- **WHEN** it sends a block for a chapter it was not asked about
- **THEN** that block is ignored, so the follow-up cannot reach past what the reply named

#### Scenario: The follow-up fails
- **WHEN** the extra call fails
- **THEN** the turn goes on and is saved as it was, and the failure goes to the log

### Requirement: The conversation window moves in steps
A conversation turn SHALL replay at least the last sixteen messages of its chapter, starting
at a multiple of eight.

#### Scenario: A long conversation
- **WHEN** a chapter's conversation grows past sixteen messages
- **THEN** the start of the replayed window stays where it is for four turns at a time, rather
  than moving with every turn and changing the start of everything after the system prompt
