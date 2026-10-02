## ADDED Requirements

### Requirement: A failed send gives the answer back
When a turn cannot be completed, the page SHALL say so and SHALL return what the user wrote
to the answer box.

#### Scenario: The server refuses the turn
- **WHEN** the answer cannot be sent — the session ended, another turn holds the chapter, the
  server is down
- **THEN** the reason is shown in words and the answer is back in the box, because it had been
  cleared from the box and was gone

#### Scenario: Something other than a reply comes back
- **WHEN** the response is not a stream of events, such as a sign-in page
- **THEN** it is treated as a failure, rather than read as a reply with nothing in it

#### Scenario: The connection drops part-way
- **WHEN** the stream ends without saying the turn is done
- **THEN** the user is told the reply was cut off and that reloading shows what was recorded

## MODIFIED Requirements

### Requirement: A delayed reply cannot replace newer document state
Chat document mutations SHALL compare the captured project revision and apply atomically,
retaining the transcript and reporting a conflict when the document has changed.

#### Scenario: Two replies share a starting revision
- **WHEN** one finishes after the other has saved changes
- **THEN** its chapter, requirement, decision and section mutations are rejected together

#### Scenario: Completeness becomes stale
- **WHEN** the chapter's prose, status or open questions change while the completeness
  assessor is running
- **THEN** its verdict cannot replace the newer status or open questions; a change elsewhere
  in the document does not discard it, because the verdict is about this chapter

#### Scenario: A reply that changes nothing
- **WHEN** a reply only talks — no prose, no rule, no decision, no sections — and the
  document changed while it was written
- **THEN** it is kept and no conflict is reported, because it has nothing to check against a
  newer document; checking it failed a colleague's question back and threw away what it said

#### Scenario: A reply whose changes are refused
- **WHEN** the reply's changes are rejected as a conflict
- **THEN** the user's message is kept but the reply is not stored and its suggested answers
  are not offered, because stored, it said "I have recorded that" about changes that were not,
  and was replayed to the model as though they had been

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

#### Scenario: Attributes without quotes, tags in capitals
- **WHEN** the model writes `<chapter key=security>` or closes with `</CHAPTER >`
- **THEN** both are read as the ordinary form, for the same reason

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

#### Scenario: The assistant sends nothing back
- **WHEN** the reply holds no words, no suggested answers and no change to the document
- **THEN** the user is told nothing came back and that their message is saved, rather than
  the turn ending as though it had been answered

#### Scenario: The model is silent for a long time
- **WHEN** the model reasons before its first word, or between blocks
- **THEN** the server sends a comment line every fifteen seconds that the page ignores,
  because a proxy closes a connection that carries nothing for a minute, and the turn was
  cut off while the model was still at work

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

#### Scenario: A rule or a decision with nowhere to go
- **WHEN** a requirement or decision names no chapter of the document, and the conversation
  is the whole-document one, which belongs to no chapter
- **THEN** it is not filed under a guess and the user is told part of the answer was not
  saved, because it used to be dropped without a word

#### Scenario: A rule names its chapter by title
- **WHEN** a requirement or decision names its chapter by title rather than key
- **THEN** it is filed there, on the same terms as a chapter block

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

#### Scenario: A colleague's turn outlasts that
- **WHEN** a turn runs longer than a closed page stays listed
- **THEN** they stay listed as writing until it finishes, because the clear-out removed them
  part-way through a turn that went on writing to the document
