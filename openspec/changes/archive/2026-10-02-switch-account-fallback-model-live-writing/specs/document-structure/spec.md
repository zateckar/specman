## ADDED Requirements

### Requirement: A chapter being written is marked as unsaved
The document pane SHALL mark the chapter the assistant is writing as being written, in place
of its status, until the turn saves it.

#### Scenario: Watching a chapter arrive
- **WHEN** the chapter's text is streaming into the pane
- **THEN** it is labelled as being written rather than with its stored status, because the text
  shown is not saved until the turn is, and a failed turn puts the stored text back
