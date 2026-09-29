# Working on Specman

Read this before changing anything. It is short on purpose.

Specman's own documentation is kept in **OpenSpec format**: `specs/` is what the code does
today, `changes/` is what someone proposes it should do instead. The rule that makes this
worth having is:

> **No change is finished until the specification agrees with it.**
>
> `npm test` fails if it does not. That is not a style preference — it is a check, and it
> runs in the same command as the unit tests.

## The loop

**1. Propose.** Create `changes/<change-id>/` from `templates/`:

```
changes/add-github-host/
  proposal.md            why, what changes, what it affects
  tasks.md               the checklist, in the order it will be done
  design.md              only when the how is contentious (optional)
  specs/<capability>/spec.md    the delta — ADDED / MODIFIED / REMOVED requirements
```

The change id is kebab-case and names the outcome (`add-github-host`,
`stream-verification-run`), never the mechanism.

**2. Check it.** `npm run docs`. A change with no spec delta is rejected: if nothing about
the behaviour changed, this is a refactor and belongs in `specs/` review rather than as a
change.

**3. Build it**, ticking `tasks.md` as you go.

**4. Fold it in.** Apply the delta to `specs/<capability>/spec.md`, move the change folder
to `changes/archive/YYYY-MM-DD-<change-id>/`, and run `npm test`.

For a change small enough that a proposal would be ceremony — a one-line fix, a rename —
skip straight to step 4: edit `specs/` directly in the same commit as the code. The
requirement is that the specification is *correct afterwards*, not that everything goes
through a folder.

## The format

### `specs/<capability>/spec.md`

```markdown
# <Capability name>

## Purpose
Two or three sentences. Why this exists, and what would be lost without it.

## Source
- `src/lib/server/llm/example.ts`

## Requirements

### Requirement: Short name in the imperative
The system SHALL ... (or MUST — one sentence, testable, no implementation detail)

#### Scenario: What situation this is
- **WHEN** the thing happens
- **THEN** the observable result
```

Rules the check enforces:

- Every capability has a `## Purpose`, a `## Source` and a `## Requirements` section.
- Every requirement states `SHALL` or `MUST`, and has **at least one scenario**. A
  requirement with no scenario is an opinion — nobody can tell whether it holds.
- Every scenario has a `**WHEN**` and a `**THEN**`.
- No two requirements in one capability share a name.

### `## Source` — the part that makes it mandatory

`## Source` lists the files that implement the capability, and the check requires that
**every file under `src/` is claimed by exactly one capability**. That is what turns
documentation from a good intention into something the build enforces:

| you do this | the check says |
|---|---|
| add a module | nothing documents `src/…/new.ts` |
| rename or delete one | `src/…/old.ts` is listed by `…` but does not exist |
| move code between areas | the same file is claimed twice |

Scaffolding with no behaviour of its own (`src/app.d.ts`, `src/app.html`) is exempt; the
exempt list is in `scripts/check-docs.mjs` and is deliberately hard to grow.

### `changes/<id>/specs/<capability>/spec.md`

The delta, never the whole file. Only these headers:

```markdown
## ADDED Requirements
## MODIFIED Requirements
## REMOVED Requirements
## RENAMED Requirements
```

`ADDED` and `MODIFIED` carry the full requirement text with its scenarios — the reviewer
should not have to reconstruct it. `REMOVED` carries the name and one line saying why.

## What belongs where

- **`openspec/specs/`** — behaviour, and the reason for it. What the application does, in
  terms a reviewer can check against the running thing. The `## Purpose` says why the
  capability exists; each scenario's **THEN** says *because*.
- **`README.md`** — the front door. What Specman is, how to run it, where to read on. Brief
  on purpose: it points into `openspec/` and does not repeat it.
- **`PLAN.md`** — what is not built yet, and the lessons carried forward.
- **Code comments** — why this line, not what it does.

A requirement that explains itself at length is still wrong: state the rule in one sentence,
and put the evidence in the scenario that would fail without it. A scenario is a reason
somebody can check; a paragraph is a reason somebody has to believe.
