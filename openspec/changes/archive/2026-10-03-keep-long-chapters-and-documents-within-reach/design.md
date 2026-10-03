# Design

## The two things that do not scale

**What the model reads.** Putting the rest of the document in the prompt made the interviewer
consistent, but its cost grows with the document, and past 60 000 characters the long chapters
were cut off at an equal share, with nothing to say what was missing or a way to look.

**What the model writes.** Every turn that recorded an answer rewrote the whole chapter. That
is fine at a few hundred words. At several thousand it is a minute of writing per turn, a large
part of the budget, and — the part that matters — a rewrite in which text nobody discussed
gets condensed or dropped.

## What other agents do, and what fits here

Agents that work on large codebases — Opencode, Claude Code, ADK's tool loops — keep an index
in the prompt and read files on demand with tools, and they edit by replacing a region rather
than rewriting a file. Both ideas carry over. One constraint on this gateway shapes how: a long
tool argument truncates into an unusable HTTP 400, so writing still rides the text stream, and
only reading uses a tool, whose argument is a key.

## Measured before building

On 2026-10-03 the gateway was asked a question it could answer only by reading a chapter it
was told about, with a `read_chapter` tool offered on a streamed request:

| step | time | prompt | cached |
|---|---|---|---|
| ask, with tools | 1.2 s, stopped with `tool_use` and `{"key": "security"}` | 6 242 | — |
| answer the call and ask again | 1.0 s, answered correctly | 6 347 | 6 144 |

Kimi's reasoning blocks were left out of the follow-up and it did not matter. A read costs
about a second, because the follow-up starts the way the first request did and the cache
serves it.

## The shape

- **Rest of the document, in as much detail as fits** (`documentContext`): whole while the
  total fits 48 000 characters; past it, least related first, each chapter falls to an
  outline (headings, the first sentence of every paragraph, the first item of every list —
  made in code, so it cannot misstate the chapter), then to its rules, then to its title. The
  Overview and the chapter's family are cut only after the rest is at rules.
- **Relatedness from the chapter's purpose**, not its prose: words of the title, goal,
  purpose and questions against each other chapter's words. It does not move turn to turn,
  which keeps the system prompt the cache serves.
- **`read_chapter`**, offered only when something is shown in part. A key, or a key and a
  heading for one part. At most three rounds a turn; the third answer says it is the last;
  a call after that ends the reply.
- **Sections** for a chapter over 3 000 characters with headings: `<section chapter heading>`
  blocks, merged by heading in code, splicing only the lines of that part. A long chapter
  without headings is rewritten once under headings. A chapter over 40 000 characters is
  shown as its outline and its parts are read before they are written.
- **The model client** gained tool calls in a stream (`tool_call` events, content blocks in
  messages). Gemini, the fallback, gets the conversation as text and no tools.

## Live, on a long document

A throwaway instance, a project seeded to 190 623 characters (about 48 000 tokens) over twelve
chapters of about 12 000 characters each under headings; Data at 9 709 characters; a
contradiction buried mid-paragraph in the Managers part of Users and roles (18 000
characters). Five scripted answers in Data:

| turn | read | written | prompt, cached | output | time |
|---|---|---|---|---|---|
| 1 mileage and lateness | — | Data by section | 14 783, 0% | 3 080 | 36 s |
| 2 car colour | — | Data by section | 14 601, 53% | 1 010 | 14 s |
| 3 managers see totals | Users and roles, Functionality | Data, and the Managers part of Users and roles | 14 401 → 15 579, 80–94% | 2 212 + 66 + 2 114 | 50 s |
| 4 two years, not three | — | Data by section | 14 572, 0% (Users and roles had changed) | 1 936 | 30 s |
| 5 fuel cards | — | Data **whole** | 14 392, 85% | 2 715 | 39 s |

- **The prompt stayed at a third of the document**, and grows with the number of chapters,
  not their length.
- **Reading found what the outline hid.** The contradiction was not in any first sentence;
  the model read the chapter, said what it had said, and corrected that part only — the rest
  of its 17 000 characters untouched.
- **Section turns changed a few lines each** (`git diff` of turns 2–4: one or two hunks in the
  named part, plus the rules files).
- **The whole rewrite in turn 5 condensed the chapter from 5 516 characters to 1 425.** The
  chapter had fallen under the first threshold, 6 000, so the old instruction applied. What
  went was filler the seed had generated, and every fact survived — but it is exactly the
  behaviour sections exist to prevent, so the threshold was lowered to 3 000.

## Not done

- **The completeness check** still reads the whole chapter under discussion. It writes nothing
  and its input is unlimited; a chapter of 40 000 characters is about 10 000 tokens.
- **Other callers** — the mock-up clips each chapter to a share of 45 000 characters, the
  diagram sends structure only, verification sends one chapter at a time and the Overview
  with all rules, drafting sends titles and the Overview. All already bounded.
- **The 40 000-character outline for the chapter under discussion** is unit-tested only; no
  live document had a chapter that long.
