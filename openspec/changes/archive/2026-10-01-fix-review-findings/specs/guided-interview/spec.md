## ADDED Requirements

### Requirement: A turn's budget covers a whole chapter
A conversation turn SHALL be given room for the model's reasoning plus a full rewrite of the
chapter with its requirements and decisions.

#### Scenario: A long chapter is answered
- **WHEN** a chapter of a few thousand words is rewritten in one reply
- **THEN** the reply completes, because at 6000 tokens such a chapter could never be written
  and every retry failed the same way, leaving the user's answer unrecorded

### Requirement: A chapter block is filed where it was meant
Every chapter block in a reply SHALL be saved into the chapter it names, and a block that
cannot be placed SHALL be reported rather than dropped.

#### Scenario: The block names no chapter
- **WHEN** a chapter block carries no key
- **THEN** it is saved into the chapter under discussion, which is what the model nearly
  always means

#### Scenario: The block names the title
- **WHEN** a chapter block carries the chapter's title instead of its key
- **THEN** it is matched as a title, ignoring case

#### Scenario: The block names nothing in the document
- **WHEN** no chapter matches
- **THEN** the user is told part of the answer was not saved and can be asked for again,
  because prose that reads as recorded and is not is the worst outcome of a turn

#### Scenario: The block is empty
- **WHEN** a chapter block holds nothing, or only whitespace
- **THEN** the chapter is left as it was, because nobody means to erase a chapter by writing
  nothing into it

#### Scenario: A set-aside chapter is written into
- **WHEN** a reply writes prose, a requirement or a decision into a chapter the triage set
  aside
- **THEN** the chapter is brought back into scope, because content in it means it applies,
  and left aside its rules were reported as belonging to a chapter that no longer exists

#### Scenario: The assessment fails after a chapter was written
- **WHEN** a turn writes the chapter under discussion and the completeness call then fails
- **THEN** a chapter that was empty becomes in progress, rather than reading as not started
  while it holds the text just written

### Requirement: The conversation sent to the model is one the gateway accepts
The transcript replayed to the model SHALL open with a user turn, SHALL contain no empty
turns, and SHALL alternate between the user and the assistant.

#### Scenario: The user answers a question clicked from the index
- **WHEN** the conversation begins with the assistant asking that question
- **THEN** a neutral user turn is put in front of it, so the question reaches the model with
  the answer, rather than being dropped and leaving the answer to stand alone

#### Scenario: A reply was nothing but blocks
- **WHEN** the assistant's reply had no words outside its blocks
- **THEN** no empty turn is stored or sent, because an empty text turn is refused outright
  by an Anthropic-shaped API, and would be replayed with every later turn of the chapter

#### Scenario: An earlier turn failed
- **WHEN** two user turns stand next to each other
- **THEN** they are sent joined as one

### Requirement: One turn at a time, and nothing typed is lost
While any turn is running the chat SHALL NOT accept another — Send, the suggested answers, the
open questions and the start button are all unavailable — and an answer being written SHALL
survive both a clicked suggestion and a switch to another chapter.

#### Scenario: Answering while another chapter is still being written
- **WHEN** the user opens a different chapter while a turn runs, and tries to send there
- **THEN** sending is unavailable until the turn finishes, because the page runs one turn at a
  time and the answer was cleared from the box and silently dropped

#### Scenario: A suggestion is clicked over a half-typed answer
- **WHEN** the user has typed or dictated something and then clicks a suggested answer
- **THEN** the suggestion is sent and what they had written stays in the box

#### Scenario: Looking at another chapter mid-answer
- **WHEN** the user switches chapter with an unsent answer and comes back
- **THEN** the answer is still there, kept per chapter, because the pane is rebuilt on every
  switch

### Requirement: The conversation can be followed without seeing it
The conversation SHALL be announced to assistive technology once each reply is whole, the
answer box SHALL be labelled, and focus SHALL return to the answer box when a reply finishes.

#### Scenario: Using a screen reader
- **WHEN** the assistant replies
- **THEN** the new turn is announced once it has finished streaming rather than word by word,
  and an error is announced when it appears

#### Scenario: Answering from the keyboard
- **WHEN** a reply finishes
- **THEN** the cursor is back in the answer box, because the box is disabled while the reply
  is written, which takes focus away from it

## MODIFIED Requirements

