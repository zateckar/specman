## MODIFIED Requirements

### Requirement: Decisions travel with the repository
The decisions of an application SHALL be written into its repository, marking what the
assistant chose and what is still unconfirmed.

#### Scenario: Someone reads the change outside the application
- **WHEN** they read the repository
- **THEN** they can see who decided what, and what nobody has confirmed

#### Scenario: A confirmation or discard changes no prose
- **WHEN** the user confirms or discards an assumption
- **THEN** the change and updated chapter status are committed to the working proposal under
  the same repository lock as approval, so approval cannot merge a stale decision log

#### Scenario: A conversation records only a decision
- **WHEN** a turn records a decision without rewriting chapter prose or requirements
- **THEN** that decision still triggers a document commit

#### Scenario: The decision cannot be committed
- **WHEN** Git refuses to record the user's choice
- **THEN** the choice remains saved in the database and the interface reports that it has not
  reached the history, rather than treating the request as successful
