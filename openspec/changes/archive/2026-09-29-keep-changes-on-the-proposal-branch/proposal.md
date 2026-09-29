# Keep every change on its proposal branch

## Why

A repository has one working tree, and Specman writes to it from request handlers that
interleave. Recording a turn is four steps — check out the proposal branch, write the
chapter files, `git add .`, commit — and nothing holds the repository across them. Two
requests that overlap therefore share a working tree that each of them believes is theirs.

Two ways this goes wrong, both reachable with the application as it stands:

- **Two colleagues in the same application.** Both turns write `docs/`, and whichever
  reaches `git add .` second commits the other's half-written files alongside its own. The
  commit message names one turn's chapters; the commit contains two turns' work.

- **A turn racing an approval.** Approving checks out `main` before merging. A turn that
  checked out its proposal branch a moment earlier, and reaches `git add .` a moment later,
  commits its chapters **straight onto `main`** — the document changes without anyone
  approving it, which is the one thing the review step exists to prevent.

The second is the serious one, and it is quiet. The chat route catches a git failure and
tells the user "Changes saved, but could not be recorded in version control" — so the
failing variant reads like a transient blip, and the variant that succeeds on the wrong
branch says nothing at all. Nothing in the interface distinguishes a change that was
approved from one that landed on `main` by accident.

Worth saying plainly: this has not been observed in use. Specman is used by one person at a
time today, which is why it has not bitten. It is a property of the code rather than an
incident, and it is the kind that surfaces on the day the tool is given to a team.

## What Changes

- Writing to an application's repository becomes ordered: a second write waits for the first
  rather than joining it. One writer at a time, per repository.
- A commit states the branch it expects and refuses to run anywhere else, so a write that
  ends up on the wrong branch fails loudly instead of landing on `main`.
- Approval and a conversation turn can no longer overlap on the same repository.
- The user-facing message for a git failure stops implying the change was recorded when it
  was not.
- **Breaking:** none. No stored data changes shape; no existing repository needs rewriting.

## Impact

| | |
|---|---|
| Capabilities | `openspec/specs/application-repository/` — ordering and the branch assertion; `openspec/specs/change-review/` — approval cannot overlap a turn |
| Migration | none — this constrains when writes happen, not what is written |
| Gateway | none |

Nothing stored changes shape, so there is no backfill. A repository left on the wrong branch
by the existing behaviour is not detected or repaired by this change; `checkoutBranch` already
puts it right on the next turn, and the assertion means the next commit cannot compound it.
