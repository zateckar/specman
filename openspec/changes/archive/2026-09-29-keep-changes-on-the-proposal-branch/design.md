# Design — keep every change on its proposal branch

## The question

How does a repository get one writer at a time, given that a working tree is shared mutable
state and every writer reaches it through an `async` request handler?

## Options

### A — A promise chain per repository path

A module-level `Map<string, Promise<unknown>>`. Every repository operation appends itself to
the chain for its path and awaits the previous link.

Cheap, no dependency, and it is the same shape as the existing `db()` singleton. It holds
only within one process: `adapter-node` runs a single process today, so this is sufficient
now and silently insufficient the day the application is run behind two instances. That is
worth writing down rather than discovering.

Costs: a slow git operation delays the next turn on the *same* application. That is the
intended behaviour — they were corrupting each other before — but it means a hung git
process blocks that application rather than failing it, so the lock needs a timeout.

### B — A lock file in the repository

`.git/specman.lock`, taken and released around each operation. Survives across processes, so
it still holds if the application is ever run behind more than one instance.

Costs: a crash leaves a stale lock, which needs an age-based override, which is a second
rule with its own failure mode. It also puts a file inside `.git/` that git does not know
about.

### C — Give each writer its own working tree

`git worktree` per concurrent operation, so there is nothing to share.

Genuinely removes the problem rather than scheduling around it, and costs a directory per
in-flight turn plus cleanup for the ones a crash leaves behind. The right answer if
Specman ever writes to a repository from more than one process; too much machinery for a
single-process application whose contention is two colleagues in the same document.

## Decision

**A, with the branch assertion from the proposal.**

The standing rule that decides it is *deterministic first, model second* — read as: anything
that must hold is enforced in code rather than hoped for. But ordering alone only makes the
race unlikely-to-impossible in one process; it does not make a wrong-branch commit
*detectable*. So the ordering is the fix and the assertion is the proof: `commitAll` is told
which branch it is expected to be on, and refuses rather than committing anywhere else.

That pairing matters. If option A is later replaced by B or C, the assertion is what says
whether the replacement works, and it keeps its value if Specman is ever run behind two
instances — where the in-process chain quietly stops holding but the assertion still fires.

The single-process limitation goes in `PLAN.md` under what is not built, so that "run two
instances" is known to be a change to this capability rather than a deployment detail.

## What this test does not say

The invariant test will say: **two overlapping writes to one repository do not interleave,
and a commit runs only on the branch its caller named.**

It does not say that the repository is correct afterwards. A turn that is made to wait still
writes the document as it stands when its turn comes, so two colleagues editing the same
chapter still have a last-writer-wins document — ordered, committed to the right branch, and
with one person's sentence gone. That is a separate problem about concurrent editing, and
this change does not touch it.

It also says nothing about more than one process. The test runs in one, which is exactly the
condition under which option A works.
