# Tasks

## 1. Specification

- [x] 1.1 Deltas for `whole-document-draft` (new), `project-setup`, `guided-interview`,
      `decisions`, `storage-and-migrations`, `access-control`
- [x] 1.2 Independent review of the plan; findings folded into `design.md`
- [x] 1.3 `openspec/specs/whole-document-draft/spec.md` created now, so its `## Source` can
      claim each new file as it appears (the coverage check fails otherwise)
- [x] 1.4 `npm run docs` passes

## 2. Storage

- [x] 2.1 `ADDED_COLUMNS`: `projects.origin TEXT NOT NULL DEFAULT 'interview'`,
      `projects.drafted_revision INTEGER`; `Project` type gains both
- [x] 2.2 `createProject({ origin })`: a drafted application records `drafted_revision` at the
      end of its creation transaction; the returned row is read after the chapters are written
- [x] 2.3 `chapterHoldings`, `draftEvidence` (user messages, proposals past draft, approval
      journal rows, both revisions)
- [x] 2.4 `recordDraftedChapter`: one transaction that re-checks the chapter is the drafter's,
      writes prose, rules (deduplicated against the chapter and the reply) and decisions (one
      filed when there are none), sets the assessed status, and advances `drafted_revision`
      only if it still equalled the document revision beforehand
- [x] 2.5 `deleteUntouchedDraft`: re-checks untouched and deletes in one transaction
- [x] 2.6 `confirmChapterDecisions`

## 3. Pure logic

- [x] 3.1 `llm/draft.ts`: `chaptersToDraft`, `buildDraftPrompt`, `draftedProse`,
      `asDraftBlock`, `isUntouchedDraft`, `draftState`
- [x] 3.2 Review fixes: user messages only per chapter; `draftedProse` normalises before
      judging empty; the fallback decision; `draftState` distinguishes a stopped untouched draft
      from undrafted chapters in a touched document, and an empty draft
- [x] 3.3 `llm/parallel.ts`: `createSlots`, a process-wide limit shared by every draft; work
      given up while waiting leaves the queue
- [x] 3.4 `llm/presence.ts`: `writing(projectId)`

## 4. The drafting job: `src/lib/server/drafting.ts`

- [x] 4.1 One job per application in memory; started detached with a top-level catch
- [x] 4.2 Overview alone, then the rest; at most three calls installation-wide
- [x] 4.3 Per chapter: call; one retry with 24000 tokens on no chapter or out of room; assess
      the prose; then write and commit "Draft <title>" as one held section; nothing once aborted
- [x] 4.4 A final commit at the end of every run
- [x] 4.5 `stopDraft` (abort, wait up to 70 s, report whether it settled); `isDrafting`;
      `draftView` for the pages
- [x] 4.6 `deleteDraft`: creator or administrator, untouched, stop, then under the repository
      lock delete rows and folder (with retries)
- [x] 4.7 `workingProposal` refuses an application that is no longer in the database

## 5. Endpoints and pages

- [x] 5.1 Home `create`: `start=draft|interview`; a draft needs a description and a model;
      description capped at 2000 characters; the job starts after the repository exists
- [x] 5.2 Home `delete` action
- [x] 5.3 `/api/draft`: GET progress; POST draft the rest
- [x] 5.4 409 while drafting in `/api/chat` and `/api/ask` (before storing anything),
      `/api/verify`, `/api/architecture`, and the review page's approve; the page's refusal
      wording for 409
- [x] 5.5 `/api/decisions`: `confirm-chapter`
- [x] 5.6 Creation form: description as a short textarea; how to start, in plain words; the
      submit button follows the choice
- [x] 5.7 Home cards: stretched link with a sibling delete button; "AI draft" badge; "Drafting…
      n of m"; description clamped to three lines; in-page confirmation with focus handling;
      refresh while any card is drafting
- [x] 5.8 Workspace: a banner outside the grid (running, stopped, undrafted, untouched) with
      `role="status"`; draft the rest; delete; conversation closed while drafting; review and
      diagram links hidden while drafting; polling `/api/draft` and refreshing when a chapter
      lands
- [x] 5.9 `DocumentPreview`: chapters being drafted marked; "All of these are right"
- [x] 5.10 `AgentChat`: the closed state; a drafted chapter's intro

## 6. Migration

- [x] 6.1 Nothing stored changes for existing applications: the column defaults are their
      correct values (recorded in the `storage-and-migrations` delta)

## 7. Tests

- [x] 7.1 `test-agent.mjs`: selection and order, prompt, prose and block filing, the fallback,
      untouched truth table, draft state, slots, presence
- [x] 7.2 `test-server.mjs`, with a stub gateway:
      - a drafted application end to end: chapters, decisions unconfirmed, commits, revision
        chain intact, untouched;
      - the mark lost on a message, a confirmation, a discard, an inclusion, an approval;
      - the mark kept by a whole-document check and an open question asked;
      - a human write between two chapters breaks the chain for good;
      - chat, ask, verify and the diagram refused while drafting;
      - delete refused when touched and for a colleague, allowed for the creator, folder gone;
      - delete of a draft with a check queued leaves no folder behind;
      - creation refused with no description;
      - an old database reads every application as an interview.

## 8. Verification and fold-in

- [x] 8.1 `npm test`, `npm run check`, `npm run build` clean
- [x] 8.2 A real draft against the live gateway in a throwaway instance behind the sign-in
      proxy, driven in the browser: create, watch, finished state, mark, confirm a chapter to
      remove the mark, delete another draft. Nine chapters drafted, none retried, the largest
      at 14261 of 16000 output tokens, about six minutes a chapter. Found and fixed: the
      closed conversation's header repeated the banner and squeezed the chapter title; a
      chapter whose assumptions were all confirmed still said nothing in it had been checked.
- [x] 8.3 Fold the deltas into `openspec/specs/`, note the drafter in `formal/README.md` as a
      writer outside the modelled protocol, update `PLAN.md`, archive this change
