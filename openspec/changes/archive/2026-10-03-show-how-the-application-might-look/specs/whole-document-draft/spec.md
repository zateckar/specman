## MODIFIED Requirements

### Requirement: The assistant can draft every chapter at once
When the user asks for it at creation, the system SHALL write every chapter that applies,
with its prose, its rules and its decisions, without asking the user anything.

#### Scenario: A draft is asked for
- **WHEN** the user chooses to let the assistant draft the application
- **THEN** the application is created exactly as for an interview, the user reaches its
  workspace at once, and the chapters are written in the background

#### Scenario: Which chapter comes first
- **WHEN** drafting begins
- **THEN** the Overview is written first, and every other chapter is given it, because the
  Overview anchors the rest and calls made in parallel cannot otherwise agree on what the
  application is

#### Scenario: Several drafts at once
- **WHEN** more than one application is being drafted, or a mock-up is being made beside a
  draft
- **THEN** no more than three of these long calls run at a time across the whole
  installation, drafted chapters and mock-ups together, because the gateway is shared and a
  draft must not starve everyone's conversations

#### Scenario: A chapter the triage set aside
- **WHEN** the triage answers set a chapter aside
- **THEN** it is not drafted, because a set-aside chapter costs nothing downstream and a draft
  should not change that

#### Scenario: A chapter holding company standards
- **WHEN** a chapter has inherited company standards
- **THEN** the drafting call is given them as settled, and a drafted rule worded the same as
  one of them is not added

#### Scenario: No model is configured
- **WHEN** neither the gateway nor Gemini is set up
- **THEN** creating a draft is refused with a sentence saying so, rather than creating a
  document whose every chapter fails

### Requirement: Nothing that reads the document as finished runs beside a draft
While a draft is being written, the server SHALL refuse a whole-document check, drawing the
diagram, making a mock-up and approving the proposal, each before doing any work, with a
sentence saying to try once the draft has finished.

#### Scenario: Checking the whole document mid-draft
- **WHEN** a check is asked for while chapters are still being written
- **THEN** it is refused at once, because it compares the document at the end of several
  gateway calls and would fail after the wait

#### Scenario: Drawing the diagram mid-draft
- **WHEN** the diagram is drawn while chapters are still being written
- **THEN** it is refused, because the picture of half a document would be kept as the
  application's diagram

#### Scenario: Making a mock-up mid-draft
- **WHEN** a mock-up is asked for while chapters are still being written
- **THEN** it is refused, because a mock-up of half a document would be kept as the
  application's, and would say it was made from a document that has since changed

#### Scenario: Approving mid-draft
- **WHEN** the proposal is approved while chapters are still being written
- **THEN** it is refused, because it would approve half a document; the workspace hides the way
  to the review, the diagram and the mock-up until the draft finishes

### Requirement: An untouched draft is marked
An application drafted by the assistant into which no person has put anything SHALL be
marked as an AI draft, on its card and in its workspace, and the mark SHALL be derived from
the document rather than stored.

#### Scenario: A finished draft
- **WHEN** the draft has finished and nobody has done anything in it
- **THEN** both its card and its workspace say it is an AI draft, that every choice in it is
  an assumption, and that it can be deleted

#### Scenario: While it is being written
- **WHEN** the draft is still running
- **THEN** its card carries the mark and says how far the draft has got

#### Scenario: The user answers in it
- **WHEN** someone sends a message in any of its conversations
- **THEN** the mark is gone, including when the answer changed nothing, because the document
  now holds something of theirs

#### Scenario: A choice is made in it
- **WHEN** someone confirms or rejects a decision, includes a chapter, or approves a change
- **THEN** the mark is gone, without any of those paths having to clear it: every write to the
  document moves a revision the draft no longer matches, and approval is read from the
  proposals and the approval journal

#### Scenario: Looking is not touching
- **WHEN** someone opens it, checks the whole document, draws the diagram, makes a mock-up,
  reads the handoff, or clicks an open question
- **THEN** the mark stays, because none of these puts a person's choice into the document

#### Scenario: Anything else writes the document
- **WHEN** something that is neither the draft nor a person, such as a startup repair, changes
  the document
- **THEN** the mark is gone, because when the rule errs it must hide a delete button, never
  offer one over someone's work

#### Scenario: An application started by interview
- **WHEN** it was created to be interviewed
- **THEN** it is never marked, however little is written in it

#### Scenario: After the first touch
- **WHEN** a person has done anything in a draft
- **THEN** its rules read like any the assistant wrote in an interview, and only its
  unconfirmed decisions still say they were decided for the user; this is accepted, because the
  decisions are where the assumptions are surfaced
