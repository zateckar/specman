# The guided interview

## Purpose

The user talks; the agent writes. This is the surface the whole product rests on: a chat
scoped to one chapter, in which the assistant asks about that chapter, writes its prose, and
records what was settled. Everything structured the assistant produces rides the text stream
rather than a tool argument, because truncation inside a tool call is a hard 400 with no
usable content.

See `README.md`, *The gateway*, and *Who asks, who decides*.

## Source

- `src/lib/server/llm/agent.ts`
- `src/lib/server/llm/blocks.ts`
- `src/lib/server/llm/sink.ts`
- `src/lib/server/llm/presence.ts`
- `src/lib/sse.ts`
- `src/routes/api/chat/+server.ts`
- `src/routes/api/ask/+server.ts`
- `src/routes/api/presence/+server.ts`
- `src/lib/components/AgentChat.svelte`

## Requirements

### Requirement: A turn is two independent calls
A conversation turn SHALL be a streamed prose call and a separate structured assessment
call, so that no long output is ever carried in a tool argument.

#### Scenario: The assistant writes a chapter
- **WHEN** a turn produces chapter prose
- **THEN** the prose arrives inside a streamed block and the tool call carries only small
  metadata — a key, an enum, short questions

#### Scenario: A tool call is truncated
- **WHEN** the model runs out of budget mid-argument
- **THEN** the gateway returns an unusable 400, which is why nothing that can grow is put
  there

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

#### Scenario: Blocks leave a hole in the prose
- **WHEN** several blocks are removed from one reply
- **THEN** the blank lines that surrounded them are collapsed, across chunk boundaries

### Requirement: A turn finishes whether or not anyone is watching
A turn SHALL run to completion once it has begun, and failing to deliver an event to the
browser SHALL NOT stop the work.

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

### Requirement: The interface says whether the document is saved
The page SHALL show whether everything said so far has been recorded.

#### Scenario: A turn is running
- **WHEN** the assistant is still writing
- **THEN** it says so, rather than claiming everything is saved

#### Scenario: The change could not be recorded
- **WHEN** a turn's changes did not reach the application's history
- **THEN** the indicator says so too, because a message saying otherwise underneath a header
  claiming "all changes saved" leaves the user to decide which one to believe

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

#### Scenario: A colleague closes the page
- **WHEN** they stop looking without saying so
- **THEN** they cease to be listed shortly afterwards

### Requirement: Every question stays inside the chapter being discussed
The assistant SHALL ask only about the chapter in scope.

#### Scenario: A neighbouring topic comes up
- **WHEN** the conversation touches something belonging to another chapter
- **THEN** it is not pursued as a question here, because answering adds the exchange to this
  chapter's conversation

### Requirement: Each scope owns its conversation
Messages SHALL be stored against the chapter they belong to, with the whole-document
conversation stored against no chapter.

#### Scenario: Switching chapters
- **WHEN** the user selects a different chapter
- **THEN** they see that chapter's conversation, not the project's entire message history

### Requirement: Open questions are asked by the assistant
Acting on an open question SHALL add an assistant turn asking it.

#### Scenario: The user clicks an open question
- **WHEN** the question is chosen from the index
- **THEN** the transcript shows the assistant asking it, not the user asking their own
  question and the assistant answering on their behalf

### Requirement: Answers may be offered, never imposed
A reply MAY end with at most four suggested answers, exactly one of them marked as
recommended, and typing an answer SHALL always remain available.

#### Scenario: An open-ended question
- **WHEN** the question has no small set of sensible answers
- **THEN** none are offered, because an unhelpful list is worse than no list

#### Scenario: The page is reloaded
- **WHEN** suggested answers were offered on the last reply
- **THEN** they are still there, because they are stored on the message

### Requirement: A chapter is opened deliberately
An untouched chapter SHALL offer an explicit way to start it.

#### Scenario: Opening a chapter nobody has discussed
- **WHEN** the chapter has no conversation
- **THEN** the pane offers to start it rather than expecting the user to know they must ask

#### Scenario: A chapter that already holds prose but no conversation
- **WHEN** the chapter's content was written elsewhere, such as by a split
- **THEN** the pane says so and offers to go through it, rather than claiming nothing has
  been written
