# Requirements

## Purpose

Chapter prose says what the application is *for*. A requirement says what it must always
*do*, with at least one concrete scenario — that is the part someone can build against and
the part a later coherence pass can check for contradictions. Requirements are stored in
`SHALL` and `WHEN`/`THEN` form because that structure is what makes them testable, and shown
as plain sentences because the user never meets the notation.

## Source

- `src/lib/server/llm/requirements.ts`

## Requirements

### Requirement: References are assigned by the server
A requirement's reference SHALL be allocated by the server and SHALL be stable for the life
of the application. The assistant SHALL NOT invent one.

#### Scenario: A new requirement is raised
- **WHEN** the assistant emits a requirement with no reference
- **THEN** the server allocates the next reference for that application

#### Scenario: An existing requirement is changed
- **WHEN** the assistant supplies a reference that exists
- **THEN** that requirement is updated rather than a second one being created

#### Scenario: A requirement is restated while another chapter is open
- **WHEN** the assistant restates a requirement by reference without naming a chapter
- **THEN** it stays in the chapter it belongs to, because restating changes its wording and
  scope, not where it lives

### Requirement: Company standards are not deleted in conversation
A requirement inherited from a company standard SHALL NOT be removed by the assistant.

#### Scenario: The assistant asks to remove a standard
- **WHEN** a reply removes a requirement whose source is a company standard
- **THEN** it is kept, because the rule is the organisation's and not the conversation's to
  delete; an application that really must differ restates it as out of scope, which stays
  visible in review

#### Scenario: A chapter is renamed
- **WHEN** a chapter's key or title changes
- **THEN** references are unaffected, because they are sequential per application rather
  than per chapter

### Requirement: Every requirement carries at least one scenario
A requirement SHALL have at least one scenario stating a situation and its observable
outcome.

#### Scenario: A rule with no example
- **WHEN** a requirement arrives without a scenario
- **THEN** the document is reported as not well formed, because nobody can check a rule
  nobody can run

### Requirement: Scope is recorded, including exclusions
Every requirement SHALL carry a scope of now, later, or out.

#### Scenario: Something is deliberately excluded
- **WHEN** the user rules a capability out
- **THEN** it is recorded with scope out rather than dropped, so it stops being proposed
  again three chapters later

#### Scenario: Building from the document
- **WHEN** the developer bundle is produced
- **THEN** an excluded requirement never appears as work

### Requirement: Existing behaviour is distinguishable from new work
A requirement SHALL be markable as describing how things already work, and the mark SHALL
be settable on a requirement that has already been recorded.

#### Scenario: An application that changes something that exists
- **WHEN** a requirement describes current behaviour
- **THEN** the export can say what not to rebuild

#### Scenario: A recorded requirement turns out to describe what already happens
- **WHEN** the assistant re-states it by reference, marked as existing behaviour
- **THEN** the mark is stored, because re-stating by reference is the only way to set it on
  a rule that is already recorded

#### Scenario: The same requirement is re-stated without the mark
- **WHEN** it is re-stated by reference and not marked
- **THEN** it is no longer marked as existing behaviour, on the same terms as its scope

### Requirement: Notation is stored, never shown
The user interface SHALL render a requirement and its scenarios as plain sentences.

#### Scenario: A requirement is displayed
- **WHEN** the preview renders it
- **THEN** the scenario reads as "If … then …", with no `SHALL` and no `WHEN`/`THEN`

### Requirement: Requirements are raised in the text stream
A requirement SHALL be emitted as a streamed block, never as a tool argument.

#### Scenario: Eight requirements in one reply
- **WHEN** the reply carries several requirements
- **THEN** each is parsed from the stream, and the reply the user reads contains none of
  the markup
