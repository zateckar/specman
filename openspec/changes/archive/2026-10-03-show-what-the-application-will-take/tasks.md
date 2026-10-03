# Tasks

## 1. Specification

- [x] 1.1 Deltas for `application-overview` (new), `whole-document-draft`, `llm-gateway`
- [x] 1.2 `openspec/specs/application-overview/spec.md` created, so its `## Source` claims
      each new file
- [x] 1.3 `npm run docs` passes

## 2. Storage

- [x] 2.1 `overviews` table: one row per application, cascading with it; the judgements as
      JSON, the document revision they were made from, when
- [x] 2.2 `saveOverview` (replaces; does nothing for an application that is gone),
      `latestOverview`

## 3. Pure logic: `src/lib/server/llm/overview.ts`

- [x] 3.1 The prompt and the request, the catalogue listed from the same table that prices it
- [x] 3.2 Reading the reply: sections by tag, a missing closing tag tolerated; levels; work
      lines and service lines in the forms the model writes them; a reply with no pitch or
      no work is not an overview
- [x] 3.3 Settling the services: the reference architecture's baseline, a front door for
      external reach, hosting when none was chosen, one line per service at its larger size
- [x] 3.4 The figures: both routes, the range, calendar time, Azure monthly and yearly,
      environments other than production, support per year, all rounded and formatted in code
- [x] 3.5 The report as a standalone HTML file: everything escaped, no script, a policy, print
      styles, made-on date and staleness
- [x] 3.6 Unit tests in `scripts/test-agent.mjs`

## 4. The job: `src/lib/server/overviews.ts`

- [x] 4.1 Background job, one per application, through `longCalls`; progress; stop; a retry
      when the reply is unusable or runs out of room; failure in words
- [x] 4.2 Stopped when an untouched draft is deleted

## 5. Routes and page

- [x] 5.1 `/api/overview`: GET, POST (refused while drafting, with no model, with nothing
      written), DELETE
- [x] 5.2 `/projects/[id]/overview`: the report, out-of-date mark, refresh, progress, stop
- [x] 5.3 `/projects/[id]/overview/download`: the file
- [x] 5.4 The link beside the diagram and the mock-up
- [x] 5.5 Boundary tests in `scripts/test-server.mjs`

## 6. Fold in

- [x] 6.1 Apply the deltas, `PLAN.md`, archive this folder, `npm test`, `npm run check`
- [x] 6.2 Make an overview against the running application through the proxy, and save it

## Measured on the live gateway, 2026-10-03

- A document of twelve short chapters: the first overview used 4 513 output tokens, the refresh
  after a change 5 361, each at the first attempt in under a minute. The budget is 32 000.
- Read live, the AI route came out slower than by hand — 24 person-days for one person, six
  weeks against five for three — so its team is now tied to the team by hand; and five
  assumptions joined into one paragraph, so each line now stands alone and short-line
  sections are lists. Both are tested.
- Reviewed by the colleague who asked for it: the AI route was costed as if people worked
  beside the AI all day. Directing it is now 6, 10 or 15 per cent of the building and
  management 2, and rows are rounded to half days; the live example's AI route went from 27
  person-days and €17,900 to 20 and about €13,700, against 69.5 and €41,700 by hand.
- Reviewed again: hosting with AI is one or two days, since it writes the pipelines and
  infrastructure templates too. The live example's AI route is now 16 person-days, about
  €11,300, over two weeks with two people.
