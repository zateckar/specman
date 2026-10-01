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

### Requirement: The same content is available as one document
The export page SHALL offer the bundle as a single document for pasting into a chat.

#### Scenario: A user wants to hand it to a coding assistant
- **WHEN** they open the export page
- **THEN** they can copy the whole thing at once, and are told it was copied

#### Scenario: The browser refuses the clipboard
- **WHEN** the page is served without a secure connection, or the browser declines access
- **THEN** the older copy command is tried, and failing that the text is selected and the user
  is told to press Ctrl+C — rather than a button that does nothing at all