### Requirement: Structured blocks are parsed from the stream
The parser SHALL recognise chapter, requirement, decision, options, sub-chapter and finding
blocks in the streamed text, and SHALL remove them from what the user sees.

#### Scenario: A block arrives split across chunks
- **WHEN** an opening tag is delivered one character at a time
- **THEN** the raw tag never appears in the chat, because the parser matches the shape of a
  possible tag rather than holding back a fixed number of characters

#### Scenario: A block is left unterminated
- **WHEN** the stream ends inside a block
- **THEN** what arrived is salvaged rather than discarded

#### Scenario: The model forgets to close a chapter
- **WHEN** a chapter block is never closed and another block opens after it
- **THEN** the chapter ends where the next block opens and everything after is parsed as it
  would have been, because blocks never nest — otherwise the requirements, the decisions,
  their `WHEN`/`THEN` lines and the reply itself were all saved as chapter prose

#### Scenario: Attributes in single quotes
- **WHEN** the model writes `key='security'`
- **THEN** it is read like `key="security"`, because refusing it printed the raw tag and the
  whole chapter into the chat and saved nothing

#### Scenario: Blocks leave a hole in the prose
- **WHEN** several blocks are removed from one reply
- **THEN** the blank lines that surrounded them are collapsed, across chunk boundaries

### Requirement: A turn finishes whether or not anyone is watching
A turn SHALL run to completion once it has begun, and failing to deliver an event to the
browser SHALL NOT stop the work; a gateway generation failure SHALL leave existing chapter
content unchanged and report the failure instead of saving a partial draft.

#### Scenario: The tab is closed mid-turn
- **WHEN** the browser disconnects while the assistant is replying
- **THEN** the reply, the chapter it rewrote, the requirements and decisions it settled, the
  reassessed status and the commit recording them are all still written

#### Scenario: Returning to the application afterwards
- **WHEN** the user opens the chapter again
- **THEN** they find the turn they did not wait for already recorded, rather than being
  asked the same question a second time

#### Scenario: Delivery fails for a reason of our own
- **WHEN** an event cannot be serialised
- **THEN** it is raised rather than counted as a disconnected browser, because a defect in
  what we send and a reader who left must not be handled the same way

#### Scenario: Generation stops partway through a draft
- **WHEN** the gateway reports an error or an incomplete response after returning chapter text
- **THEN** the user sees an error, their submitted answer remains stored, and the partial
  draft does not replace the chapter or reach the proposal

#### Scenario: Something fails during a turn
- **WHEN** the gateway, the network or storage fails
- **THEN** the user is told in plain words whether their message was kept and whether trying
  again will help, and the cause goes to the log, because "Gateway stream failed with 502"
  or the text of a database error is nothing a colleague who commissions software can act on

### Requirement: A turn belongs to the document, not to the pane showing it
A turn in progress SHALL survive the user opening a different chapter, and when it finishes
the page SHALL show what it changed.

#### Scenario: The user opens another chapter while the assistant is replying
- **WHEN** they switch part-way through
- **THEN** the turn continues, and the chapter it was writing says so by name, so the answer
  they gave does not look as though it was dropped

#### Scenario: The turn finishes while they are elsewhere
- **WHEN** it completes
- **THEN** the index, the preview and the review indicator are brought up to date wherever
  the user now is, rather than showing what was true before they moved

#### Scenario: The reply is held until the page has caught up
- **WHEN** a turn ends
- **THEN** the reply stays on screen until the refreshed conversation arrives, because
  releasing the turn first showed the transcript as it was before the turn, and the reply
  vanished until the reload came back

### Requirement: Colleagues in the same document are visible to each other
The page SHALL show who else has this application open, and who is writing.

#### Scenario: Two people open the same document
- **WHEN** both have it open
- **THEN** each is told the other is there, because two descriptions of one chapter end with
  only the later one, and the person who can see the collision is the one who can avoid it

#### Scenario: A colleague is mid-turn
- **WHEN** the assistant is writing for them
- **THEN** that is said, and it stays said until the turn finishes rather than until their
  browser disconnects — the writing is what matters to anyone else

#### Scenario: A colleague has two turns running
- **WHEN** one of two turns for the same person finishes
- **THEN** they are still shown as writing until the other does, because the mark counts
  turns rather than being switched off by whichever ends first

#### Scenario: A colleague closes the page
- **WHEN** they stop looking without saying so
- **THEN** they cease to be listed shortly afterwards
