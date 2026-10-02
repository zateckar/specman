## ADDED Requirements

### Requirement: The export page says which version it shows
The export page SHALL say that the bundle in the repository is the approved version, and that
the text it offers includes changes not yet approved.

#### Scenario: Changes are waiting for review
- **WHEN** the user copies the document from the export page
- **THEN** they have been told it is the working version, because a developer handed it would
  otherwise build changes nobody has approved

## MODIFIED Requirements

### Requirement: Caveats travel with the bundle
The bundle SHALL state unanswered questions, structural problems, and decisions the
assistant made that were never confirmed, at the top of its instructions.

#### Scenario: The document has gaps
- **WHEN** the bundle is written
- **THEN** it is written anyway, with the caveats stated, because a builder who does not know
  the gaps exist will guess — and a guess becomes a rebuild

#### Scenario: A set-aside chapter still holds questions
- **WHEN** a chapter that does not apply carries open questions, rules or assumptions
- **THEN** none of them is counted in the caveats or among the rules to build, because it was
  never in scope

#### Scenario: The validation raised warnings
- **WHEN** the document has things worth checking that are not errors
- **THEN** the instructions list them too, because the export page showed them to the
  requester and the builder never heard of them

#### Scenario: The page and the bundle count the same document
- **WHEN** the export page shows its figures
- **THEN** they are counted by the same function the bundle's instructions are, because the
  page counted over every chapter and the file over the ones that apply, and the two gave
  different numbers for the same document
