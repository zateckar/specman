# Keep long chapters and long documents within reach

## Why

The interviewer now reads the rest of the document on every turn, which is what let it notice
a contradiction between chapters. It reads it whole, up to 60 000 characters, and past that
cuts the longest chapters off at an equal share — so in a long document it silently stops
seeing the end of every long chapter, and nothing tells it what it is missing or lets it look.

The chapter under discussion has the opposite problem. Every reply that records an answer
rewrites the whole chapter. For a chapter of a few hundred words that is a second or two of
writing; for one of five thousand it is a minute, a large share of the turn's budget, and a
rewrite in which a paragraph nobody discussed can quietly go missing. Splitting a chapter
into sub-chapters helps only chapters that can be split.

Neither grows well, and documents do grow: a mature application with its sub-chapters can run
to tens of thousands of words.

## What Changes

- **The rest of the document is shown as much as fits, and the rest can be opened.** Chapters
  are shown in full while they fit; past that, those least related to the chapter under
  discussion are shown as an outline — their headings, the first sentence of each paragraph
  and every rule — and past that as title and rules only. Which chapters are related is
  decided from what the chapter under discussion is for, so the choice does not move from turn
  to turn.
- **The assistant can read any chapter in full** with a `read_chapter` tool during its reply.
  The tool's argument is a chapter key, so nothing long ever rides in a tool call; the answer
  is the chapter as it stands. The gateway streams the call, and the follow-up request is
  served from its cache: about a second per chapter read, measured on 2026-10-03.
- **A long chapter is edited by section.** Past a length, the assistant is asked to write only
  the sections it changes, as `<section chapter="…" heading="…">` blocks, which the server
  merges into the chapter by heading. A section with a new heading is added at the end; a
  short chapter is still rewritten whole, as now.
- **The model client can carry a tool call in a stream.** `streamChat` takes tools and
  reports a call as an event; messages may carry tool calls and results. Gemini, which is
  asked only when the gateway fails, is given the same conversation as text and no tools.

## Impact

| | |
|---|---|
| Capabilities | `guided-interview` (what is shown, reading a chapter, section edits); `llm-gateway` (tool calls in a stream) |
| Migration | None. Nothing stored changes. |
| Gateway | A turn that opens a chapter makes one more request per chapter read, at most three, each mostly served from the cache. A long chapter's turn writes less. |
| Not changed | The mock-up, the diagram, verification and drafting already send a bounded document or its structure only. |
