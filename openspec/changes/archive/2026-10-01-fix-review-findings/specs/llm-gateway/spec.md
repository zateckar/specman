## MODIFIED Requirements

### Requirement: A failed or incomplete stream never completes successfully
The client SHALL surface SSE errors, token truncation and EOF without a success terminator
as failures, and SHALL emit done only after message_stop or the explicit DONE sentinel.

#### Scenario: A stream fails after returning partial text
- **WHEN** the gateway emits an error after some text
- **THEN** the caller receives a failure and cannot persist the partial draft as a completed turn

#### Scenario: A connection ends or the output budget runs out
- **WHEN** a response reaches EOF without a success terminator or reports max_tokens
- **THEN** no successful done event is emitted

#### Scenario: An empty response completes successfully
- **WHEN** the stream emits a success terminator with no text
- **THEN** it completes successfully because silence is a valid finding-free verification response

#### Scenario: Silence that spent the whole budget
- **WHEN** a stream completes with no text and its output-token count has reached the
  ceiling, from a backend that did not report max_tokens
- **THEN** it fails as having run out of room, because that is the model reasoning until it
  was cut off, and accepting it let a starved check read as a clean one

#### Scenario: Transport chunks split CRLF delimiters
- **WHEN** an SSE frame's line endings arrive across separate chunks
- **THEN** the complete frame is still parsed and its terminal status is respected
