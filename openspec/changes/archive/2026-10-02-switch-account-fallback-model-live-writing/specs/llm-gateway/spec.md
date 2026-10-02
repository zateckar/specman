## ADDED Requirements

### Requirement: Gemini answers when the primary gateway cannot
A model call SHALL go to the primary gateway when it is configured, and to Gemini when it is
not, or when the primary fails before any of its answer has been passed on.

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

## MODIFIED Requirements

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
