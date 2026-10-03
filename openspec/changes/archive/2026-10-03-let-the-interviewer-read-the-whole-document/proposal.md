# Let the interviewer read the whole document

## Why

The interviewer is told to keep every chapter consistent with the others and to say so when
something contradicts another chapter. It cannot: of the other chapters it sees only titles
and statuses, and the Overview. A scripted interview on 2026-10-03 seeded Users and roles
with "managers can see every booking made by their team, including the purpose" and then,
in the Data chapter, said "managers only ever see totals per department, never individual
trips". The assistant wrote the new rule down and carried on; nothing was said about the
chapter it now contradicts. The colleague is the one person who will not notice.

The prompt is also laid out so that it changes near its start every turn: the chapter's
status, its prose, its rules and its open questions sit in the system prompt, in front of the
conversation, and the conversation is a window that moves by one exchange each turn. The
gateway serves a prompt from its cache only as far as it starts the same as an earlier one,
in steps of 768 tokens, so most of every turn is read afresh. At today's two or three
thousand tokens that costs little; with the whole document in the prompt it would cost a
cold read of all of it on every turn.

## What Changes

- **The rest of the document is in the prompt.** Every other chapter that applies, in
  document order, with its prose and its rules, shortened when the document is long.
- **What stays the same comes first.** The system prompt carries only what does not change
  from one turn to the next within a chapter: the rules of the conversation, the
  application, the rest of the document, and what this chapter is for. What changes every
  turn — the chapter as it now reads, its rules, its open questions, where every chapter
  stands — and the checklist travel with the colleague's message, in the last turn.
- **The conversation window moves in steps.** It keeps at least the last sixteen messages
  and starts on a multiple of eight, so its start stays put for several turns instead of
  moving every turn.
- **A contradiction is corrected, and a claimed correction is made.** The checklist asks for
  the other chapter to be corrected in the same reply and the change said. A reply that names
  another chapter without writing it is followed by one short request for that chapter's
  block, because once, live, the model said it had changed three chapters and wrote none.
- **What is stored does not change.** The transcript keeps what the colleague wrote; the
  state wrapped around it exists only in the request.

## Impact

| | |
|---|---|
| Capabilities | `guided-interview` (what the interviewer is shown and in what order); `llm-gateway` (prefix caching is measured) |
| Migration | None. Nothing stored changes. |
| Gateway | Each turn's prompt grows by the size of the rest of the document, at most about 15 000 tokens; most of it is served from the cache after the first turn in a chapter. |
