# LLM gateway access

## Purpose

Every model call in Specman goes to the primary gateway, which speaks the Anthropic Messages
API shape but is not answered by Claude, or — when that gateway is not configured or is not
answering — to Google's Gemini. The gateway's failure modes are not Claude's, and they are
not obvious from the response — a routing failure looks like a bug in the caller, and an
exhausted token budget looks like a parser fault. This capability is where those facts are
absorbed, and where the choice between the two providers is made, so no other capability has
to know either.

What any particular installation runs behind that gateway — which models, routed how, and
which of them misbehave — is configuration, not behaviour, and is deliberately not recorded
here or anywhere else in this repository.

## Source

- `src/lib/server/env.ts`
- `src/lib/server/llm/budgets.ts`
- `src/lib/server/llm/gateway.ts`
- `src/lib/server/llm/gemini.ts`
- `src/lib/server/llm/gemini-format.ts`
- `src/lib/server/llm/fallback.ts`
- `src/lib/server/llm/transport.ts`
- `src/lib/server/llm/types.ts`
- `src/lib/server/llm/parallel.ts`
- `src/routes/health/llm/+server.ts`

## Requirements

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

### Requirement: Gemini answers when the primary gateway cannot
A model call SHALL go to the primary gateway when it is configured, and to Gemini when it is
not, or when the primary fails before any of its answer has been passed on; and when both
fail, the caller SHALL be told of a failure to fit the answer in its room ahead of any other.

#### Scenario: Only Gemini is configured
- **WHEN** `LLM_URL`, `LLM_API_KEY` or `LLM_MODEL` is unset and `GEMINI_API_KEY` is set
- **THEN** every call goes to Gemini and the primary is never tried, because the variables
  were documented as a fallback and no code used them: every assistant feature failed on the
  missing `LLM_URL`

#### Scenario: The primary refuses or is down
- **WHEN** the primary fails — a refusal, an outage, its retries exhausted — before passing on
  any text
- **THEN** the same call is put to Gemini

#### Scenario: The primary fails part-way through its answer
- **WHEN** text has already been passed on
- **THEN** the failure is reported and Gemini is not asked, because starting again elsewhere
  repeats what the reader has, and feeds the chapter parser the same chapter twice

#### Scenario: Every call of a turn
- **WHEN** the primary has just failed
- **THEN** Gemini is asked first for the next two minutes, and the primary only if Gemini
  fails too, because each call of a turn waiting through the same failure made the fallback
  slower than the outage

#### Scenario: The primary ran out of room
- **WHEN** the primary failed because the answer did not fit in the room it was given
- **THEN** Gemini is asked for this call, and the primary is not passed over for the calls
  after it, because it answered and only the request was too big for it

#### Scenario: Both fail, one of them for room
- **WHEN** one provider ran out of room and the other failed for a reason of its own, such as a
  key it refused
- **THEN** the caller is told the call ran out of room, and the other failure is logged.
  Running out of room is the failure a caller can act on: a drafted chapter is asked for again
  with more room, and a mock-up asks for a smaller page. With an unusable Gemini key, every
  such failure was reported as Gemini's, "the assistant cannot be reached", and neither retry
  ever ran (found live on 2026-10-03)
- **AND** when neither ran out of room, the last failure is the one reported

#### Scenario: Neither is configured
- **WHEN** no provider is set up
- **THEN** the call fails naming the variables to set, and the user is told the assistant is
  not set up on this server, with their message kept

### Requirement: Gemini is held to the same rules
The Gemini client SHALL stream prose and make forced tool calls under the same terms as the
primary: retried only before anything is passed on, complete only when the answer says how it
finished, and failed when it ran out of budget.

#### Scenario: The stream stops without saying how it finished
- **WHEN** a Gemini stream ends with no finish reason
- **THEN** it fails as incomplete, because this API sends no closing event and a stream cut off
  looks otherwise like one that was done

#### Scenario: Gemini declines or runs out
- **WHEN** it finishes for the budget, for safety, or with a malformed call
- **THEN** the call fails, rather than an empty answer passing as a clean one

#### Scenario: A forced tool call
- **WHEN** a caller forces a tool
- **THEN** Gemini is allowed that function and no other, with the tool's JSON Schema passed
  as it is written

#### Scenario: Gemini's reasoning
- **WHEN** it returns thought summaries
- **THEN** they are never the answer, as with the primary's thinking

