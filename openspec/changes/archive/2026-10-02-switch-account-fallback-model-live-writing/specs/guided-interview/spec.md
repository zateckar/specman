## ADDED Requirements

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
