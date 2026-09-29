# Handing it to a developer

## Purpose

The design document is written for the person who asked for the application: plain language,
no notation, decisions explained. That is the right audience for the interview and the wrong
one for construction. The bundle is the other view of the same content, materialised into the
application's own repository so anyone who clones it gets the current version.

See `README.md`, *Handing it to a developer*.

## Source

- `src/lib/server/llm/export.ts`
- `src/routes/projects/[id]/export/+page.server.ts`
- `src/routes/projects/[id]/export/+page.svelte`

## Requirements

### Requirement: The bundle is written into the application's repository
Approving a change SHALL write the build-ready bundle under `spec/` on the main branch.

#### Scenario: A developer clones the repository
- **WHEN** they open `spec/`
- **THEN** they find the instructions for reading it, the chapters with their requirements,
  the decisions, and what must not be built

### Requirement: Files are written in reading order
Chapter files SHALL be written and listed in reading order rather than sorted by name, and a
section SHALL be numbered against its parent.

#### Scenario: A chapter with six sections
- **WHEN** the bundle is produced
- **THEN** the chapter is followed by its own sections, not by the sections of another
  chapter that happen to sort earlier

#### Scenario: Why numbering is relative
- **WHEN** a section is numbered on its own position instead
- **THEN** the sections of chapter three land among chapters one and two — which is the bug
  this rule exists to prevent

### Requirement: Caveats travel with the bundle
The bundle SHALL state unanswered questions, structural problems, and decisions the
assistant made that were never confirmed, at the top of its instructions.

#### Scenario: The document has gaps
- **WHEN** the bundle is written
- **THEN** it is written anyway, with the caveats stated, because a builder who does not know
  the gaps exist will guess — and a guess becomes a rebuild

### Requirement: Excluded work never appears as work
A requirement scoped out SHALL appear only as something not to build.

#### Scenario: A capability was ruled out
- **WHEN** the bundle is produced
- **THEN** it is listed as out of scope and nowhere else

### Requirement: The same content is available as one document
The export page SHALL offer the bundle as a single document for pasting into a chat.

#### Scenario: A user wants to hand it to a coding assistant
- **WHEN** they open the export page
- **THEN** they can copy the whole thing at once

### Requirement: The bundle is produced by a pure module
Assembling the bundle SHALL be free of imports so it can be checked without a repository or
a gateway.

#### Scenario: Running the tests
- **WHEN** `npm test` runs
- **THEN** the entire bundle is asserted, including that an excluded requirement never
  appears as work
