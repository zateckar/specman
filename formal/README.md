# Checked protocol models

`npm run verify` checks 38 theorems across seven models with Lean 4.34.1 and bundled `Std`.
No Lake packages are needed. The toolchain is pinned in `lean-toolchain`; CI installs it
through [elan](https://github.com/leanprover/elan/blob/master/README.md) and runs the proof
check before permitting an image build. Locally select the pinned version with elan, or
set `LEAN` to the full path of a Lean 4.34.1 executable. Run the command from the repo root.
The runner checks the actual compiler version and never installs anything locally.

The runner treats warnings as errors and audits the dependencies printed for every
required theorem. Only `propext`, `Classical.choice` and `Quot.sound`, Lean's standard
logical axioms, are accepted. Incomplete proofs and additional axioms fail the check.
Four negative tests in `scripts/test-formal.mjs` confirm rejection of incomplete proofs,
custom axiom dependencies, missing theorem audits and a mismatched compiler version.

## What is proved

| Model | Property | Evidence of the original bug |
|---|---|---|
| `Lock.lean` | For any repository key, reachable states have at most one active writer, even after caller timeout. | `old_timeout_allows_overlap` proves the old protocol reaches two active writers after start → timeout → start. |
| `Approval.lean` | Every accepted pair of reviewed and consumed revision tokens is equal. Changed proposal, proposal head or main base cannot satisfy the approval guard. | `old_approval_can_merge_unreviewed` proves that editing the head before unguarded approval records mismatched revisions. |
| `OptimisticUpdate.lean` | Accepted writes use the current revision, revisions never decrease, and a winning snapshot cannot win again after any number of later transitions. | `old_write_can_accept_a_stale_snapshot` constructs two accepted writes based on the same snapshot in the unguarded protocol. |
| `Recovery.lean` | Proposal closure requires evidence for its durable authorization. Successful forward recovery follows legal protocol steps, completes, consumes the authorized token and is idempotent. | `merge_can_outlive_its_database_marker` exhibits the cut point requiring recovery. |
| `Completion.lean` | An assessed chapter displays complete exactly when the reconciled verdict is complete and no recognized questions or pending assumptions remain. | Pending assumptions and recognized questions independently block completion; confirmation restores the stored verdict. |
| `Coverage.lean` | Per-chapter outcomes partition attempted checks. Failed, obsolete or unknown coverage cannot justify a clean summary. | Covers partial outages, cross-check failure and reports predating input revisions. |
| `Identity.lean` | An unfamiliar identity colliding with a username is rejected; fresh identities get ordinary accounts; existing links are preserved. | A username cannot cause a new subject to resume another account. |

These are inductive proofs over arbitrary finite execution traces, rather than a bounded
search through a fixed number of events. Commit hashes and proposal IDs are abstract
atoms represented by natural numbers; proofs use equality only. The approval history
retains every accepted pair, so subsequent edits cannot erase a bad approval from the claim.

## Mapping to the application

| Modeled operation | Implementation | Application regression |
|---|---|---|
| Lock `start` | `createLocks.run` installs its queue entry synchronously, awaits the previous tail, then starts work. | Two same-key callers run in order; different keys can run together. |
| Lock `timeout` | `withTimeout` rejects the caller without invoking the queue release callback. | A timed-out writer retains ownership and its successor has not started. |
| Lock `settle` | The fulfillment/rejection handlers on `completion` release ownership. | The successor starts after gate release, maximum active writers stays one, late rejection and synchronous throws release safely. |
| Approval `edit`, `base`, `replace` | A proposal commit, main commit or newly opened proposal changes a token field. | Each makes an old form fail with HTTP 409. |
| Approval guard | `approveProposal` compares the open proposal ID and both commit hashes after acquiring `withRepo`. | A writer advances the branch while approval waits; queued approval rejects it. |
| Approval consumption | `mergeToMain` receives the validated immutable proposal hash. | A fresh form approves; the main snapshot and generated bundle contain the committed prose and metadata, despite newer SQLite answers. |
| Review token | `reviewRevision` resolves commits; prose diff and both requirement manifests use those hashes. Hidden form fields carry all three token fields. | Review ignores live requirements; rendered form carries its hash; stale conflict text is visible. |
| Optimistic `external` | SQLite triggers advance `projects.document_revision` on chapter, requirement, decision and project-context writes, including section planning. | Chapter writes, rule insertion/deletion, decision confirmation/deletion and metadata changes invalidate snapshots. |
| Optimistic `accept` | `withDocumentRevision` reserves a newer revision using a conditional update, then applies all reply mutations synchronously in one transaction. | A delayed concurrent reply creates no chapters, rules, decisions, sections or mutation events. |
| Optimistic rollback | A failed mutation rolls back its changes and revision increments; SSE mutation events are buffered until commit. Transcript rows remain outside this transaction. | Injected failure restores prose, requirements, decisions and revision. |
| Assessment acceptance | The assessor captures a fresh revision after initial reply application and compares it again before applying its verdict. | An intervening edit preserves its newer questions and status. |
| Recovery `authorize` | `approveProposal` stores the proposal ID, proposal hash and reviewed base in `approval_intents` before calling Git. | Fresh SQLite connections can see the journal at each simulated crash cut point. |
| Recovery `merge` / evidence | Recovery merges the saved hash only from the saved main base, or recognizes that both reviewed revisions are already ancestors of main. | Before-merge and after-merge recovery consume committed content despite newer SQLite answers; a moved base blocks recovery. |
| Recovery `record` | Proposal closure and journal phase/merge hash are committed in one SQLite transaction. | An aborting trigger rolls back both markers while the actual Git merge remains recoverable. |
| Recovery `bundle` | The saved merge hash supplies bundle inputs. Only generated spec files on main may be overwritten; completion follows the bundle commit. | Interrupted bundle output is rebuilt; replay after a committed bundle creates no extra commit or merge. |
| Recovery guard block | Dirty files outside the bundle, unresolved Git work or unexpected main changes stop forward progress. Startup and every repository writer attempt recovery. | Dirty work is preserved, an unavailable index blocks writers, and a blocked decision does not falsely report being saved. |
| Completion functions | `reconcileAssessment` preserves recognized questions; `effectiveStatus` derives a downgrade for unconfirmed assumptions. A question naming another chapter is navigation and is not recognized, and an in-progress verdict whose only questions were navigation enters the model as `raw = complete`. | Existing agent tests cover questions, assessor failure, pending assumptions, final confirmation and invitations to move on. |
| Coverage functions | `verifyDocument` classifies each attempted chapter once and records cross-check failure separately. Only in-scope requirements and assumptions affect checking. | Partial/total outage tests retain successes; excluded rules do not trigger a cross-check. |
| Coverage input | `saveVerification` uses a conditional INSERT against its captured revision; `latestVerification` computes staleness from the current project revision. | Delayed checks return 409, earlier reports remain stored, and obsolete reports cannot look clean on review load. |
| Identity resolution | `completeLogin` first resolves issuer+subject; a username collision fails; registration and linking share a SQLite transaction and unique identity constraint. | Registration failure leaves no orphan account, concurrent sign-ins return one ordinary account, and duplicate links cannot replace its owner. |

The model abstracts validation and merge as one transition because they share a repository
lock. The implementation instead performs several awaits; ownership must exclude writers
throughout them. Hashes captured during concurrent work can already be stale on page load,
but immutable reads stay coherent with the submitted token and approval rechecks both refs.
Tests live in `scripts/test-agent.mjs` and `scripts/test-server.mjs`.

Reply application and completeness assessment are separate guarded operations. A turn's
prose may be accepted while its later assessment becomes stale; the newer verdict is kept
and the caller is told. Conflicting reply text and the user's message remain in the transcript;
there is no automatic retry. Project-wide conflicts are deliberately conservative because
the model sees other chapters as context. Different projects have independent revisions.

Recovery models one journal entry. Its token abstracts proposal identity plus both reviewed
commits. Every merge, marker transaction and bundle completion is a separate durable step;
crashes can occur between them without undoing preceding steps. `recover false` describes
the result when the authorized forward operations succeed; it does not guarantee that Git
or storage will be available. `recover true` models an immediate block at the current durable
cut point, not rollback of work completed earlier in the call. The application may make
progress before a later failure. Bundle failure retains approval, leaves recovery pending,
and blocks subsequent repository writers until recovery succeeds.

## Assumptions and limits

- One server process owns a repository. Every writer uses the same canonical repository key
  and lock. External Git commands or another server process can invalidate this assumption.
- A work promise settles only after all writes it started have stopped. Detached work or
  orphaned child processes violate the mapping to `settle`.
- Git commit identifiers are immutable and uniquely identify commit content. The model
  verifies which token is consumed; it does not formalize Git merge algorithms or content.
- The submitted token identifies the page supplied to the normal client. It does not attest
  that a human read the page, nor prevent an authorized client from constructing a token.
- The proof checks models, not TypeScript semantics. The correspondence table and real
  application tests support the mapping; there is no machine-checked refinement proof.
- Safety holds even for a permanently stuck writer. Eventual progress requires settlement
  and scheduler fairness; neither termination nor liveness is proved here.
- SQLite transactions and Git reference updates are assumed atomic and durable. Recovery
  proves the protocol over these primitives, not their implementation or storage hardware.
  Tests reconstruct durable cut points and read them through fresh SQLite connections;
  they do not kill processes during filesystem writes. Partial Git merges, unexpected dirty
  files, stale index locks and unavailable storage may require operator intervention.
- Recovery covers journaled approvals. It cannot infer who authorized an older merge made
  before the journal existed. A completed journal remains as evidence; a new proposal gets
  a different ID and cannot reuse the old approval.
- Database guards enforce strictly increasing revisions within JavaScript's safe integer
  range and reject overflow without saving unversioned mutations. SQLite transactions are
  assumed to execute these guards atomically. Administrative edits that remove triggers or
  alter journal records invalidate the mapping.
- Completion proofs use the questions recognized by the deterministic parser and the
  assessor's verdict. They do not prove semantic completeness or recognize every possible
  natural-language question. Coverage partitions attempted per-chapter outcomes, not every
  empty/excluded chapter or every possible defect a model could miss.
- Identity proofs assume the OIDC library authenticates issuer+subject and SQLite allocates
  fresh user IDs and enforces identity uniqueness. They do not verify token cryptography,
  the identity provider, proxy headers, authorization policy or session lifecycle.
- Pending decisions and verification shown on the page still come from SQLite. Only the
  prose diff, requirement delta and approval/export revision are pinned to Git. Verification
  freshness is computed for server responses and review loads; open browsers do not receive
  automatic invalidation when another user edits the document.

## Next verification targets

The five earlier targets now have models and application mappings. The remaining work is
machine-checked refinement from the TypeScript implementation, shared repository ownership
across processes, OS/database durability and partial Git-merge recovery, and conditional
liveness under retries and scheduler fairness. Semantic correctness of model-generated
requirements and identity-provider authentication also remain outside these proofs.
