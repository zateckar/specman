# The guided interview

## Purpose

The user talks; the agent writes. This is the surface the whole product rests on: a chat
scoped to one chapter, in which the assistant asks about that chapter, writes its prose, and
records what was settled. Everything structured the assistant produces rides the text stream
rather than a tool argument, because truncation inside a tool call is a hard 400 with no
usable content.

The assistant sees the rest of the document on every turn, so an answer can be checked against
what other chapters say; with only their titles it could not, and a contradiction went
unnoticed. A long document is shown in as much detail as fits, the chapters that bear least on
this one in outline, and any chapter can be read in full during the reply; a long chapter is
written back a part at a time, so what nobody discussed is not rewritten. What stays the same
while a chapter is discussed comes first in the prompt and what changes comes last, with the
colleague's message, because the gateway's cache serves a prompt only as far as it starts the
same as before. The designs and measurements are in
`openspec/changes/archive/2026-10-03-let-the-interviewer-read-the-whole-document/` and
`openspec/changes/archive/2026-10-03-keep-long-chapters-and-documents-within-reach/`.

## Source

- `src/lib/server/llm/agent.ts`
- `src/lib/server/llm/context.ts`
- `src/lib/server/llm/blocks.ts`
- `src/lib/server/llm/sink.ts`
- `src/lib/server/llm/presence.ts`
- `src/lib/server/llm/failures.ts`
- `src/lib/server/llm/progress.ts`
- `src/lib/sse.ts`
- `src/lib/activity.ts`
- `src/routes/api/chat/+server.ts`
- `src/routes/api/ask/+server.ts`
- `src/routes/api/presence/+server.ts`
- `src/lib/components/AgentChat.svelte`
- `src/lib/components/Dictation.svelte`
- `src/lib/dictation.ts`

## Requirements

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

### Requirement: The writing is shown as it happens
While a turn runs, the chat SHALL say what the assistant is doing, and the chapter being
written SHALL appear in the document as it streams, marked as not yet saved.

#### Scenario: The assistant rewrites a chapter
- **WHEN** a reply opens with the chapter, as replies do
- **THEN** the chat says which chapter is being written and how many words it has so far, and
  the document shows the text arriving under a "being written" mark, because the reply comes
  last and for most of a turn the user watched an empty bubble while text arrived the whole
  time

#### Scenario: Why the reply is not moved first
- **WHEN** the order of a reply is considered
- **THEN** the blocks stay first, because a model that stops early then stops before the
  reply rather than before writing anything down; showing the chapter is how the wait is
  shortened instead

#### Scenario: After the reply
- **WHEN** the reply has finished and the completeness check and the commit are still running
- **THEN** the chat says it is checking what is still open, then saving, because the box stayed
  locked under a reply that looked finished

#### Scenario: The turn fails partway through a chapter
- **WHEN** the stream fails after some of the chapter was shown
- **THEN** the document goes back to the stored chapter when the page refreshes at the end of
  the turn, because nothing shown while writing was saved

#### Scenario: A chapter block that names no chapter here
- **WHEN** the model writes into a chapter that cannot be placed
- **THEN** the chat still says it is writing, and none of the text is shown in any chapter,
  because it would be shown in one it may not belong to

#### Scenario: How often the chapter is sent
- **WHEN** the chapter streams
- **THEN** only what is new is sent, at most four times a second, and the whole of it once
  more as it closes, because the last characters are held back in case they begin the
  closing tag

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

### Requirement: Every question stays inside the chapter being discussed
The assistant SHALL ask only about the chapter in scope.

#### Scenario: A neighbouring topic comes up
- **WHEN** the conversation touches something belonging to another chapter
- **THEN** it is not pursued as a question here, because answering adds the exchange to this
  chapter's conversation

#### Scenario: The chapter is finished
- **WHEN** every criterion is met and nothing is left to ask
- **THEN** the assistant says so in one sentence and neither asks anything nor suggests
  another chapter, because the application offers the next one and a suggestion phrased as a
  question was filed as this chapter's open question

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

### Requirement: An answer may be spoken
Where the browser can transcribe speech, the chat SHALL offer a microphone that writes what
was heard into the answer box, after anything already typed, and SHALL send nothing until
the user presses Send.

#### Scenario: Speaking an answer
- **WHEN** the user presses the microphone and talks
- **THEN** the words appear in the answer box as they are recognised, and the box cannot be
  typed into until listening stops, because the recogniser rewrites it as it revises what it
  heard

#### Scenario: The answer is sent mid-sentence
- **WHEN** the user presses Send, picks an offered answer, or a turn starts while listening
- **THEN** listening stops at once and nothing heard afterwards reaches the box

#### Scenario: Where the recording goes
- **WHEN** the browser can transcribe the chosen language on the device, downloading it on
  first use if needed
