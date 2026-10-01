## ADDED Requirements

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
