# Tasks

## 1. Specification

- [ ] 1.1 Write the delta under `specs/<capability>/spec.md`
- [ ] 1.2 `npm run docs` passes

## 2. Implementation

- [ ] 2.1 …
- [ ] 2.2 Pure logic goes in an import-free module so `npm test` can load it

## 3. Migration

- [ ] 3.1 Backfill existing databases, or record here that nothing stored changes
- [ ] 3.2 Make sure a document rewritten by the migration reaches its repository

## 4. Verification

- [ ] 4.1 `npm test` and `npm run check` clean
- [ ] 4.2 A live turn against the real gateway
- [ ] 4.3 A browser check of the affected pane
- [ ] 4.4 Fold the delta into `openspec/specs/` and archive this change
