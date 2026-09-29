# Specman

[![Build](https://github.com/zateckar/specman/actions/workflows/build.yml/badge.svg)](https://github.com/zateckar/specman/actions/workflows/build.yml)

AI-guided application design for non-technical users.

A colleague describes the application they need; an agent interviews them and writes the
design document. They never edit the document directly. The chapter index always shows how
complete each chapter is and what is still unanswered, so "what's left to decide" is
visible at a glance.

Every application gets its own Git repository. Chapters are Markdown, so pull-request diffs
read as prose rather than as machine output.

## Running it

```bash
npm install
cp .env.example .env   # fill in the gateway key
npm run dev
```

First boot creates an `admin` account from `ADMIN_PASSWORD` and seeds the default template.
The bootstrap only runs while the user table is empty, so it is not a permanent backdoor.

| Command | |
|---|---|
| `npm run dev` | development server on :5173 |
| `npm run check` | type-check (`svelte-check`) |
| `npm test` | agent tests **and** the documentation check (plain Node, no runner) |
| `npm run docs` | the documentation check on its own |
| `npm run build` | production build (`adapter-node`) |
| `GET /health` | liveness — 200 while the database is readable and writable |
| `GET /health/llm?runs=10` | gateway diagnostics — administrators only, spends real quota |

Behind a gateway there is no login page, so nothing can be reached from a browser on a
developer's machine unless something in front supplies the headers. That is
`node scripts/proxy-sim.mjs --port 6001 --target http://127.0.0.1:5199 --user novak.jan`;
run two on different ports to be two colleagues at once.

## Running it somewhere else

Specman is published as `ghcr.io/zateckar/specman` by `.github/workflows/build.yml`. The
tests and the documentation check gate the build, so an image that exists is an image whose
specification agrees with its code, and a pull request is built but never pushed.

```bash
cp .env.example .env          # gateway key, admin password, OIDC if you use it
docker compose up -d
```

`latest` follows the default branch. To pin a deployment, set `SPECMAN_IMAGE` to a tag the
workflow also publishes — a release (`ghcr.io/zateckar/specman:1.2.0`) or an exact commit
(`ghcr.io/zateckar/specman:sha-<full sha>`).

A new GHCR package is private, so the first pull from the deployment host needs either
`docker login ghcr.io` with a token that can read packages, or the package set to public in
its GitHub settings. Nothing in the workflow can decide that for you: it is a question about
who the image is for.

Three things about that deployment are load-bearing. Each is one line, and each was paid for
by something in this repository:

**`git` is part of the runtime.** `simple-git` shells out to the real binary, and every
application is a real repository. A plain Node image boots cleanly and then fails on the
first project anyone creates, which is why the `Dockerfile` installs it explicitly rather
than inheriting whatever the base image happens to carry.

**Everything that must survive a restart is under `/app/data`** — the SQLite database *and*
every application's Git repository. Deploy a new image over an installation with nothing
mounted there and every design document is gone, with no error anywhere: the application
starts, serves, and shows an empty list. The compose file mounts a named volume, and
`GET /health` checks that the directory is still writable rather than only that the process
is alive. An open SQLite handle goes on answering queries long after its volume has gone.

**The port is published to loopback only.** Specman signs people in from `X-Forwarded-User`
when a gateway in front has already authenticated them, and a header is a string the caller
chose. That is safe only while the gateway is the sole route to the port *and* it overwrites
those headers. `PROXY_AUTH_TRUSTED_IPS` makes the first checkable from inside — set it, and
read the boot log, which prints what it trusts and warns loudly when it trusts everyone. The
second is the gateway's configuration and cannot be seen from here at all.

One trap worth knowing: the address Specman sees is not the address the gateway thinks it
has. A gateway on the host reaching `127.0.0.1:3000` arrives from the Docker bridge, not from
`127.0.0.1`. Sign in once and read the refusal in the log — it names the peer it actually
saw. If the gateway is itself a container, prefer putting both on one Docker network and not
publishing the port at all.

`ORIGIN` must be the public URL. SvelteKit rejects form submissions whose `Origin` header
does not match it, so getting this wrong behind a gateway fails every form — including
sign-in — with a cross-site error that reads like nothing in particular.

## How it fits together

```
Browser  ──  three panes: chapter index │ agent chat │ live document
                                │
SvelteKit  ──  /api/chat (SSE) ─┴─ agent  ──  LLM gateway
                    │
        SQLite (state, transcript, templates)
                    │
        Git repo per application (source of truth for chapter text)
```

- `src/lib/server/llm/` — gateway client and the agent
- `src/lib/server/db/` — schema, queries, default template
- `src/lib/server/git/` — one repository per application
- `src/lib/server/proposals.ts` — working branches, diff, approve
- `src/lib/components/` — the three panes

Git holds chapter content; SQLite holds everything else and caches chapter text so the
preview renders without shelling out to git.

## Specman's own specification

Specman writes design documents; it also has one. `openspec/` holds it in **OpenSpec
format** — `specs/` is what the code does today, one folder per capability, and `changes/`
is what someone proposes it should do instead.

```
openspec/
  AGENTS.md              read this before changing anything
  project.md             stack, commands, the rules that are not negotiable
  specs/<capability>/spec.md    requirements, each with at least one scenario
  changes/<change-id>/          proposal, tasks, and the delta
  templates/                    what to copy when raising one
```

The rule that makes it worth having:

> **No change is finished until the specification agrees with it** — and `npm test` fails
> if it does not.

`scripts/check-docs.mjs` runs in the same command as the unit tests. It checks the shape of
every capability (a requirement with no scenario is an opinion), the shape of every proposed
change, and — the part that does the work — that **every file under `src/` is claimed by
exactly one capability's `## Source` list**. Adding a module, renaming one, or moving code
between areas all fail until the specification is told. That is the same principle as
everything else here: a rule that lives only in a document is a rule that sometimes does not
exist.

This README keeps the *reasoning* — why the gateway is treated as it is, what went wrong
before, the evidence. `openspec/specs/` keeps the *behaviour*, in terms a reviewer can check
against the running thing. `PLAN.md` keeps what is not built and the lessons carried forward.

## The gateway: what you need to know before changing the agent

`LLM_URL` speaks the **Anthropic Messages API shape**, but what answers is not Claude. The
rules below were established by measurement against a real deployment and are load-bearing.
Do not "simplify" them away.

Specifics of any one installation — which models sit behind it, how requests are routed, and
which of its backends misbehave — are deployment configuration, not documentation. They
belong in `.env` and in whatever your operator gives you, and deliberately are not written
down here.

**1. Auth is `Authorization: Bearer`.** `x-api-key` returns 401.

**2. A model name may be a group, not a model.** Two identical requests can be served by
different backends, so **capability varies between them**. Anything that must hold has to be
enforced in code, not asked for in a prompt. Some backends emit `thinking` blocks, which the
client strips.

**3. Some failures are transient and worth retrying.** A backend can reject a request that a
different backend would have accepted, including with a 400 that looks permanent. `gateway.ts`
therefore treats a configured set of 400 signatures as retryable, because retrying re-rolls
the routing. That is deliberate, not a bug — see the comment there before removing it.

**4. Truncation inside a tool call is a hard 400, not a partial response.** If the model runs
out of `max_tokens` mid-argument, the JSON cannot be parsed and the response carries nothing
usable — there is no half-written argument to salvage.

**This is why the agent splits every turn into two calls.** Chapter prose is generated as
*streamed text* inside a `<chapter key="…">` block and never appears in a tool argument;
tool calls carry only small metadata (a key, an enum, short questions). The difference was
measured: with long prose in the tool argument a minority of attempts failed outright, and
with small metadata only, none did.

**If you add a tool, keep its arguments small.** Anything long belongs in the text stream.

**5. `max_tokens` is working room for reasoning, not the size of the answer.** A model that
thinks before it writes takes that out of the same budget. Three separate features have
failed this way, each returning nothing while looking like a logic bug:

| Call | Too small | Works at |
|---|---|---|
| Suggesting answers to one question | 400 → no output | 2000 |
| Checking the document | — | 3000 |
| Deriving the diagram model | 4000 → **zero characters**, all reasoning | 12000 |

The tell is an output-token count landing exactly on the ceiling. When a call returns an
empty result, check that first — the code is usually fine.

**Do not assume Claude-specific parameters exist.** Prompt caching, `effort` and
`budget_tokens` are not available. Context windows vary by backend and cannot be relied on,
so the agent sends chapter summaries plus the active chapter rather than the whole document.

## The invariant: complete means nothing left to ask

The two calls of a turn are independent judgements, and they can disagree. The assessor
reads the chapter *text*, so it cannot see that the prose call ended by asking the user
something. Left alone it marks the chapter complete with the question still on screen —
and because each turn rebuilds the system prompt from stored state, the *next* turn reads
"finished, nothing open" and starts interviewing the user about a different chapter while
the index still shows the one they chose.

So `reconcileAssessment` in `llm/questions.ts` enforces, in code rather than in a prompt:

> A chapter is complete exactly when nothing is left to ask.

If the reply asked anything, the status is downgraded and the questions are kept — the
assessor's own wording when it supplied any, the extracted questions otherwise, so a
hanging question is never silently dropped. Detection keys on `?`, which is the question
mark in every language the agent writes in. `npm test` covers this against replies taken
verbatim from the transcript that produced the bug; **the tests must keep passing.**

Prompt rules alone were not enough here — the backend models drop instructions. Anything
that must hold, enforce deterministically and treat the prompt as the first layer only.
The scope rule ("every question you ask must be about this chapter") sits last in the
system prompt for the same reason: it is the rule most likely to be dropped, and its
failure is the most visible.

## Requirements: the checkable half of a chapter

Chapter prose says what the application is *for*. A **requirement** says what it must
always *do*, with at least one concrete scenario — that is the part someone can build
against and the part a later coherence pass can check for contradictions.

The agent raises them in the streamed reply, never in a tool argument:

```
<requirement scope="now">
The application must never allow two people to book the same car on the same day.
WHEN two employees try to reserve the same car for the same day
THEN only the first succeeds, and the second is told the car is taken
</requirement>
```

- **`WHEN`/`THEN` are storage, not vocabulary.** They are kept in the repository files
  because they are what makes a requirement testable, and hidden in the UI, which renders
  "If … then …". The user never meets the notation.
- **Refs are assigned by the server, never the model.** The agent omits `ref` to add a
  requirement and supplies one to change or remove it. A model that invents its own
  references collides with itself and silently renumbers, which would sever the
  traceability that change review and verification depend on. Refs are sequential per
  project (`REQ-007`) rather than per chapter, so renaming a chapter cannot break them.
- **`scope`** is `now`, `later`, or `out`. A recorded exclusion is worth as much as a
  requirement: it stops the same idea being proposed again three chapters later.
- Requirements are mirrored into `specman.manifest.json`, so a change can be reviewed as a
  requirement-level delta rather than a text diff.

`validateDocument` in `llm/validation.ts` runs on every load — deterministic, no model
call. It answers "is this well formed?" (missing scenarios, duplicate refs, a chapter
finished with questions open), never "is it right?". Judgement belongs to the verification
pass, which costs gateway calls.

## Splitting a chapter up

"What the application does" is the chapter that grows. Once it covers six capabilities it
is a wall of prose nobody can navigate, and the agent rewrites all of it to add a sentence.
So it proposes an arrangement, declaratively — the whole set of sub-chapters, in order:

```
<subchapters>
booking-a-car: Booking a car
my-bookings: Seeing and changing my bookings
blocking-cars: Blocking a car for servicing
</subchapters>
```

Declarative rather than incremental because a model issuing "add this, move that" gets the
order wrong, and because the whole plan can be checked before anything is written.
`reconcileSections` works out the difference, and the rule that matters is:

> **Reconciliation never destroys written work.** A sub-chapter the plan leaves out is kept
> and moved after the planned ones. Only one with nothing in it — no prose, no requirement,
> not even a conversation — can be removed.

The part before the colon is identity and must never change; the title after it may be
reworded freely. Sub-chapter `position` is relative to the parent, so a parent can move
without renumbering anything beneath it, and `arrangeChapters` produces reading order for
every consumer. A chapter that has been split is a **container**: its progress is its
children's, so counting both would count the same work twice — `countableChapters` is that
rule, and the chapter index derives it separately only because its progress bar has to move
as statuses stream in.

The guidance for splitting is added to the prompt **only for a chapter that can be split** —
see PLAN.md on the prompt budget.

### The split moves the prose with it

Splitting used to create the sub-chapters and nothing else. The agent was told to "split
first, then fill the parts in on later turns", which sounds reasonable and is not: a chapter
is split once it has grown large, which is to say once it is nearly finished, so there were
no later turns. The sections stayed empty permanently — opening one showed nothing and
called itself *not started*, while the parent showed all of it.

The prose already says where it goes. A chapter worth splitting is written as `## Booking a
car`, `## Blocking cars for servicing`, and those headings are what the agent named the
sections after. So `distributeContent` matches headings to section titles in code — no model
call, nothing rewritten, and the agent is now told the move happens for it.

Matching is on stemmed words rather than exact text, because the wording drifts as it names
things ("My bookings and cancellation" became "Seeing and cancelling my bookings"), and it is
**best-first across all pairings** rather than best-per-heading, so an exact match claims its
own section before a loose one can take it.

Two rules keep it safe:

- **Anything that cannot be placed confidently stays with the parent.** There is deliberately
  no fall back to matching by position: a heading filed under the wrong capability is a wrong
  document, whereas one left where it was is merely untidy.
- **Nothing is ever written over.** A section that already holds something is occupied, and a
  heading matching it stays put rather than being filed somewhere else instead.

A container's view shows its sections beneath it, so whatever stays behind is still read, and
a container with nothing left of its own says *"Written as 6 parts"* rather than *not written*.

Documents split by the earlier version are migrated on startup by `backfillSectionContent`,
on exactly the same terms. That is the third time a change to the data has needed a line
there — a new column, a new condition, and now a new arrangement. **Adding the capability
migrates nothing.**

## The diagram

`/projects/<id>/diagram` draws the application as three ArchiMate layers — business,
application, technology — with the capabilities from *What the application does* as the
application services. Hovering a box picks out what it connects to; clicking one opens the
chapter it came from.

The model is derived on request, in **two calls**: name the parts, then connect them. Asking
for both at once spent the whole output budget on reasoning and returned *zero characters* —
see the gateway note below. The layout is deterministic geometry in `llm/diagram.ts`, pure
and tested, rendered as plain SVG with no diagramming dependency.

The notation is ArchiMate's, not an approximation of it: layer colours, a concept icon in
each box's corner, rounded corners for behaviour and square for structure, a ball at the
source of an assignment, an open head on serving, dotted for access and dashed for flow.

Two deliberate choices:

- **A relation naming something undeclared is dropped, not invented into existence.** A
  diagram with a mystery box is worse than one missing a line, because the reader cannot
  tell which parts to trust.
- **The ArchiMate layer colours are the real ones.** Anyone who has seen an ArchiMate model
  reads the layers from the fill without being told; inventing a palette would cost that
  recognition for nothing.

### Routing: why the lines are where they are

Connectors were straight lines between two box centres, which is the shortest path and
therefore the one that runs *underneath* whatever lies in between. A relation you cannot
follow with your eye defeats the only purpose the picture has.

The router reserves two kinds of corridor and puts every segment in one of them:

| corridor | where | carries |
|---|---|---|
| channel | the horizontal gap above and below each row | horizontal runs |
| gutter | the vertical gap beside each column, full height | vertical runs |

Three route shapes: **sideways** between neighbours in a row, **hop** for one channel
between adjacent rows, and **detour** — two channels joined by a vertical run in a gutter —
for endpoints further apart. Wires leaving one side of a box are spread across it in the
order they are headed, corridors widen to fit however many wires they carry, and a long
route picks the nearest *quiet* gutter rather than the nearest one, because routes that all
pile into one corridor become a bundle nobody can follow.

Three consequences worth knowing:

- **Rows are left-aligned on one column grid.** Centring a short row would break the gutters
  into disconnected pieces and a vertical run could no longer be guaranteed box-free.
- **The picture grows to fit its own wiring.** Corridor size is derived from lane count, so
  clearance is structural rather than a constant that happens to be big enough.
- **Connectors are drawn after the boxes.** They only ever reach a border, so nothing is
  hidden, and an end decoration is no longer half-buried under the box it belongs to.
  `pointer-events` are off on them so a line lying against a border cannot swallow a click
  meant for the box.

`npm test` asserts it segment by segment: every segment is axis-aligned, none overlaps the
interior of any box, and every corner lies inside the drawing. That last check exists because
the first two passed while four routes ran along `x = 0`, outside every band — clear of the
boxes, as promised, and off the edge of the picture.

### Reading it, and taking it away

The diagram has zoom in and out, **Fit**, actual size, and full screen; it pans by dragging,
and a drag that ends on a box does not also open its chapter. Fit uses both dimensions —
fitting the width alone pushed the bottom layer out of sight, and a diagram of three layers
showing two is not fitted. A window resize re-fits a diagram that was left fitted and leaves
alone one the user zoomed deliberately.

**Download for Archi** serves an [ArchiMate Open Exchange
File](https://www.opengroup.org/open-group-archimate-model-exchange-file-format) from
`/projects/<id>/diagram/export` — the one format every ArchiMate tool reads, so the work
leaves here without being retyped. It carries the elements, the relationships, the layers as
the model tree, and a view with coordinates and bendpoints matching what is on screen.

The three bands are *not* exported as container nodes: nested nodes in that format carry
coordinates relative to their parent, which is a well-known source of import bugs, and a band
is decoration rather than containment. `llm/archimate.ts` is pure, so `npm test` checks the
concept mapping and the file's shape without a gateway or a browser.

## Handing it to a developer

The design document is written for the person who asked for the application: plain
language, no notation, decisions explained. That is the right audience for the interview
and the wrong one for construction. `buildSpecBundle` produces the other view, written into
the repository under `spec/` whenever changes are approved:

```
spec/
  AGENTS.md                    what this is, what to read first, the ground rules
  chapters/NNN-<key>.md        prose, then requirements grouped by scope
  chapters/NNN-SS-<key>.md     a section of the chapter above it
  decisions.md                 who chose what, and why
  out-of-scope.md              what must not be built
```

A section is numbered against its parent, not on its own position — numbering it on
its own put the sections of chapter three among chapters one and two. Files are written
and listed in reading order rather than sorted by name, because `020-01-booking-a-car`
sorts *before* `020-functionality` and that would put the parts of a chapter ahead of it.

Materialised into the project's own repository rather than offered as a download, so anyone
who clones it gets the current version and no new dependency is needed. `/projects/<id>/export`
shows the same content as one document for pasting into a chat.

`AGENTS.md` states the caveats up front — unanswered questions, structural problems, and
decisions the assistant made that were never confirmed — because a builder who does not know
those exist will guess, and a guess becomes a rebuild. It does **not** withhold the bundle
when problems exist: refusing to write files the user's own conversation produced would be
withholding their work. The caveats travel with it instead.

The pure part is `llm/export.ts`, so `npm test` checks the entire bundle without a
repository or a gateway — including that an excluded requirement never appears as work.

## Only asking what this application needs

A tool for five people in one office should not face the same compliance battery as
something holding personal data for the whole company. Asking anyway wastes the requester's
time and teaches them that most of the document is box-ticking — which is when people start
answering carelessly.

Four questions at creation (does it exist already, who can reach it, does it hold personal
data, does it touch money or safety or legally required records) produce a **profile**.
Each template chapter carries `applies_when`; any one condition holding is enough. A small
team tool with no personal data gets 9 of 12 chapters instead of all 12.

- **A chapter that does not apply is marked, never deleted**, with the reason recorded in
  plain language and written into its file. An auditor should see the judgement, and the
  index offers *"Open one if you think it does apply"* — the user can always overrule it.
- **Unanswered means the cautious answer.** A document that asks too much is a nuisance;
  one that quietly skips data classification for an application holding personal data is a
  problem. An unrecognised condition keeps the chapter for the same reason.
- Set-aside chapters are excluded from progress, from validation, from the verification
  pass, and from the assistant's context — which also buys back prompt budget.

**Company standards** (`/admin/standards`) hold answers that should not be re-interviewed
for every application. An active standard matching the profile is copied into a new project
as a requirement with `source='standard'`, and the assistant is told not to interview
anyone about it — only to speak up if what they describe would break one. In practice it
opens with *"Since this is the company standard, I'll take sign-in with the company account
as given"* and asks only about the exceptions.

> The seeded standards are **examples, not policy, and ship switched off.** Nobody has
> approved them. A standard that is on is copied into every application it applies to,
> where it reads as official — so a wrong one becomes a wrong line in every specification,
> silently. Someone who owns the real standards must review them first.

**Brownfield.** A project marked as changing something that already exists shifts the
assistant to establish how things work today before discussing changes, and requirements
describing existing behaviour are marked `existing="true"` so an export can say what not to
rebuild.

## Checking the document as a whole

Two things the per-turn flow structurally cannot do: it sees one chapter at a time, so it
cannot notice that two chapters contradict each other, and it judges what was just said,
so it cannot notice that something settled four chapters ago was never written down.

`verifyDocument` runs on request from the review page — one call per chapter plus a single
cross-document pass, **three at a time** (`mapWithLimit`). The whole document is never sent
in one request: context windows here vary by backend and are not published, so a document
that fits today may not fit tomorrow when the request routes elsewhere. The cross-chapter
call sends requirement *statements* only, which stays small whatever serves it.

It looks for four things: rules that contradict each other, decisions never written down,
parts that no longer match what the application is for, and anything too vague to build
from. Findings arrive as streamed `<finding>` blocks, not tool arguments.

**The findings are advisory and never block approval.** A model's opinion about a document
is not grounds for refusing to save the user's own work. Structural errors from
`validateDocument` are the ones that gate the export.

Results are stored and written to `VERIFICATION.md` on the working branch, so the check
travels with the change it describes. Re-reading a report should not cost what producing it
cost — a run over five chapters takes around 80 seconds.

## Decisions, and who made them

The agent is told that when the user says "you decide", it should propose a sensible
default and record it. That is right — a non-technical colleague should not have to hold
an opinion about session lengths — but it means part of the finished document was decided
by a machine, and nothing else in the document would show which parts.

So every decision carries its source:

```
<decision source="agent">
Sign-in uses the normal company account.
Why: everyone already has one, so there is no extra password to look after.
</decision>
```

- **Anything unclear becomes `agent`.** Mislabelling an assistant default as the user's
  own choice hides a machine's judgement inside their specification; the reverse merely
  asks them to confirm something they already said. Only an explicit `source="user"` counts
  as theirs, and those are confirmed on the spot.
- **A chapter resting on unconfirmed assumptions is not complete.** That status is
  *derived* (`effectiveStatus`), not stored: writing the downgrade into the database would
  leave it stale the moment the user confirms, until some later turn happened to reassess
  the chapter. The stored value stays the assessor's verdict.
- `decisions.md` in the repository records the same thing for anyone reading the pull
  request, marking what the assistant chose and what is still unconfirmed.

Changes are reviewed as **rules, not lines**: `requirementDelta` compares the manifest on
`main` with the current one and reports "3 added, 1 changed, 1 removed", naming the chapter
and saying what moved — wording, timing, or the example. Deterministic, no model call. The
text diff is still there behind a toggle for anyone who wants it.

## Who asks, who decides

The agent asks; the user decides. That line determines several things that look
like UI details but are not:

- **Open questions belong to the agent.** Clicking one posts to `/api/ask`, which adds an
  *assistant* turn asking it. Sending it as a user turn would have the user asking their
  own question and the agent answering on their behalf.
- **Answers may be offered, never imposed.** A reply can end with an `<options>` block —
  at most four, exactly one `[recommended]`, streamed as text like `<chapter>` and stored
  on the message so they survive a reload. The agent is told to offer none when the
  question is open-ended; an unhelpful list is worse than no list. Typing an answer is
  always available and always wins.
- **Chapters are opened deliberately.** An untouched chapter shows a *Start this chapter*
  button rather than expecting the user to know they must ask.

Each scope owns its conversation, including the whole-document one — that is what
`chapter_key IS NULL` means in `recentMessages`, not "every message in the project".
Selecting a chapter shows that chapter alone in the preview; the assembled document is
what *Whole document* is for.

## Conventions

- Chapter files are `docs/<position>-<key>.md`; `specman.manifest.json` mirrors status and
  open questions so the repository is self-describing.
- A chapter's own title is added by the document writer. `stripChapterHeading` removes a
  duplicate heading if the model writes one anyway — applied on save, on render, and on
  git write, so the invariant holds for content written before the rule existed.
- Editing a template does not change documents already in progress: chapters are snapshot
  into the project at creation, so a document keeps the questions it started with.
- Settings are read through `src/lib/server/env.ts`, not `$env/static/private`, so that
  server-side scripts work without booting SvelteKit.

## Not built yet

- **GitHub host.** `src/lib/server/git/repo.ts` is local-only. The seam for `createRepo` /
  `push` / `openPullRequest` is described in the plan; the UI already says "pull request"
  throughout so wording will not change.
- **Deleting a project.** There is no way to remove one from the UI, only from the database
  and `data/repos/`.
- **Importing an ArchiMate file back.** The export is one-way: a model edited in Archi cannot
  be brought back in, and the next *Draw again* would overwrite it in any case.
