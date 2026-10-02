## MODIFIED Requirements

### Requirement: The diagram can be read without seeing it
The view SHALL list the elements by layer and the relations as sentences, and every box SHALL
be reachable and identifiable from the keyboard.

#### Scenario: Someone using a screen reader
- **WHEN** they reach the diagram
- **THEN** each box is announced by its name and kind, and "The diagram in words" lists the
  parts of each layer with links to their chapters, and each connection in the legend's words
  — "Employee carries out Booking a car"

#### Scenario: Moving through the boxes with the keyboard
- **WHEN** a box has focus
- **THEN** it is outlined, and what it connects to is picked out as it is on hover

#### Scenario: A box that belongs to no chapter
- **WHEN** a box has no chapter to open, such as a person or an outside system
- **THEN** it can still be reached with Tab and is announced as a picture by its name and
  kind, because a box was focusable only through its link, and those with no link were
  skipped by the keyboard altogether

#### Scenario: The download is labelled
- **WHEN** the download control is shown
- **THEN** it says what it is for in plain words — a file that opens in Archi and other
  modelling tools — not the exchange format's name
