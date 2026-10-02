## ADDED Requirements

### Requirement: The preview shows what is set aside as set aside
The document pane SHALL mark a chapter that does not apply, with the reason, and the
whole-document view SHALL leave it out.

#### Scenario: Opening a set-aside chapter
- **WHEN** the user selects it
- **THEN** it is labelled as not needed and says why, rather than reading as a chapter nobody
  has started

#### Scenario: Reading the whole document
- **WHEN** the whole document is shown
- **THEN** set-aside chapters are not among it, as they are not in the handoff

## MODIFIED Requirements

### Requirement: Identity is fixed, wording is free
A sub-chapter's key SHALL never change; its title MAY be reworded at any time.

#### Scenario: A section is renamed
- **WHEN** a later arrangement gives the same key a different title
- **THEN** the title changes and nothing else moves

#### Scenario: A section's key is already a chapter's
- **WHEN** an arrangement proposes a key that another chapter, or a section of another
  chapter, already uses — `security`, or a second `booking`
- **THEN** the section is given its parent's key in front, `functionality-security`, and a
  number after that if that is taken too; the arrangement used to fail the whole reply on the
  database's unique key, and nothing in it was saved
