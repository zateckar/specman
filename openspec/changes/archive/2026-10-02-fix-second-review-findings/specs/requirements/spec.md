## MODIFIED Requirements

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

#### Scenario: The reference is written in lower case
- **WHEN** the assistant writes `req-004`
- **THEN** it names `REQ-004`, rather than a reference that matches nothing and so a second
  copy of the rule

#### Scenario: A rule is restated without its reference
- **WHEN** a requirement with no reference has the same wording as one its chapter already
  holds, once case, spacing and the closing full stop are set aside
- **THEN** that one is updated and no new one is made, because the model restates rules as it
  rewrites a chapter and does not always carry the reference, and the chapter collected
  copies of itself; wording that differs in anything else is a different rule

### Requirement: Notation is stored, never shown
The user interface SHALL render a requirement and its scenarios as plain sentences.

#### Scenario: A requirement is displayed
- **WHEN** the preview renders it
- **THEN** the scenario reads as "If … then …", with no `SHALL` and no `WHEN`/`THEN`

#### Scenario: A person writes the examples
- **WHEN** examples are typed into a form, one to a line
- **THEN** each is read in the form it is shown in — "If …, then …", divided at the first
  "then", with a list bullet and the closing full stop set aside — and a line that cannot be
  read is returned to be quoted, never dropped while the others are saved
