# Boundaries

Document revision is project-wide: the model sees other chapters as context, so accepting
disjoint writes based on an older project is unsafe. SQLite triggers cover chapter,
requirement, decision and project metadata mutations. A synchronous transaction checks the
captured revision, reserves a newer revision, applies the whole reply, and buffers UI events
until commit. Completeness is a separate asynchronous computation with its own revision guard.
Transcript rows are retained even when a reply's document mutations conflict.

An approval journal holds the proposal ID, reviewed head, reviewed base and durable phase.
Preparation precedes Git merge. Recovery can repeat a merge only if main still equals the
authorized base, or recognize the reviewed head and base already in main ancestry. Proposal
closure and the merged journal phase share a SQLite transaction. The bundle uses the saved
merge revision. Completion follows the bundle commit; recovery repeats this deterministically.
Unexpected dirty files block recovery. Only generated spec files on main may be replaced
while resuming the merged phase. No repository writer bypasses pending recovery.

Models abstract Git atomic reference updates, SQLite transaction durability, stable commit
identifiers and one writer process. They do not prove OS or database durability, Git merge
content correctness, scheduler fairness, or cross-process repository ownership.
