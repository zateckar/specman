# Specman — improvement plan

Twelve changes drawn from [gsd-core](https://github.com/open-gsd/gsd-core) and
[OpenSpec](https://github.com/Fission-AI/OpenSpec), adapted for non-technical users.

Both projects diagnose the same thing: prose describing intent cannot be verified and
cannot be built from reliably. Both answer it with **requirements + scenarios + explicit
decisions + a verification step**. That is the through-line of this plan.

## Guardrails

These hold for every item below. They are the parts of both projects that must *not* be
copied.

- **No developer notation reaches the user.** Requirements are stored with `SHALL` and
  `WHEN/THEN` because that structure is what makes them testable; the UI renders them as
  plain sentences. The user talks, the agent writes — that split does not change.
- **No slash commands, no CLI as the primary surface.** Both source projects are developer
  tools. Specman is a web app for people who do not write code.
- **No rigid phase gates.** Users jump between chapters by design. Artefacts stay editable.
- **Long output rides the text stream, never a tool argument.** Every new structured
  artefact below is a streamed block parsed by `ChapterStreamParser`, for the reasons in
  `openspec/specs/llm-gateway/`. Tool arguments stay small.
- **Deterministic first, model second.** Anything that must hold is enforced in code, with
  the prompt as the first layer only. See `reconcileAssessment` for the pattern.

## Sequencing

Each stage ships something usable on its own.

| Stage | Items | Delivers |
|---|---|---|
| **A — Foundation** ✅ | 12, 1, 5, 7 | The document becomes structured and checkable |
| **B — Trust** ✅ | 3, 6 | The user can see what was decided for them, and what changed |
| **C — Assurance** ✅ | 11, 4 | The document is checked as a whole |
| **D — Organisation fit** ✅ | 9, 8, 10 | Fits how the company actually commissions software |
| **E — Handoff** ✅ | 2 | Something can be built from the result |

Item 1 is foundational — 2, 4, 5, 6 and 7 all key off it. Item 11 is infrastructure for 4.

**Stage A is built.** `requirements` table, the `<requirement>` block, server-assigned
refs, scope tiers, deterministic validation, and chapter goals. See the `requirements`,
`document-validation` and `guided-interview` specifications. Two things
learned in the building, both now covered by tests:

- A fixed character window for holding back a partial tag was not enough once opening tags
  carried attributes — `<requirement chapter="data-classification" scope="later">` is
  longer than any sensible window, and the raw tag printed into the chat. The parser now
  matches the *shape* of a possible tag instead.
- Removing a block leaves the newlines that surrounded it, and eight requirements in one
  reply left a visible hole. Blank-line runs are collapsed across chunk boundaries, which
  a per-chunk regex could not do.

**Stage B is built.** Decisions with provenance, derived chapter status, `decisions.md` in
the repository, and requirement-level change review. See the `decisions` and `change-review`
specifications. The finding worth carrying forward:

- **The system prompt has a budget, and it is now spent.** Adding the requirement and
  decision rules diluted the closing instructions enough that a turn came back having
  asked a new question without recording the answer it had just been given — 54 output
  tokens, no truncation, the model simply skipped the work. Restating the closing rules as
  an explicit output checklist fixed it, but the next stage cannot keep appending. Item 9
  (governance triage) helps here by removing chapters that do not apply; beyond that,
  prompt sections should be *replaced* rather than added, and anything that must hold needs
  a deterministic guard rather than another paragraph.

**Stage C is built.** `mapWithLimit`, the four-way verification pass, `VERIFICATION.md`, and
the check on the review page. See the `document-verification` specification.

On its first real run it found a genuine contradiction that had survived the entire
interview: one rule said a booking cannot be cancelled on the reserved day, another said
blocking a car automatically cancels bookings inside the blocked period — which can include
that same day. Two rules written in different turns, each sound alone. That is the class of
problem this exists for, and no per-chapter check can reach it.

Two things to watch:

- **The run is a single ~80-second request.** Fine locally; behind a corporate proxy with a
  shorter idle timeout it may not be. If that bites, stream progress per chapter rather than
  returning once at the end — the work is already split that way.
- **Findings are advisory by design.** Resist the temptation to let them gate approval: a
  model's opinion about a document is not grounds for refusing to save the user's own work.
  Structural errors from `validateDocument` are the gate.

**Stage D is built.** Governance triage, the standards store, and brownfield projects. See
the `project-setup` and `company-standards` specifications.

- **Standards ship switched off, and must stay that way.** They are examples, not policy.
  An active standard is copied into every application it applies to, where it reads as
  official — a wrong one becomes a wrong line in every specification, silently, and the
  people who own the real standards would be right to throw the document out. Seeding them
  active would have been the single most damaging shortcut available in this stage.
- **Adding a column populates nothing.** This bit twice now: `goal` in Stage A and
  `applies_when` here, where the triage silently kept every chapter and *looked* like it
  was working. Every new template column needs a line in `backfillGoals`.
- Triage buys back some of the prompt budget Stage B spent, since set-aside chapters leave
  the assistant's context entirely.

**Stage E is built — all twelve items are done.** `spec/` is written into the repository on
approval, and `/projects/<id>/export` offers the same as one document. See the
`developer-handoff` specification.

One deliberate departure from this plan: it said structural errors should *gate* the export.
They do not. They are stated at the top of `AGENTS.md` instead, because refusing to write
files the user's own conversation produced would be withholding their work — and a builder
who is told about the gaps is better served than one handed nothing. The gate that remains
is honesty: the caveats travel with the bundle and cannot be separated from it.

## Beyond the original twelve

**Sub-chapters, agent-arranged.** The agent proposes the whole arrangement declaratively and
`reconcileSections` works out the difference, never destroying written work. See the
`document-structure` specification.

**The layered diagram.** Three ArchiMate bands, capabilities as application services, drawn
from a model derived in two calls. See *The diagram*.

The lesson from this round, now a requirement in `llm-gateway`: **`max_tokens` is
working room for reasoning, not the size of the answer.** The diagram needed 12000 to emit a
few hundred bytes, and at 4000 returned zero characters while looking exactly like a parser
bug. Three features have now failed this way. The tell is an output-token count landing
exactly on the ceiling.

Also worth carrying: **decompose before raising the ceiling.** Splitting the derivation into
"name the parts" then "connect them" made the second call nearly mechanical, because it is
handed the list of names. Both changes were needed, but the split is what makes it reliable
rather than merely possible.

**A readable diagram, and one that leaves.** Orthogonal routing through reserved corridors,
proper ArchiMate notation, zoom / fit / full screen / drag-to-pan, and export as an ArchiMate
Open Exchange File. See the `architecture-diagram` specification.

The lesson from this round: **an invariant test proves what it says and nothing more.** "No
connector passes underneath a box" passed while four routes ran along `x = 0` — outside every
band, off the edge of the picture, and genuinely clear of every box. The check was correct;
the property it checked was not the whole property. Bounds are now asserted separately, and
the same question is worth asking of the other guards: what does this test *not* say?

**Splitting a chapter now moves its prose.** See the `document-structure` specification.

The lesson here is about instructions to the model that quietly never fire. The prompt said
"split first, then fill the parts in on later turns" — a sensible sequence that could not
happen, because a chapter is only ever split once it is nearly finished and there are no
later turns. Nothing errored; the sub-chapters were simply empty for good.

Worth carrying: **an instruction that depends on a future turn is a plan with no owner.** If
the work must happen, the server should do it at the moment the trigger occurs, not ask the
model to remember. The same test applies to anything else phrased as "later" in the prompt.

**Specman now has a specification of its own.** `openspec/` holds it in OpenSpec format:
`specs/` is what the code does today, one folder per capability, and `changes/` is what
someone proposes it should do instead. See `openspec/AGENTS.md`.

The reason it is worth the file count is the same reason `reconcileAssessment` exists.
Documentation that must be kept current by remembering is documentation that goes stale —
so `npm test` fails when it has. The check that does the work is coverage: every file under
`src/` is claimed by exactly one capability's `## Source` list, which means adding a module,
renaming one, or moving code between areas cannot be finished without saying what it is for.

Worth carrying: **a convention nobody can forget to follow is the only kind that survives.**
This plan has recorded three near-identical failures — a column added and never backfilled,
a condition added and never backfilled, an arrangement changed and never backfilled — each
one a rule that existed only in somebody's memory of it.

A second one, from the review of 2026-10-01: **a failure stored as a result is worse than no
result.** The same shape turned up four times. A diagram that failed to draw was saved as the
application's diagram. A discarded assumption was deleted with nothing asking what should
replace it. A
repository that could not be created left an application that failed on every turn. A boot
repair run on every start mistook new questions for the old defect and deleted them. In each
case the code took the path a success would have taken, with nothing in hand. Wherever work
can fail, ask what is *stored* when it does.

A third, from the review of 2026-10-02: **a sentence written for the usual case is untrue in
the others.** The turn said a change "will be recorded with the next one" when there was no
repository left to record it in. Approval said the outstanding changes "have been now" saved
when that commit had failed too. Including a chapter reported "could not be included" over a
chapter that was included and only not yet committed. Validation called a chapter finished
while the badge beside it said in progress, and the review page offered Approve for a
difference with nothing in it. Each message was right when it was written, for the case its
author had in mind. Whenever the code says something to the user, ask which branch it is on —
and say only what is true of that one.

A fourth, from the same review: **a guard that counts more than it protects fails the
innocent.** The document revision counted the assessor's verdict as a change, so a colleague
whose turn only asked a question back failed someone else's slower turn and threw away what
it had written. Optimistic concurrency is only as good as its idea of what a change is.

**A setting that is documented and read is not a feature.** `GEMINI_API_KEY` and
`GEMINI_MODEL` were in `.env.example`, described as the fallback, and read by `env.ts` —
and nothing called them. An installation with only Gemini configured failed every assistant
feature on `LLM_URL`. The documentation check proves every file is described; it cannot
prove a described setting is used. Grep for the getter, not the variable.

**Work given up has to leave the queue.** Deleting a draft stops its job and waits for it to
settle. Its chapters waiting for a drafting slot behind other people's long calls would have
held the deletion for minutes, only to return the moment they got one, so the wait timed out
and refused a deletion with nothing left to do. A queue that cannot be left makes "stop" mean
"stop eventually". (From drafting a whole document, 2026-10-03.)

**Slow and silent feel the same.** A turn streamed text for its whole length, and the user
saw an empty bubble for most of it, because the model writes the chapter first and the reply
last. Nothing was slow that had not been slow before; it was only invisible. Say what is
happening before making it happen faster.

## Where to go next

Nothing in this plan is outstanding. These are the gaps, and each is a candidate for the
first folder under `openspec/changes/`:

- **GitHub host** — the seam exists (`createRepo` / `push` / `openPullRequest`), the UI
  already says "pull request", and the user has signalled intent. Needs a token, a base URL
  (github.com or Enterprise), and a target organisation.
- **Streaming the verification run** if the ~80-second request proves too long behind a
  proxy.
- **Deleting a project someone has worked on** — still only possible from the database and
  `data/repos/`. Since 2026-10-03 an untouched AI draft can be deleted by its creator or an
  administrator (`whole-document-draft`); anything holding a person's work cannot, and
  deciding who may throw that away is the open question, not the mechanism.
- **Importing an ArchiMate file back.** The export is one-way: a model edited in Archi cannot
  be brought back in, and the next *Draw again* would overwrite it in any case.

### Known limits, written down so they are not rediscovered

- **One process only.** A repository is kept to one writer at a time by a promise chain in
  `llm/lock.ts`, which lives in memory. Running Specman behind two instances — a second
  container, a restart overlapping the old one — silently stops the ordering from holding.
  The branch assertion in `commitAll` detects some interference but cannot prevent every
  overlapping write. The ordering itself would need a lock both processes can
  see (a lock file, or a `git worktree` per writer). Treat "scale it out" as a change to
  `application-repository`, not a deployment detail.
- **Timeout cannot cancel a repository writer.** After 60 seconds the caller fails, but
  ownership remains until the underlying work settles. A permanently stuck writer blocks
  its repository until recovery or restart. Other repositories continue independently.
  The single-process protocol is proved in `formal/Lock.lean`; see `formal/README.md` for
  the implementation mapping and assumptions.
- **Formal coverage describes protocols, not the complete runtime.** Lean now checks
  ownership, reviewed approval, optimistic document writes, journaled recovery, assessed
  completion, verification coverage and identity linking. The TypeScript correspondence,
  SQLite/Git durability, provider authentication, child-process termination and multiple
  server processes remain assumptions or separate work; see `formal/README.md`.
- **Conflicting model replies are rejected rather than combined.** Project-wide revisions
  protect the context used to generate prose. User messages and reply text remain in the
  transcript; the caller reloads before retrying. A completeness verdict that becomes stale
  is skipped independently, preserving the already accepted prose and newer chapter status.
- **Pending approvals recover before more Git writes.** A durable journal records the
  authorized proposal and base. Recovery closes the proposal after checking Git evidence
  and rebuilds its bundle from the saved merge. Dirty files, an unresolved merge or unavailable
  storage can block the repository until an operator resolves them. Approvals predating this
  journal have no recoverable authorization record.
- **Proxy sign-in trusts a header.** `X-Forwarded-User` is a string the caller chose. It is
  safe only while the proxy overwrites it on every request *and* nothing else can reach the
  port. Neither can be verified from inside the application, and since 2026-10-02 neither is
  checked: leaving `PROXY_AUTH_ENABLED` on is the operator saying both hold, and rights
  granted on the People page apply through the header. `PROXY_AUTH_TRUSTED_IPS` was removed
  at the operator's request — kept beside the switch it said the same thing again, and while
  it was empty administrators lost their rights without a word. Confirmed by the operator on
  2026-09-29: the proxy overwrites, so the assumption holds for this deployment and for no
  other. See `openspec/changes/archive/2026-09-29-sign-in-through-the-reverse-proxy/proposal.md`.
- **A commit is attributed to one chapter and may carry another's work.** A repository has
  one working tree and `commitAll` stages all of it, so when two turns overlap, whichever
  commits first sweeps up whatever the other has already written. Observed with two
  colleagues answering at once: a commit headed "Update What the application does" also
  carried the other turn's operations prose. Nothing is lost — the ordering holds and both
  chapters are correct — but the history reads as though one turn did both. Per-path commits
  would not fix it: `README.md`, `specman.manifest.json` and `decisions.md` are rewritten
  whole by every turn, so any two overlapping turns contend for them whatever is staged.
  Fixing it properly means a working tree per writer, which is the same change as making the
  lock survive a second process. The drafter does not add to this: its chapters land in
  parallel, and written first and committed after, one commit named for one chapter carried
  eight — so it writes each chapter and commits it as one held section (`writeAndCommit`).
- **A draft is the assistant's only until someone touches it.** "AI draft" is derived from the
  document revision, so nothing has to clear it — and nothing can bring it back. After the
  first answer, confirmation or inclusion, the rules the draft invented read like any the
  assistant wrote in an interview; only its unconfirmed decisions still say "decided for you".
- **A draft runs in this process and is not resumed.** The job is in memory, like the lock and
  presence: a restart ends it, and the workspace then offers to draft the rest rather than
  starting again at boot, where a chapter that fails every time would fail on every restart.
  A second process neither sees a running draft nor refuses a turn beside it. At most three
  drafting calls run at once across the installation, queued in arrival order.
- **How an account signs in is recorded, not inferred.** `users.created_via` exists because
  the people page derived it from the password and company-account columns, and an account
  the gateway signs in has neither — so it reported everybody in a proxied installation as
  unable to sign in. Two of the three values are recoverable from a stored row and are
  backfilled; a gateway account is not, so it is recorded the next time that person arrives.
  An account that has not arrived since the column was added still reads as unknown.
- **Sign-in throttling is kept in memory.** Failed password attempts are counted per address
  and name in `llm/attempts.ts`, so a restart forgets them and a second process keeps its own
  count — the same one-process limit as the repository lock. They are keyed on the name as
  well as the address, because behind the company proxy many people share one address and one
  person's typos must not lock out the rest.
- **Every signed-in colleague can open every application.** By design — the documents are
  shared within the organisation, and `access-control` says so — but there is no per-
  application membership. If documents ever need to be private to a team, that is a new
  capability, not a setting.
- **Unsent answers live in the browser tab.** A draft survives switching chapters, not a
  reload or a second tab.
- **A session outranks the proxy.** Someone who signs in here with a password stays that
  account until they sign out, whoever the gateway says they are — that is what lets an
  administrator behind the proxy reach their own account. It also means a password session
  outlives the directory disabling the person the gateway knew; the password is its own
  credential, and the session its own fourteen days.
- **Gemini is asked only before anything was passed on.** A primary that fails part-way
  through a reply fails the turn, because the half already parsed cannot be unparsed; the next
  call goes to Gemini first. A primary that is merely slow, rather than silent, is waited for.
- **The chapter shown while it is written is not the chapter saved.** It is the raw block as it
  streams; the saved text is normalised — its heading tidied — and replaces it when the turn
  records it. A turn that fails puts the stored chapter back only when the page refreshes at
  its end.
- **Repositories are found again only under `data/repos/<slug>`.** The path is stored whole.
  A server started from another folder follows each repository to that place in its own
  folder at boot; one moved anywhere else needs `projects.repo_path` corrected by hand. A
  repository that is simply gone is refused rather than started again — restoring it is an
  operator's job, and the user is told so.
- **"You decide" is recognised by phrase.** A decision the model labels as the user's is
  treated as the assistant's when the user's message hands the choice back in English, Czech,
  Slovak or German phrases the code lists. Handed back in other words, the model's label is
  still believed.
- **The database can be ahead of the history.** A confirmed or discarded decision, or an
  included chapter, is kept when its commit fails, and reaches the repository with the next
  commit. Until then it is not in what anyone reviews, and the page says so; rolling the
  choice back instead would lose something the user did.
- **A heartbeat keeps a quiet turn open, not a long one.** The comment line every fifteen
  seconds stops a proxy closing an idle stream; a proxy with a ceiling on the whole request
  still ends a turn that outlasts it. The turn carries on server-side either way.

---

# Stage A — Foundation

## 12. A single-sentence goal per chapter *(S)*

**Why first:** trivial, touches the same files as item 1, and gives the index something
more useful than a status dot.

- `template_chapters` and `chapters` gain `goal TEXT` (via `ADDED_COLUMNS`).
- `default-template.ts`: a goal for each of the twelve seeded chapters.
- The agent may refine it; shown in `ChapterIndex.svelte` and the chapter header.
- Admin template editor gains the field.

GSD's phase-scoping test applies: if the goal cannot be stated in one sentence, the
chapter is doing too much.

## 1. Testable requirements inside each chapter *(L)*

The core change. A chapter stops being only prose and gains a set of numbered, checkable
requirements, each with at least one concrete scenario.

**Storage.** A new `requirements` table — structured rows in SQLite, serialised into the
chapter Markdown on git write. This mirrors the existing arrangement where git holds
content and SQLite holds everything else.

```
requirements
  id, project_id, chapter_key
  ref            -- REQ-BOOK-003, assigned by the server, stable for life
  statement      -- "The application SHALL never allow two bookings ..."
  plain          -- the same thing in the user's own words, for the UI
  scope          -- now | later | out          (item 5)
  scenarios      -- JSON: [{ when, then }, ...]
  source         -- user | agent | standard    (items 3, 8)
  position, created_at, updated_at
```

**Authoring.** A third streamed block type, alongside `<chapter>` and `<options>`:

```
<requirement chapter="functionality" scope="now">
The application must never allow two people to book the same car on the same day.
WHEN two employees try to reserve the same car for the same day
THEN only the first succeeds, and the second is told the car is taken
</requirement>
```

**IDs are assigned by the server, never by the model.** The agent omits `ref` to add one,
and supplies an existing `ref` to modify or remove it (`action="remove"`). Letting the
model number things invites collisions and silent renumbering, which would destroy the
traceability that items 4 and 6 depend on.

**Changes**

- `llm/blocks.ts` — extend the parser to a third block type. It already handles two; the
  shape generalises. Add tests for interleaved chapter/requirement/options blocks and for
  truncation inside a requirement.
- `llm/requirements.ts` (new, import-free) — parse a requirement block into a row, split
  WHEN/THEN scenarios, validate shape. Pure, therefore covered by `npm test`.
- `llm/agent.ts` — prompt rules: when to raise a requirement, one requirement per distinct
  rule, always at least one scenario, never restate the same rule twice.
- `api/chat/+server.ts` — upsert parsed requirements, emit a `requirement` SSE event.
- `git/repo.ts` — render requirements into the chapter file beneath the prose, and add
  them to `specman.manifest.json` (needed by item 6).
- `DocumentPreview.svelte` — render as *"What must always be true"* with scenarios shown
  as *"If … then …"*. No `SHALL`, no `WHEN`.

**Risks.** More structured output per turn means longer streams and more chance of
truncation mid-block — the parser already salvages unterminated blocks, and requirements
should be emitted a few per turn rather than all at once. Existing projects have prose-only
chapters, so a one-off backfill pass is needed (see *Migration* below).

## 5. Scope tiers *(S, once item 1 lands)*

`scope` on each requirement: **now / later / not doing**. The agent already invents a
*"Deliberately out of scope"* heading unprompted, which is the tell that this belongs in
the model rather than in prose.

- Agent asks which tier when a new capability appears, offering the tiers as answer
  options (the mechanism from the previous round of work).
- Index and preview group by tier; "not doing" is collapsed but never deleted, because a
  recorded exclusion is what stops it being re-litigated later.
- Export (item 2) carries the tiers so a build agent knows what is in scope.

## 7. Document validation *(S)*

Deterministic checks only — no model call, so it can run on every save.

- Every requirement has at least one scenario.
- Every requirement has a scope and belongs to a chapter that exists.
- No duplicate `ref`; no two requirements with identical statements.
- Nothing in `now` depends on something in `later` (once cross-references exist).
- Existing invariant kept: no chapter complete with open questions.

Lives in `llm/validation.ts` (import-free, tested), surfaced as a banner in the preview and
as a blocker on the export. Semantic checks — contradictions, coverage — are item 4's job,
not this one.

---

# Stage B — Trust

## 3. Decision log with provenance *(M)*

The most important item for this audience. The system prompt tells the agent that when the
user says *"you decide"*, it should propose a sensible default and record it as a decision.
That means part of the finished document was decided by a machine, and nothing currently
distinguishes those from the user's own choices.

```
decisions
  id, project_id, chapter_key
  statement      -- what was decided
  rationale      -- why, in one sentence
  source         -- user | agent | standard
  status         -- proposed | confirmed
  requirement_refs -- JSON: requirements this decision produced
  created_at, confirmed_at, confirmed_by
```

- New `<decision source="agent">` streamed block with a `Why:` line.
- **When source is ambiguous, default to `agent`.** The safe direction is the one that
  surfaces the decision for confirmation rather than silently attributing it to the user.
- New pane or tab listing decisions, agent-made ones first, each with a **Confirm** and a
  **Change this** action. "Change this" seeds a chat turn scoped to that decision.
- A document cannot be marked ready for build while agent decisions are unconfirmed.

This is a trust requirement, not a nicety: a non-technical user must be able to see which
parts of their specification they actually chose.

## 6. Semantic change review *(M)*

Replaces the raw prose diff on `/projects/[id]/review` with a requirement-level delta, in
the spirit of OpenSpec's ADDED / MODIFIED / REMOVED.

- Compute by comparing `specman.manifest.json` on `main` against the proposal branch —
  fully deterministic, no model call.
- Render: *"3 requirements added, 1 changed, 1 removed"*, each with before/after and the
  decision that caused it.
- Keep the prose diff available behind a toggle for anyone who wants it.

`git/repo.ts` already writes the manifest and `proposals.ts` already computes a diff, so
this is mostly presentation plus a manifest comparison function.

---

# Stage C — Assurance

## 11. Parallel per-chapter checks *(S)*

Infrastructure for item 4, and worth having on its own. Context windows on the gateway are
unknown and vary by backend, so a single whole-document call is fragile.

- A small concurrency-limited runner (cap ~3) issuing per-chapter calls.
- Reuses the existing retry and `isRetryable` logic in `gateway.ts` unchanged.
- Cross-chapter contradiction checking is done on requirement *statements only* — short
  text, so the combined pass stays well inside any plausible window.

## 4. Verification pass *(L)*

Already listed as unbuilt under *Where to go next*; both source projects independently confirm it
matters. GSD's verifier checks requirement coverage, decision coverage, and goal alignment.

Checks, per chapter in parallel then once across the document:

1. **Criteria coverage** — is each chapter's completeness criterion backed by a requirement?
2. **Decision coverage** — does every confirmed decision appear in the document? This is
   the check that catches the failure already seen in practice: the agent replying
   *"Noted — I'll record that"* and never writing it.
3. **Contradictions** — between requirements, across chapters.
4. **Goal alignment** — does the document still describe the application the overview says
   it is?

Output: findings in the UI, and `VERIFICATION.md` committed to the project repo so the
result is visible in the pull request. Findings are advisory, not blocking — except where
item 7's structural checks fail.

---

# Stage D — Organisation fit

## 9. Governance triage *(M)*

A five-person internal tool should not face the full compliance battery. A short intake at
project creation decides which fixed chapters apply.

- Three or four questions: who can reach it, does it hold personal data, does it touch
  money or safety, does it leave the company network.
- `template_chapters` gains `applies_when` (e.g. `always`, `personal_data`, `external`).
- Chapters that do not apply are marked as such rather than deleted, with the reason
  recorded — so an auditor can see the judgement, and so it can be revisited.

Do this before item 8: the triage answers decide which standards get inherited.

## 8. Organisation-level standards *(M)*

OpenSpec's "stores" idea, which fits a corporate deployment better than it fits them.
The company almost certainly has standard answers for security, data classification, licences and
telemetry. Interviewing every user from scratch on those wastes their time and produces
inconsistent documents.

```
standards / standard_requirements   -- org-level, admin-editable, mirrors the template UI
```

- On project creation, applicable standards are copied in as requirements with
  `source='standard'`, exactly as template chapters are snapshotted today.
- Inherited requirements render differently and are not re-interviewed.
- The agent asks only where the project **deviates**, and a deviation must carry a
  rationale — which lands in the decision log as `source='user'`.

## 10. Brownfield mode *(M)*

Both source projects support existing systems explicitly. Specman assumes greenfield; much
real work is *"we have this, we want to change it."*

- Project type at creation: **new** or **change to something that exists**.
- Brownfield adds a *"What exists today"* chapter and shifts the agent's questions toward
  the current state and the delta.
- Requirements gain the ability to be marked as describing existing behaviour rather than
  new behaviour, so the export tells a build agent what not to rebuild.

---

# Stage E — Handoff

## 2. Build-ready export *(M)*

Closes the loop the original brief opens with: *"a document from which a functional
application can be created."* Nothing currently consumes the output.

Materialise the spec **into the project's own git repository** on merge — no new
dependency, and a coding agent just clones the repo:

```
spec/
  AGENTS.md              -- how to read this, what to build first
  overview.md
  requirements/<chapter>.md   -- requirements + scenarios, grouped by scope
  decisions.md           -- what was decided, by whom, and why
  out-of-scope.md        -- explicitly not doing, so it is not "helpfully" added
```

Plus a **Copy for your coding assistant** action producing the same content as one file,
for pasting into a chat.

Blocked on items 1, 3 and 5 — the export is a serialisation of those, and is cheap once
they exist. A zip download can follow if anyone asks; it would need a new dependency.

---

# Cross-cutting work

## Migration

Existing projects hold prose-only chapters. A one-off backfill turn per chapter — *"read
this chapter and raise the requirements it already implies"* — with the results marked
`source='agent'` and `status='proposed'`, so every backfilled requirement is reviewed by a
human before it counts. Schema changes ride the existing `ADDED_COLUMNS` mechanism.

## Testing

The pure logic — requirement parsing, validation, manifest delta, scope rules — goes in
import-free modules and joins `npm test`, which is plain Node with no runner. The pattern
is established by `questions.ts` and `blocks.ts`.

Per stage: `npm test` and `npm run check` clean, then a live agent turn against the real
gateway, then a browser check of the affected pane. Every structured block type needs a
character-by-character streaming test — that is how the single-character options bug was
caught.

## Gateway impact

More structured output per turn is the main new pressure. Requirements and decisions are
emitted a few at a time rather than in bulk; the parser salvages unterminated blocks; and
`max_tokens` must stay generous, because the served model reasons before writing and
thinking tokens come from the same budget. The 400-token ceiling that silently produced no
options at all is the cautionary case.
