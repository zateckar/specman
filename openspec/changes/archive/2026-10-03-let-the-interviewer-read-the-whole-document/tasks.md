# Tasks

## 1. Specification

- [x] 1.1 Write the delta under `specs/guided-interview/spec.md`
- [x] 1.2 `npm run docs` passes

## 2. Implementation

- [x] 2.1 `llm/context.ts`, import-free: the rest of the document, shortened to a limit; the
      turn's state; the window's start
- [x] 2.2 `buildSystemPrompt` holds only what is stable; `buildTurnState` carries the rest
- [x] 2.3 The chat endpoint replays the stepped window and wraps only the request's last turn;
      the completeness check still reads the plain conversation
- [x] 2.4 `messageCount` and `messagesFrom` in the database: a count, then the rows from the
      window's start
- [x] 2.5 Found live, added: a reply naming a chapter it did not write is followed by one
      request for that chapter's block (`unwrittenMentions`, `repairRequest`)

## 3. Migration

- [x] 3.1 Nothing stored changes: the transcript is kept as it was written

## 4. Verification

- [x] 4.1 `npm test`, `npm run check` and `npm run build` clean
- [x] 4.2 The scripted seven-turn interview, before and after: every answer still written down,
      the contradiction in turn 6 noticed, and the share of each prompt served from the cache
      (`design.md`)
- [x] 4.3 Fold the delta into `openspec/specs/` and archive this change
