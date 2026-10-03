## ADDED Requirements

### Requirement: The conversation waits for a draft
While the assistant is drafting the document, the server SHALL refuse a turn and an open
question before storing anything, and the page SHALL keep the conversation closed — Send, the
suggested answers, the open questions and the start button — and say why, until the draft
ends.

#### Scenario: An answer is sent while drafting
- **WHEN** a turn is requested while the assistant is drafting the document
- **THEN** it is refused with a sentence saying to send it once the draft is finished, nothing
  is stored, and the answer is back in the box, because a turn started then would be refused
  as stale after the user had waited for it, and its stored message would mark the draft as
  touched over a turn that recorded nothing

#### Scenario: Deciding while drafting
- **WHEN** someone confirms a decision or includes a chapter while the draft runs
- **THEN** it is allowed, because neither calls the model nor is compared with a revision,
  and either one is a person's choice in the document

### Requirement: A drafted chapter says who wrote it
A chapter the assistant drafted on its own that nobody has discussed SHALL say so in its
conversation pane, and offer to go through it.

#### Scenario: Opening a drafted chapter
- **WHEN** the user opens a chapter of an AI draft with no conversation in it and none of its
  assumptions confirmed
- **THEN** the pane says the assistant drafted it on its own and nothing in it has been
  checked with them, rather than that it is already written, because "already written" reads
  as their own work

#### Scenario: Its assumptions were confirmed
- **WHEN** someone has confirmed any of a drafted chapter's assumptions
- **THEN** the pane no longer says nothing in it has been checked, because that is no longer
  true
