# LLM gateway

## MODIFIED Requirements

### Requirement: A call's budget covers its reasoning
Every call SHALL be given a `max_tokens` large enough for the model's reasoning as well as
its answer, at least twice the most a call of its kind has been seen to use, because a model
that thinks before it writes spends the same budget on both.

#### Scenario: Room to spare
- **WHEN** a call reads a whole chapter or document
- **THEN** it is given at least 16 000 tokens, and at least twice the most its kind has used:
  a turn or a drafted chapter 32 000, where one used 14 261; a mock-up's page 64 000, where a
  compact one used 25 168; an overview 32 000, and 48 000 asked again, where one used 5 361.
  Room unused costs nothing, because a call stops when its answer is done; a longer document,
  or a model that deliberates more, still fits
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