- **THEN** it is transcribed there; otherwise the browser's online service is used and the
  status line says so for as long as it listens, because that recording leaves the company
  and the user is the one who decides whether to speak

#### Scenario: A browser without speech recognition
- **WHEN** the browser offers no speech recognition
- **THEN** no microphone is shown, rather than a control that can only fail

#### Scenario: The microphone is blocked
- **WHEN** permission is refused
- **THEN** the user is told how to allow it, and silence on its own is not reported as an
  error

### Requirement: A chapter is opened deliberately
An untouched chapter SHALL offer an explicit way to start it.

#### Scenario: Opening a chapter nobody has discussed
- **WHEN** the chapter has no conversation
- **THEN** the pane offers to start it rather than expecting the user to know they must ask

#### Scenario: A chapter that already holds prose but no conversation
- **WHEN** the chapter's content was written elsewhere, such as by a split
- **THEN** the pane says so and offers to go through it, rather than claiming nothing has
  been written

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

### Requirement: The interviewer reads the whole document
A conversation turn SHALL show the model every other chapter that applies, with its rules, in
as much detail as its room allows, and SHALL let the model read any chapter in full during its
reply, so that what the colleague says can be checked against what the document already says
however long the document grows.

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

#### Scenario: A document that fits
- **WHEN** the rest of the document fits in 48 000 characters, about 12 000 tokens
- **THEN** every chapter is shown whole and no reading is offered, because a read would be a
  round trip that learns nothing

#### Scenario: A long document
- **WHEN** it does not fit
- **THEN** the chapters that bear least on the one under discussion are shown in less detail
  first — as an outline of their headings and the first sentence of each paragraph, then as
  their rules alone, then as their title — and the Overview and the chapter's own parent,
  sub-chapters and siblings keep their detail until the rest is down to rules; every chapter
  stays named and every rule stays until the last step, rather than the end of each long
  chapter being cut off unseen, as an equal share did

#### Scenario: Which chapters bear on this one
- **WHEN** relatedness is decided
- **THEN** it is read from what the chapter under discussion is for — its title, goal, purpose
  and questions — and not from what it says now, so the choice does not move from turn to turn
  and the system prompt stays one the gateway's cache can serve

#### Scenario: A chapter shown only in part matters
- **WHEN** the model needs what an outline leaves out
- **THEN** it calls `read_chapter` with the chapter's key, or a key and one heading, and is
  given the chapter as it stands; the chat says which chapter is being read. Live on
  2026-10-03, with a document of 190 000 characters, the model read Users and roles, found a
  contradiction buried mid-paragraph, and corrected that part

#### Scenario: Reading does not go on for ever
- **WHEN** a reply keeps reading
- **THEN** it may read in three rounds, the third saying it was the last, and a call after it
  ends the reply with what it has written

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

### Requirement: A long chapter is written a part at a time
When the chapter under discussion is longer than 3 000 characters and has headings, the
assistant SHALL be asked to write only the parts that change, as section blocks, and the
server SHALL put each into the chapter by its heading, leaving every other part exactly as it
was.

#### Scenario: An answer changes one part
- **WHEN** the reply carries `<section chapter="data" heading="Cars">` with new text
- **THEN** that part is replaced, and every other line of the chapter is kept as written, so
  the change a reviewer sees is the change that was made; live on 2026-10-03 such turns
  changed a few lines each, where a whole rewrite of the same chapter cut it from 5 500
  characters to 1 400

#### Scenario: A part that is not there yet
- **WHEN** the heading matches none of the chapter's parts
- **THEN** it is added at the end, at the chapter's heading level

#### Scenario: How headings match
- **WHEN** the heading differs from the chapter's only in case, emphasis, numbering or a final
  colon
- **THEN** it is the same part

#### Scenario: A part with no heading named
- **WHEN** a section block has no heading attribute and its text does not begin with one
- **THEN** nothing is saved and the colleague is told part of the answer was not filed,
  because taken as the text before the first heading it would replace the chapter's opening

#### Scenario: An empty part
- **WHEN** a section block is empty
- **THEN** nothing changes, as with an empty chapter block; a part is removed only when the
  block says `action="remove"`

#### Scenario: A long chapter with no headings
- **WHEN** the chapter is long and has no headings
- **THEN** it is rewritten whole once, organised under headings, so later answers can change
  one part at a time

#### Scenario: A chapter too long to show
- **WHEN** the chapter under discussion is longer than 40 000 characters
- **THEN** it is shown as its outline and its parts, and the model reads the part it changes
  before writing it

#### Scenario: A short chapter
- **WHEN** the chapter is shorter than that
- **THEN** it is rewritten whole as before, because a short rewrite is quick and its changes
  are easy to see in review
