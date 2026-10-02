## ADDED Requirements

### Requirement: An empty chapter is never complete
Reconciliation SHALL NOT store a chapter as complete while it holds no prose.

#### Scenario: The assessor says complete for a chapter with nothing in it
- **WHEN** the reply settled the conversation but no prose has been written into the chapter
- **THEN** it is stored in progress, because a chapter that says "finished" over an empty
  page hands a developer nothing and tells the user nothing is left to do

### Requirement: The assessment has room to reason
The completeness call SHALL be given a budget sized for the model's reasoning as well as its
small verdict.

#### Scenario: A long chapter is assessed
- **WHEN** the model reasons at length before answering
- **THEN** the verdict still arrives, because at the default ceiling the reasoning used all of
  it and the call came back empty — the output-token count landing exactly on the ceiling

### Requirement: A narrow window can reach the document
On a window too narrow for the conversation and the document side by side, the workspace
SHALL offer a switch between them.

#### Scenario: Opening an application on a small laptop or a tablet
- **WHEN** the window is narrow
- **THEN** a Conversation and a Document control choose which is shown, because the document
  pane was hidden there with no way to bring it back

#### Scenario: Which application a tab holds
- **WHEN** several applications are open in tabs
- **THEN** each tab is titled with its application's name, because every tab read "Specman"
