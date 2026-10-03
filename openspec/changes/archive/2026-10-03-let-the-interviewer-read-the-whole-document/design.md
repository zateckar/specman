# Design

## What was measured first

The question asked was whether the model client works with context, keeps a session, uses
the KV cache and splits its work the way agent frameworks do. Before changing anything, the
log was taught to say what each call cost (`describeUsage` in `llm/transport.ts`): output
tokens, the prompt, and how much of the prompt the gateway's cache supplied.

**The gateway caches prompt prefixes.** It reports `cache_read_input_tokens` in the final
usage, and `input_tokens` counts only the uncached rest. Probed on 2026-10-03:

| prompt | repeated | first token, cold | first token, warm |
|---|---|---|---|
| 2 300 tokens | 2 304 of it cached | 1.8 s | 1.4 s |
| 4 500 tokens | 3 840 cached | 2.0 s | 1.4 s |
| 9 000 tokens | 8 448 cached | 1.5 s | 1.2 s |
| 38 000 tokens | 38 400 cached | 3.3 s | 1.5 s |

It caches in steps of 768 tokens, and only as far as the new prompt starts the same as an
earlier one: one changed line at the top and nothing is served.

**A scripted interview on the old layout**, seven turns in the Data chapter of a pool-car
application whose Users and roles chapter says managers see every booking with its purpose:

| turn | prompt | cached | output | chapter written |
|---|---|---|---|---|
| 1 | 2 147 | 0% | 4 649 | yes |
| 2 | 2 497 | 0% | 3 536 | yes |
| 3 | 2 656 | 29% | 2 873 | yes |
| 4 | 2 835 | 27% | 3 682 | yes |
| 5 | 2 954 | 26% | 1 790 | yes |
| 6 | 3 146 | 49% | 2 224 | yes |
| 7 | 3 344 | 46% | 683 | yes |

Every answer was written down. Turn 6 said managers see only totals per department; the reply
recorded that and said nothing about the chapter it contradicts.

## What that means

- **The cache was not the cost.** At three thousand tokens a cold prompt costs a fraction of
  a second; a turn takes 12–53 seconds, nearly all of it the model reasoning before it writes.
  Laying the prompt out for the cache on its own would have bought almost nothing.
- **What the model cannot see was the cost.** "Keep every chapter consistent with the others"
  was an instruction it had no way to follow.
- Showing it the rest of the document makes the prompt several times larger, and then the
  layout matters: a prompt whose start changes every turn would be read cold every turn. So
  the two go together.

## The layout

```
system   rules of the conversation            stable for ever
         the application                     stable
         THE REST OF THE DOCUMENT             changes when another chapter does
         this chapter's purpose and criteria  stable
         how to split it                      changes when it is split
messages the window of the conversation       start moves every fourth turn
         last turn: where this chapter stands, the colleague's message, the checklist
```

- **The rest of the document** is every chapter that applies except the one under
  discussion, with prose and rules, in document order, held to 60 000 characters (about
  15 000 tokens). Over that, the longest chapters are cut to one equal share and say so; a
  plain cut-off would drop the last chapters entirely.
- **The checklist moves from the system prompt to after the colleague's message.** It was
  placed last in the system prompt because it is the rule the model most often drops; it is
  now the last thing in the request. `PLAN.md` records that adding to the system prompt once
  made the model skip writing an answer down, which is why the comparison below checks that
  every answer is still written.
- **A new checklist item** asks for a contradiction with another chapter to be corrected in
  the same reply, saying which chapter changed and what it said before, and to ask only when
  it cannot tell which is meant. The first wording asked for the correction to be *offered*;
  the model corrected it anyway, and an offer is an instruction that depends on a later turn
  — a plan with no owner.
- **A claimed change is made by the server.** If a reply names another chapter by title and
  wrote no block for it, the server sends the same request once more with the reply and a
  short message asking for that chapter's block and nothing else, and files whatever comes
  back for the chapters it named. Nothing back means the reply only mentioned it.
- **The stored transcript is unchanged.** Earlier turns are replayed as said; only the last
  turn of the request carries the state, so the state is never repeated and an earlier turn
  never changes.
- **The window moves in steps of eight**, keeping sixteen to twenty-three messages. A window
  that slides by one exchange changes the start of the messages on every turn.

## What the same interview did afterwards

Same seven turns, same seeded document, on the built server behind the sign-in proxy.

| run | turn 6 | cached share of the prompt, turns 1–7 | seconds in all | output tokens |
|---|---|---|---|---|
| old layout | contradiction not seen | 0, 0, 29, 27, 26, 49, 46% | 236 | 19 400 |
| new, "offer to correct" | corrected Users and roles, said so | 28, 24, 47, 68, 65, 62, 40% | 158 | 13 500 |
| new, "correct it" | **said it changed three chapters, wrote none** | 0, 0, 72, 68, 65, 63, 60% | 106 | 6 800 |
| turn 6 alone, five times | corrected and said so, five of five | — | 13–38 each | — |
| new, with the follow-up | corrected Users and roles, said so; follow-up never needed | 82, 47, 45, 64, 62, 60, 38% | 148 | 10 800 |

- Every answer was written down in every run: the PLAN.md worry did not come true, with the
  checklist after the message rather than in the system prompt.
- The prompt is 2 800–4 000 tokens. What is not cached is the turn's own state, about 1 300 to
  1 600 tokens, and stays about that size; on the old layout everything after the chapter's
  content was uncached, which with a document of 15 000 tokens would have been nearly all of
  it. The cache share also moves between runs for no reason in the request — the replica that
  answers matters — and drops for one turn after another chapter is written, as it should.
- The shorter times and smaller outputs are one run each and the model varies more than that
  between runs; they are not claimed as a result of this change.

## What was not done, and why

- **No framework.** LangChain, ADK and the like keep a session by replaying the transcript and
  trimming or summarising it, and use tools to read and write files. Here the chapter text is
  the session's memory — what was settled is written into the document every turn, so an old
  exchange can fall out of the window without losing anything — and the document is small
  enough to be in the prompt whole.
- **No tools to read or write the document.** Long tool arguments truncate into an unusable
  HTTP 400 on this gateway; the chapter rides the text stream for that reason. A read tool
  would add a round trip of reasoning to fetch what fits in the prompt anyway.
- **No summary of old conversation.** The chapter is the summary.
