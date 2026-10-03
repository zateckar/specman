# Tasks

## 1. Specification

- [x] 1.1 Deltas under `specs/guided-interview/` and `specs/llm-gateway/`
- [x] 1.2 `npm run docs` passes

## 2. Implementation

- [x] 2.1 `types.ts`: content blocks for tool calls and results; `textOf`
- [x] 2.2 `gateway.ts`: tools in a streamed request; a `tool_call` event; a call counts as
      something written, for retries, for the fallback and for the silence check
- [x] 2.3 Gemini: blocks flattened to text, tools not offered
- [x] 2.4 `context.ts`: shown in full, as an outline, as rules or as a title, by relatedness and
      budget; `READ_TOOL` and `readChapter`
- [x] 2.5 Sections, in `context.ts` so the plain-Node tests load them: merge by heading,
      splicing only that part's lines
- [x] 2.6 The parser knows `<section>`; the chat endpoint files it and says it is writing
- [x] 2.7 The turn's checklist asks for sections when the chapter is long
- [x] 2.8 The chat endpoint runs the read loop: three rounds, the last one saying so
- [x] 2.9 Found by the tests: a call was echoed back as `tool_call` rather than `tool_use`,
      and each round's request shared one growing array

## 3. Migration

- [x] 3.1 Nothing stored changes

## 4. Verification

- [x] 4.1 `npm test`, `npm run check`, `npm run build`
- [x] 4.2 A long seeded document, live (`design.md`); the threshold lowered from what it
      showed
- [x] 4.3 Fold into `openspec/specs/` and archive