#### Scenario: A budget beyond what Gemini will write
- **WHEN** a call asks for more room than Gemini's models can write, 65 536 tokens
- **THEN** Gemini is asked for its most, and running out is judged against that, because
  Google refuses such a request outright, and the fallback would fail every call that asked
  for more. No budget asks for more today, so the fallback is given the same room as the
  primary

### Requirement: Bearer authentication
The client SHALL authenticate with an `Authorization: Bearer` header to the primary gateway.

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

#### Scenario: A test is run beside a real `.env`
- **WHEN** a variable is set to an empty string in the environment
- **THEN** the file's value is not used, because an empty variable is set; the test suite
  blanks the Gemini key this way so no fallback test reaches Google

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

#### Scenario: The primary goes quiet with Gemini to turn to
- **WHEN** the primary reaches the limit and Gemini is configured
- **THEN** the primary is not asked again at the same limit, and Gemini is asked instead,
  because four waits of three minutes is a quarter of an hour before the fallback is tried

### Requirement: Reasoning output is stripped
The client SHALL remove `thinking` blocks from responses before returning them, since the
reasoning model emits them and no caller wants them in the document.

#### Scenario: The reasoning model answers
- **WHEN** a response contains both thinking and text blocks
- **THEN** only the text reaches the caller

### Requirement: A call's budget covers its reasoning
Every call SHALL be given a `max_tokens` large enough for the model's reasoning as well as
its answer, at least twice the most a call of its kind has been seen to use, because a model
that thinks before it writes spends the same budget on both.

#### Scenario: Room to spare
- **WHEN** a call reads a whole chapter or document
- **THEN** it is given at least 16 000 tokens, and at least twice the most its kind has used:
  a turn or a drafted chapter 32 000, where one used 14 261; a mock-up's page 64 000, where a
  compact one used 25 168. Room unused costs nothing, because a call stops when its answer is
  done; a longer document, or a model that deliberates more, still fits
- **AND** the price is waiting: a call that reasons without end fails only once its room is
  spent, so twice the room is twice the wait before a retry, and that is accepted for answers
  that fit

#### Scenario: How much the gateway accepts
- **WHEN** a budget is chosen
- **THEN** it is ours to choose, because the primary gateway accepted every figure up to a
  million without complaint, and room beyond 32 000 is real: given 64 000, one answer ran to
  35 728 tokens and finished (measured on 2026-10-03)

#### Scenario: A call returns nothing
- **WHEN** the result is empty and the output-token count sits exactly on the ceiling
- **THEN** the budget is the cause, not the parser — three features failed this way while
  looking like logic bugs, one returning zero characters at 4000 that works at 12000

#### Scenario: A tool call runs out mid-argument
- **WHEN** the budget ends inside a tool argument
- **THEN** the gateway answers 400 with nothing usable, so tool calls get a generous floor
  and long output is never put in a tool argument at all

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

#### Scenario: Which provider is answering
- **WHEN** an administrator requests it on an installation with only one provider, or with a
  primary that has just failed
- **THEN** it reports which providers are configured and whether the primary is being passed
  over, rather than failing on the primary's missing settings

#### Scenario: Anyone else asks for it
- **WHEN** the request carries no session, or one without the administrator flag
- **THEN** it is refused before any gateway call is made, because one request spends up to
  twenty calls against a quota the whole company shares, and names the gateway while doing
  it

### Requirement: Every call says what it cost
Each completed call SHALL log its output tokens, the size of its prompt and how much of the
prompt the gateway's cache supplied.

#### Scenario: A prompt the gateway has seen the start of
- **WHEN** a call's prompt begins as an earlier one did
- **THEN** the log line gives the cached part and its share of the prompt, counting it in the
  prompt, because the gateway reports only the uncached rest as input and a layout that
  defeats the cache cannot otherwise be seen

#### Scenario: Where the figures come from
- **WHEN** a streamed call ends
- **THEN** the counts are taken from its final usage, because the gateway reports zeros at
  the start of the stream

#### Scenario: How much the cache is worth
- **WHEN** the layout of a prompt is argued about
- **THEN** the measurement of 2026-10-03 is the guide: steps of 768 tokens, served only as far
  as the prompt starts the same; at two to nine thousand tokens a warm prompt reached its first
  word about 0.4 seconds sooner, at 38 000 tokens 1.8 seconds sooner; a conversation turn
  spends most of its time reasoning, at about 100 tokens a second

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
