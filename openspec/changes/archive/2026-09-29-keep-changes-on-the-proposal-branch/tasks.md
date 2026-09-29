# Tasks

## 1. Specification

- [x] 1.1 Write the delta under `specs/application-repository/spec.md` and
      `specs/change-review/spec.md`
- [x] 1.2 `npm run docs` passes

## 2. Implementation

- [x] 2.1 An import-free promise chain per key in `src/lib/server/llm/lock.ts`, with a
      timeout so a hung git process fails its turn rather than blocking every later one on
      that application. Named `createLocks` rather than `withLock`: it is a factory, so a
      test can make its own with a short timeout instead of sharing the module's.
- [x] 2.2 Repository **writes** in `src/lib/server/git/repo.ts` go through `withRepo`, keyed
      on the repository path.
      **Deviation from the task as written** — "every repository operation" became "every
      write". `diffAgainstMain`, `log` and `manifestOnMain` read committed history rather
      than the working tree, so they are consistent whatever a writer is doing, and putting
      page loads behind the write queue would make reading an application wait on somebody
      else's conversation.
- [x] 2.3 `commitAll` takes the branch it expects and throws `WrongBranch` if `HEAD` is
      anywhere else. Checked before the working tree is, so "nothing to commit" and "this is
      not the branch you think" cannot look the same to the caller.
- [x] 2.4 `commitDocument` and `writeVerification` hold the lock across checkout → write →
      commit and pass the proposal branch; `approveProposal` passes `main`
- [x] 2.5 `approveProposal` takes the same lock for the whole merge
- [x] 2.6 The chat route no longer says "Changes saved, but could not be recorded in version
      control".
      **Correction to this proposal** — it specified telling the user to repeat the turn.
      That is wrong: `writeDocument` writes the whole document out of the database every
      time, so a failed commit is carried by the next one, and repeating a turn that is
      already stored would duplicate it. The message now says the change is not yet in the
      application's history and will be included with the next one. The spec delta was
      corrected to match before being folded in.

## 3. Migration

- [x] 3.1 Nothing stored changes shape — no backfill is needed
- [x] 3.2 No document is rewritten, so nothing has to reach a repository

## 4. Verification

- [x] 4.1 `npm test` and `npm run check` clean
- [x] 4.2 Invariant test — **now whole.** Ordering was already covered: two overlapping
      writes to one repository do not interleave, two repositories do not wait on each other,
      a failing holder releases, and a hung one times out. The other half, *a commit on the
      wrong branch throws rather than committing*, is covered by `scripts/test-repo.mjs`,
      which drives the real `repo.ts` against a real temporary repository — so it also shows
      that nothing is committed, that the working tree is left alone, and that an unchanged
      tree on the wrong branch fails rather than reporting nothing to do. It needs a
      `.ts`-resolving hook (`scripts/ts-resolve.mjs`) because `repo.ts` has imports and
      everything else here is import-free.
- [x] 4.3 Two browser sessions in the same application, sending a turn each at once — both
      commits land on the proposal branch, `main` is untouched.
      Done as two signed-in colleagues, each behind their own header-injecting proxy, both
      answering at once. Two commits one second apart on `spec/0001`, clean working tree,
      clean `git fsck`, both chapters' prose intact, `main` untouched.
      **Observed, and left as it is:** whichever turn commits first sweeps up whatever the
      other has already written to the working tree, so a commit headed "Update What the
      application does" also carried the other turn's operations prose. Nothing is lost and
      the document is correct; only the attribution in the message is. One working tree and
      `commit -A` is what makes this so, and per-path commits would not fix it either — the
      README, the manifest and `decisions.md` are rewritten whole by every turn. Recorded in
      `PLAN.md` rather than redesigned here.
- [x] 4.4 A turn sent while an approval is in flight — the approval merges, the turn commits
      to the new proposal, and nothing reaches `main` unreviewed.
      Done live: approval merged `spec/0001` into `main` and opened `spec/0002`; the racing
      turn then committed to `spec/0002` twenty-nine seconds later. The branch assertion
      never had to fire, which is the point — the turn waited on the lock, and re-derived the
      working proposal inside it.
- [x] 4.5 A live turn against the real gateway, to confirm the lock does not change turn
      latency for the ordinary single-user case. Six live turns through the real gateway;
      uncontended turns were indistinguishable from before the lock, and the two contended
      ones were serialised by a second.
- [x] 4.6 Single-process limitation noted in `PLAN.md`, along with the released-not-stopped
      behaviour of a timed-out holder
- [x] 4.7 Delta folded into `openspec/specs/` and this change archived
