## MODIFIED Requirements

### Requirement: Ambiguous authorship resolves to the assistant
A decision whose source is unclear SHALL be recorded as the assistant's.

#### Scenario: The source is not stated
- **WHEN** a decision arrives without an explicit user attribution
- **THEN** it is attributed to the assistant, because mislabelling a machine's default as
  the user's own choice hides it inside their specification, whereas the reverse merely asks
  them to confirm something they already said

#### Scenario: The model calls its choice a company standard
- **WHEN** a decision in a reply claims `source="standard"`
- **THEN** it is the assistant's, because standards are copied in from the administrators'
  list, and a model writing the word does not make its choice the company's — stored so, it
  was never offered for confirmation

#### Scenario: The user handed the choice back
- **WHEN** the model labels a decision as the user's, and the user's message this turn says
  "you decide", "up to you", "I don't know" or the like — in English, Czech, Slovak or German
- **THEN** it is the assistant's and waits for confirmation, because a decision labelled the
  user's is stored as confirmed, and this is exactly the case the prompt warns about and the
  models get wrong
