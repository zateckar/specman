## ADDED Requirements

### Requirement: A failed drawing keeps the last good one
Only a model with at least one element SHALL be stored, and a drawing that fails SHALL leave
the previous picture on screen and in the download, with the reason said in plain words.

#### Scenario: The gateway fails while drawing
- **WHEN** either call fails
- **THEN** nothing is stored, the picture already shown stays, and the user is told the
  diagram could not be drawn and to try again — because the failure used to be saved as the
  application's diagram, so one bad attempt replaced a good picture with an empty one

#### Scenario: Nothing usable comes back
- **WHEN** the reply names no element
- **THEN** nothing is stored and the user is told there needs to be more written down first

#### Scenario: An empty drawing left from before
- **WHEN** the newest stored model is empty and an earlier one is not
- **THEN** the earlier one is shown and downloaded

#### Scenario: Downloading when nothing has been drawn
- **WHEN** no stored model has an element in it
- **THEN** the download answers that no diagram has been drawn, rather than a file with an
  empty view

### Requirement: No connector crosses a layer's name
Each band's name SHALL be written upright in a strip down the band's left edge that lies
outside every corridor.

#### Scenario: Wires in the first gutter and the band's top channel
- **WHEN** the diagram has many wires
- **THEN** none enters a band's name, because written across the top of the band the name sat
  where the first vertical gutter and the channel above the band's first row both run — and
  "no connector passes under a box" said nothing about it, since a name is not a box

### Requirement: A name fits its box
A box's name SHALL be wrapped to the box's width, a word longer than a line SHALL be broken
with a hyphen, and a name too long for three lines SHALL be shortened with a mark that stays
within the width.

#### Scenario: One very long word
- **WHEN** an element is called "Fahrzeugdisponierungssystemverwaltung"
- **THEN** it is broken across lines with hyphens rather than running out of both sides of
  its box

### Requirement: What the model writes is checked before it is used
An element's chapter SHALL be kept only when it is shaped like a chapter key, and an element
whose name gives no identifier SHALL be dropped.

#### Scenario: The model writes something odd as the chapter
- **WHEN** the chapter attribute holds anything but lowercase letters, digits and hyphens
- **THEN** the element is drawn without a link, because the value becomes an address on the
  page and in the downloaded file

#### Scenario: A name with nothing to make an identifier from
- **WHEN** an element's name has no letters or digits a slug can keep
- **THEN** it is dropped, because every such name would share the empty identifier and the
  relations between them would be drawn to the wrong box

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

#### Scenario: The download is labelled
- **WHEN** the download control is shown
- **THEN** it says what it is for in plain words — a file that opens in Archi and other
  modelling tools — not the exchange format's name

## MODIFIED Requirements

### Requirement: The diagram can be read at any size
The view SHALL offer zoom in and out, fit, actual size, full screen, and dragging to pan.

#### Scenario: Fitting
- **WHEN** the user fits the diagram
- **THEN** it is fitted in both dimensions, because a diagram of three layers showing two is
  not fitted

#### Scenario: The window is resized
- **WHEN** the diagram was left fitted
- **THEN** it re-fits; one the user zoomed deliberately is left alone

#### Scenario: A drag ends on a box
- **WHEN** the user finishes panning with the pointer over a box
- **THEN** its chapter is not opened

#### Scenario: A drag ends outside the frame
- **WHEN** a drag ends with the pointer outside the diagram, and the user then opens a box
- **THEN** the box opens, because only the click that ends a drag is swallowed — left set, the
  flag ate the next click, a keyboard Enter included
