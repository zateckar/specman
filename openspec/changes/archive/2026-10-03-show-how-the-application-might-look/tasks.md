# Tasks

## 1. Specification

- [x] 1.1 Deltas for `mock-up` (new), `whole-document-draft`, `access-control`
- [x] 1.2 Independent review of the plan; findings folded into `design.md`. The review found:
      the download carried no policy; the opaque origin makes storage and cookies throw and
      would kill ordinary pages; a tab of its own rested on the header alone; mock-ups
      bypassed the limit on long calls; a typeface alone spent a retry and a worse second
      reply replaced a better first; there was no total cap on input; a refused deletion
      stopped a good job; a restart was silent; the out-of-room advice was wrong here; some
      words were developer notation
- [x] 1.3 `openspec/specs/mock-up/spec.md` created now, so its `## Source` can claim each new
      file as it appears
- [x] 1.4 `npm run docs` passes

## 2. Storage

- [x] 2.1 `mockups` table: one row per application, cascading with it; the HTML, the document
      revision it was made from, when
- [x] 2.2 `saveMockup` (replaces; does nothing for an application that is gone),
      `latestMockup`

## 3. Pure logic: `src/lib/server/llm/mockup.ts`

- [x] 3.1 `mockupDocument`: chapters that apply in reading order, prose capped per chapter and
      shared out across the document, first-version rules capped; empty when nothing is written
- [x] 3.2 `buildMockupPrompt` (with the brief retry; changes in memory, not storage),
      `mockupRequest`
- [x] 3.3 `extractMockup`: the document between doctype and closing tag, or the end of its
      body, with a body
- [x] 3.4 `loadsFromOutside` (typefaces not counted), `worthAnotherTry`, `betterMockup`
- [x] 3.5 `prepareMockup`: doctype, the note, and first in the head the encoding, the file's
      policy, a viewport, and the stand-ins for storage, cookies and dialogs
- [x] 3.6 `MOCKUP_POLICY`, `MOCKUP_FILE_POLICY`, `mockupHeaders`, `forTheFrame`

## 4. The job: `src/lib/server/mockups.ts`

- [x] 4.1 One job per application in memory, detached with a top-level catch
- [x] 4.2 Waiting, thinking and writing progress
- [x] 4.3 One retry, brief, on out of room, no page, or outside files; the better kept
- [x] 4.4 Saved with the revision read with the document; the last failure kept for the page,
      in words that fit
- [x] 4.5 `longCalls` shared with drafting, moved to `llm/parallel.ts`
- [x] 4.6 `stopMockup`: by a person (said on the page), and when an untouched draft's deletion
      stands
- [x] 4.7 Found live: one call reasoned until 32 000 tokens were gone and wrote nothing. Split
      in two, as the diagram is: the screens decided in a short call, then the page written from
      them; without a list, the page call decides them itself
- [x] 4.8 Found live: with the screens decided, a full-size page still ran out; only the
      smaller retry wrote. The first page call now asks for that size: at most six screens, a
      few rows, around 20 to 30 KB

## 5. Endpoints and pages

- [x] 5.1 `/api/mockup`: GET progress; POST start (404, 409 while drafting, 503 without a model,
      422 with nothing written, an existing job followed); DELETE stop
- [x] 5.2 `/projects/[id]/mockup/view`: the page with the policy, framable by Specman only, not
      answered as a page of its own; nothing made said in the frame
- [x] 5.3 `/projects/[id]/mockup/download`: the same file as an attachment
- [x] 5.4 `hooks.server.ts`: `SAMEORIGIN` kept when a response set it, anything else `DENY`
- [x] 5.5 `/projects/[id]/mockup`: make, stop, progress, failure, interrupted, staleness,
      incomplete note, laptop and phone width, full screen, download; polling while a job runs
- [x] 5.6 `DocumentPreview`: the link beside the diagram, hidden while drafting

## 6. Tests

- [x] 6.1 `test-agent.mjs`: document digest and its caps, prompt, extraction, outside files,
      the better of two, the prepared page, policy, frame destination, the shared limit; the
      screens prompt, reading the list, the page call told they are decided
- [x] 6.2 `test-server.mjs`, with a stub gateway: made and kept from the document as read;
      progress; twice followed; view and download headers and refusals; staleness; retry on no
      page and on outside files, the fuller first kept; failure keeps the previous; out of
      room twice in fitting words; stopped; refused while drafting and with nothing written;
      not a touch; deleted with its application, and a running one stopped; the screens
      decided first and said so, given to the page call; no list, and the page call decides;
      an outage deciding them asks for no page

## 7. Verification and fold-in

- [x] 7.1 `npm test`, `npm run check`, `npm run build` clean
- [x] 7.2 A real mock-up against the live gateway in a throwaway instance behind the sign-in
      proxy, in the browser. Three runs. The first, as one call, reasoned for five minutes
      until 32 000 tokens were gone and wrote nothing; the Gemini key in `.env` was refused
      with a 401, and that hid the out-of-room behind "cannot be reached" (4.7). The second,
      split in two, wrote at the smaller retry after eight minutes (4.8). The third, compact
      from the start, was made at the first attempt in 4 min 20 s: the screens in 20 s and
      2 065 tokens, the page in 25 168 of 32 000. Checked in Chrome:
      - the page in its sandboxed frame, with no console errors;
      - a booking made through its form, which then showed in "My bookings" and in the fleet
        office's list;
      - the "viewing as" switcher changing the screens;
      - phone width, keeping the frame's state;
      - the downloaded file opened from disk with its policy, working the same.
      Earlier, with a probe page: no cookie or storage of Specman's, no fetch, no image from
      outside, no top navigation, and dialogs as the note
- [x] 7.3 Fold the deltas into `openspec/specs/`, update `PLAN.md`, archive this change
