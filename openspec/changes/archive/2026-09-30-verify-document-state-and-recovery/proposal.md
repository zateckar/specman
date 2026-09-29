# Verify document state and recover authorized approvals

## Why
Concurrent model calls can replace content or completeness using an obsolete document.
A crash between Git merge and SQLite proposal closure leaves an approved proposal open.
The remaining state invariants also need checked models and implementation regressions.

## What Changes
- Use a monotonic SQLite document revision and transactional compare-and-set for chat changes.
- Guard asynchronous completeness updates independently; preserve newer status on conflict.
- Persist approval intent before merging, recover its immutable revision before further repository writes.
- Bind verification results to their input revision and distinguish stale coverage.
- Add Lean models for optimistic updates, approval recovery, completion, coverage and identity linking.

## Impact
Guided interview, change review, document verification, storage and formal specifications.
Existing databases gain revision columns, triggers and an approval journal. Older verification
rows lack an input revision and are treated as stale. Recovery applies to journaled approvals;
it does not guess authorization for merges made before this journal existed.
