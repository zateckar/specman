# Changes

One folder per proposed change, copied from `../templates/`:

```
<change-id>/
  proposal.md                   why, what changes, what it affects   (required)
  tasks.md                      the checklist, in order              (required)
  design.md                     only when the how is contentious     (optional)
  specs/<capability>/spec.md    the delta                            (required)
```

The change id is kebab-case and names the outcome, not the mechanism:
`add-github-host`, not `wire-up-simple-git-remote`.

`npm run docs` checks the shape of everything in here. A change with no spec delta is
rejected — if nothing about the behaviour changes, it is a refactor, and a refactor does
not need a proposal.

When the work is done, fold the delta into `../specs/` and move the folder to
`archive/YYYY-MM-DD-<change-id>/`. Archived changes are not checked, so they stay as they
were written.

## What is not in here

Everything built so far. Specman's twelve planned items and the work beyond them were
built before this folder existed, and they are recorded in `PLAN.md` with the lessons each
one produced. `../specs/` is the result of all of it; `PLAN.md` is its history.

The three things known to be unbuilt — a GitHub host, streaming the verification run, and
deleting an application — are candidates for the first proposals here.
