## ADDED Requirements

### Requirement: Export inputs travel with the document revision
Each document commit SHALL include the complete export inputs in specman.export.json,
including prose, application type, applicability, requirement provenance and decisions.

#### Scenario: Approval overlaps a database update
- **WHEN** a proposal is approved after another turn saved newer answers
- **THEN** the bundle can be built from the committed snapshot without reading mutable database content
