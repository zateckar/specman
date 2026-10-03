# The LLM gateway

## ADDED Requirements

### Requirement: A streamed reply may call a tool with a short argument
`streamChat` SHALL accept tools, SHALL report a call the model makes as an event once its
arguments are complete, and SHALL accept conversations that carry calls and their results; a
tool offered this way SHALL take identifiers only, never prose.

#### Scenario: The model asks to read a chapter
- **WHEN** the model calls a tool while it streams
- **THEN** the call arrives as one event with its arguments put together, after any text
  before it, and the stream ends; the caller answers and asks again, and the gateway serves
  that request from its cache (measured 2026-10-03: 6 144 of 6 347 prompt tokens, under a
  second)

#### Scenario: Arguments that do not parse
- **WHEN** a call's arguments are not an object
- **THEN** they are read as empty, and the tool answers that it was not told what to do,
  rather than the turn failing

#### Scenario: A call counts as an answer begun
- **WHEN** a call has been passed on and the stream then fails
- **THEN** it is not asked again elsewhere, as text already passed on is not

#### Scenario: No tools
- **WHEN** a request offers none
- **THEN** none are sent, so every other call is the request it was

#### Scenario: Gemini answers instead
- **WHEN** the fallback is asked part-way through a reply that has read
- **THEN** it is given the conversation as text — a call as a line saying so, a result as
  itself — and no tools, so it answers with what was read
