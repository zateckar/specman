## ADDED Requirements

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
- **WHEN** more than one application is being drafted
- **THEN** no more than three drafting calls run at a time across the whole installation,
  because the gateway is shared and a draft must not starve everyone's conversations

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

### Requirement: Every choice in a draft is the assistant's
Every decision a draft records SHALL be stored as made by the assistant and awaiting
confirmation, whatever the reply labels it, and every drafted chapter SHALL hold at least
one.

#### Scenario: A decision the reply labels as the user's
- **WHEN** a drafting reply writes `source="user"`
- **THEN** the decision is stored as the assistant's and unconfirmed, because nobody told the
  assistant anything, and a decision labelled as the user's is stored as already agreed

#### Scenario: The reply records no decision
- **WHEN** a drafted chapter's reply carries prose but no decision
- **THEN** one is filed for it saying the assistant wrote the chapter on its own and nothing
  in it has been checked, because the decisions come last in a reply, the end of a long
  instruction is what these models drop, and without one the chapter would read complete with
  nothing to check

#### Scenario: A drafted chapter that meets its criteria
- **WHEN** the completeness check finds a drafted chapter complete
- **THEN** it reads "in progress" until its decisions are confirmed, as any chapter resting on
  assumptions does

### Requirement: A drafting call writes only its own chapter
A chapter's drafting call SHALL change that chapter and no other, and only by adding prose,
new rules and new decisions.

#### Scenario: The reply writes into another chapter
- **WHEN** a reply carries prose for a chapter other than the one it was asked for
- **THEN** that prose is ignored, because that chapter is being drafted by another call at the
  same moment

#### Scenario: A rule names another chapter or a reference
- **WHEN** a drafted rule carries `chapter=`, `ref=` or `action="remove"`
- **THEN** it is filed in this chapter as a new rule, and a removal is ignored, because the
  draft has nothing of its own to change
- **AND** a rule worded the same as one the chapter already holds, or as one earlier in the
  same reply, is not added again

#### Scenario: The reply holds no chapter
- **WHEN** a reply has no prose for its chapter once a heading repeating the title is removed,
  or runs out of room before finishing
- **THEN** the chapter is asked for once more with more room and an instruction to keep it
  short; if that fails too, nothing from either reply is saved and the chapter is reported as
  not drafted, because rules and decisions without prose would read as a chapter that had been
  written

#### Scenario: A person got there first
- **WHEN** by the time the reply arrives the chapter has prose, a message from a person, a
  decision or a rule of its own
- **THEN** the reply is dropped, because a draft never overwrites someone's work

### Requirement: A draft finishes whether or not anyone is watching
The server SHALL run a draft to the end independently of any request, and SHALL save and
commit each chapter to the working branch as it is written.

#### Scenario: The browser is closed while drafting
- **WHEN** the user leaves the page part-way through
- **THEN** the remaining chapters are still written, saved and committed

#### Scenario: One chapter fails
- **WHEN** the gateway fails for one chapter
- **THEN** the other chapters are still drafted, and the failed one is reported by name as not
  drafted

#### Scenario: Chapters land at the same moment
- **WHEN** two chapters' drafts arrive together
- **THEN** each is recorded in the history under its own name, holding that chapter alone,
  because written first and committed after, one commit named for one chapter carried eight

#### Scenario: A commit fails part-way
- **WHEN** recording one chapter in the history fails
- **THEN** the draft goes on, and its last step records the whole document again, so a later
  chapter's success is not the only chance the earlier one had

#### Scenario: The server stops part-way
- **WHEN** the application is opened after a restart interrupted its draft
- **THEN** the chapters already written are there and in the history, and the workspace says
  the draft stopped and offers to draft the rest, because the state shown is read from the
  document rather than from a job that no longer exists
- **AND** the draft is not resumed at boot, because a chapter that fails every time would be
  retried on every restart; the remedy is offered where someone will see it

