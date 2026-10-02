## ADDED Requirements

### Requirement: A call that has gone quiet is given up on
A gateway call SHALL fail when it sends nothing for longer than a configurable limit,
`LLM_IDLE_TIMEOUT_MS`, three minutes unless set, and the request SHALL be abandoned with it.

#### Scenario: A backend stops answering
- **WHEN** no response, or no further part of a stream or of a tool call's answer, arrives
  within the limit
- **THEN** the call fails and the request is cancelled, because a stalled call held the turn —
  and the colleague's "writing" mark — for ever

#### Scenario: A model reasons for a long time
- **WHEN** it is silent before its first word for less than the limit
- **THEN** the call carries on, which is why the limit is minutes and not seconds

## MODIFIED Requirements

### Requirement: Transient routing failures are retried
The client SHALL treat a 400 matching a known transient shape as retryable, because retrying
re-rolls which backend the request routes to.

#### Scenario: A backend rejects what another would accept
- **WHEN** a tools request returns HTTP 400 matching a transient shape
- **THEN** the call is retried rather than surfaced as a failure

#### Scenario: The request is malformed
- **WHEN** a 400 does not match a known transient shape
- **THEN** it is surfaced to the caller rather than retried

#### Scenario: An installation has a backend of its own that misbehaves
- **WHEN** its signature is given in configuration
- **THEN** it is retried too, because naming somebody's broken backend in source would
  publish which models they run and which of them are faulty

#### Scenario: The stream reports an overloaded backend before any text
- **WHEN** a streamed response opens with 200 and then sends an `error` frame of an
  overloaded, rate-limited, timed-out or internal kind, before any text has been passed on
- **THEN** the request is made again, as a 429 or a 5xx would be, because the gateway reports
  the same condition either way and the turn failed on the first busy backend

#### Scenario: The stream fails after text
- **WHEN** the same error arrives once text has been passed on
- **THEN** it is not retried, because starting again would repeat the reply to the reader
