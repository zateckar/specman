## ADDED Requirements

### Requirement: A template chapter is always usable
An edit SHALL NOT leave a template chapter without a title or a purpose, and an edit to a
chapter that no longer exists SHALL be answered rather than fail.

#### Scenario: The title or the purpose is cleared
- **WHEN** an administrator saves a chapter with a blank title or a blank purpose
- **THEN** nothing is saved and the form says what is missing, because every new application
  would copy a chapter nobody can find in the index or one the assistant has no guidance for

#### Scenario: The chapter was removed since the page loaded
- **WHEN** the form names a chapter that is not there
- **THEN** the administrator is asked to reload the page, rather than shown a server error

## MODIFIED Requirements

### Requirement: The seeded template is complete on first boot
The server SHALL seed a default template while none exists, so a fresh deployment can create
an application immediately.

#### Scenario: First boot
- **WHEN** no template exists
- **THEN** the default template and its chapters are created

#### Scenario: A first boot that stopped after the template row
- **WHEN** the default template exists with no chapters
- **THEN** its chapters are seeded, because a template with none produces applications with
  nothing to ask

#### Scenario: Any later boot
- **WHEN** a template already exists
- **THEN** it is left alone, including any edits made to it — a goal an administrator cleared
  stays cleared
