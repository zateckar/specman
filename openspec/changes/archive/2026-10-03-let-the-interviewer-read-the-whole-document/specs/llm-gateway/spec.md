# The LLM gateway

## ADDED Requirements

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