#### Scenario: Drafting the rest
- **WHEN** the user asks for the rest to be drafted
- **THEN** only chapters still empty and untouched are drafted; the request is refused while a
  draft is running, or while anyone has a turn running in the document, because that turn
  would be refused as stale once the draft wrote

#### Scenario: Chapters left undrafted in a document someone has worked on
- **WHEN** a drafted application that a person has touched has chapters nobody has written,
  such as one they included after the draft
- **THEN** the workspace names them as not drafted and offers to draft them, without saying
  the draft stopped, because it did not

#### Scenario: Every chapter failed
- **WHEN** a draft wrote nothing at all
- **THEN** the workspace says nothing could be drafted and offers to try again, rather than
  calling an empty document a draft

### Requirement: A draft can be followed while it is written
While the assistant is drafting, the workspace and the application's card SHALL say so, name
the chapters being written, and count those done.

#### Scenario: A chapter is finished
- **WHEN** a chapter's draft is saved
- **THEN** it appears in the open workspace without a reload, and the count moves, because a
  draft takes minutes and a page that changes nothing for that long looks broken

#### Scenario: Chapters being written
- **WHEN** a chapter is being drafted
- **THEN** the document marks it as being written, and the progress is announced to assistive
  technology as it changes

#### Scenario: The draft finishes
- **WHEN** the last chapter is done
- **THEN** the workspace shows the finished document, names any chapter that could not be
  drafted, and opens the conversation

### Requirement: Nothing that reads the document as finished runs beside a draft
While a draft is being written, the server SHALL refuse a whole-document check, drawing the
diagram and approving the proposal, each before doing any work, with a sentence saying to try
once the draft has finished.

#### Scenario: Checking the whole document mid-draft
- **WHEN** a check is asked for while chapters are still being written
- **THEN** it is refused at once, because it compares the document at the end of several
  gateway calls and would fail after the wait

#### Scenario: Drawing the diagram mid-draft
- **WHEN** the diagram is drawn while chapters are still being written
- **THEN** it is refused, because the picture of half a document would be kept as the
  application's diagram

#### Scenario: Approving mid-draft
- **WHEN** the proposal is approved while chapters are still being written
- **THEN** it is refused, because it would approve half a document; the workspace hides the way
  to the review and the diagram until the draft finishes

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
- **WHEN** someone opens it, checks the whole document, draws the diagram, reads the handoff,
  or clicks an open question
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

### Requirement: An untouched draft can be deleted
An untouched draft SHALL be deletable by whoever created it and by an administrator, and the
interface SHALL offer no way to delete any other application.

#### Scenario: Deleting a draft
- **WHEN** its creator chooses to delete it and confirms in the page
- **THEN** it is gone from the list, the database and the disk

#### Scenario: Touched since the page was loaded
- **WHEN** a draft is deleted from a page loaded before someone put something into it
- **THEN** it is refused with a sentence saying it now holds someone's work, because whether
  it is untouched is checked at the moment of deleting, not trusted from the page

#### Scenario: Deleted while still drafting
- **WHEN** the draft is deleted while chapters are still being written
- **THEN** drafting is stopped and finished before anything is removed, and if it does not
  finish within a minute the deletion is refused rather than carried on
- **AND** a chapter still waiting for a drafting slot leaves the queue at once, because
  waiting behind other people's calls only to return would hold the deletion for minutes

#### Scenario: Something was waiting to write to its history
- **WHEN** a whole-document check or a chapter's commit is still queued for the repository as
  the draft is deleted
- **THEN** it fails rather than writing, because finding no history for an application that
  no longer exists, it would have created a fresh repository in the folder just removed

#### Scenario: The folder cannot be removed
- **WHEN** the repository folder still cannot be deleted after a few tries
- **THEN** the application is deleted all the same and the folder is logged, because creating
  an application never adopts a folder that is already there

#### Scenario: A colleague's draft
- **WHEN** someone who neither created the draft nor administers Specman looks at it
- **THEN** no delete control is shown, and the server refuses one sent anyway
