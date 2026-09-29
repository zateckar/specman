# <Change title>

## Why

What is wrong, missing, or newly required. One or two paragraphs. If this is fixing
something that reached a user, say what they saw.

## What Changes

- The behaviour that changes, stated as an outcome
- Anything removed, and what happens to work that depends on it
- **Breaking:** call it out here if an existing document, repository or database is affected

## Impact

| | |
|---|---|
| Capabilities | `openspec/specs/<capability>/` — one line per capability touched |
| Migration | what an existing database or repository needs, or *none* |
| Gateway | extra calls per turn, or *none* |

Adding a capability migrates nothing: if this change alters what stored data should look
like, say here what brings existing applications into line, and add it to `tasks.md`.
