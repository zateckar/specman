# LLM gateway access

## Purpose

Every model call in Specman goes through one gateway, which speaks the Anthropic Messages
API shape but is not answered by Claude. Its failure modes are not Claude's, and they are
not obvious from the response — a routing failure looks like a bug in the caller, and an
exhausted token budget looks like a parser fault. This capability is where those facts are
absorbed so no other capability has to know them.

What any particular installation runs behind that gateway — which models, routed how, and
which of them misbehave — is configuration, not behaviour, and is deliberately not recorded
here or anywhere else in this repository.

See `README.md`, *The gateway: what you need to know before changing the agent*.

## Source

- `src/lib/server/env.ts`
- `src/lib/server/llm/gateway.ts`
- `src/lib/server/llm/types.ts`
- `src/lib/server/llm/parallel.ts`
- `src/routes/health/llm/+server.ts`

## Requirements

### Requirement: Bearer authentication
The client SHALL authenticate with an `Authorization: Bearer` header.

#### Scenario: Calling the gateway
- **WHEN** any request is sent to the gateway
- **THEN** it carries `Authorization: Bearer <key>`
- **AND** it does not rely on `x-api-key`, which the gateway rejects with 401

### Requirement: Configuration is read outside SvelteKit
Configuration SHALL be read through `src/lib/server/env.ts` rather than
`$env/static/private`, so that server-side scripts work without booting SvelteKit.

#### Scenario: A server-side script needs the gateway key
- **WHEN** a script outside SvelteKit reads configuration
- **THEN** it gets the same values from the same `.env` file
- **AND** a real environment variable takes precedence over the file

#### Scenario: A required variable is missing
- **WHEN** a required variable is unset or empty
- **THEN** the call fails with a message naming the variable and pointing at `.env.example`

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

### Requirement: Reasoning output is stripped
The client SHALL remove `thinking` blocks from responses before returning them, since the
reasoning model emits them and no caller wants them in the document.

#### Scenario: The reasoning model answers
- **WHEN** a response contains both thinking and text blocks
- **THEN** only the text reaches the caller

### Requirement: Concurrent work is capped
Fan-out across chapters SHALL run through a concurrency-limited runner rather than issuing
every call at once.

#### Scenario: A document with twelve chapters is checked
- **WHEN** per-chapter calls are issued
- **THEN** no more than three are in flight at any moment

### Requirement: The gateway can be diagnosed without the application
`GET /health/llm` SHALL report which backend served each of a requested number of calls, to
an administrator.

#### Scenario: Diagnosing variable capability
- **WHEN** an administrator requests `GET /health/llm?runs=10`
- **THEN** the response names the backend that served each call
- **AND** the caller can see that identical requests were served by different models

#### Scenario: Anyone else asks for it
- **WHEN** the request carries no session, or one without the administrator flag
- **THEN** it is refused before any gateway call is made, because one request spends up to
  twenty calls against a quota the whole company shares, and names the gateway while doing
  it
