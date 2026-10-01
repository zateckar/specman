# The architecture diagram

## Purpose

The document drawn as three ArchiMate layers — business, application, technology — with the
capabilities from *What the application does* as the application services. It is the one
view that shows the whole application at once, and it is also the artefact an architect can
take away: the notation is ArchiMate's, not an approximation of it, and the file it exports
is the one every ArchiMate tool reads.

## Source

- `src/lib/server/llm/architecture.ts`
- `src/lib/server/llm/architect.ts`
- `src/lib/server/llm/diagram.ts`
- `src/lib/server/llm/archimate.ts`
- `src/routes/api/architecture/+server.ts`
- `src/routes/projects/[id]/diagram/+page.server.ts`
- `src/routes/projects/[id]/diagram/+page.svelte`
- `src/routes/projects/[id]/diagram/export/+server.ts`
- `src/lib/components/ArchitectureDiagram.svelte`

## Requirements

### Requirement: The model is derived in two calls
Deriving the model SHALL name the parts first and connect them second.

#### Scenario: Asking for both at once
- **WHEN** one call is asked to name and connect
- **THEN** the whole output budget is spent on reasoning and nothing is returned — which is
  why the work is split

#### Scenario: The second call
- **WHEN** relations are derived
- **THEN** the call is handed the list of names, which makes it nearly mechanical

### Requirement: The model is kept once derived
A derived model SHALL be stored and reused until the user asks for it to be drawn again.

#### Scenario: Reopening the diagram
- **WHEN** the page is loaded again
- **THEN** the stored model is drawn, because deriving it costs gateway calls and it only
  changes when the document does

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

### Requirement: A relation naming something undeclared is dropped
A relation whose endpoint is not a declared element SHALL be discarded.

#### Scenario: The model names a box that does not exist
- **WHEN** the diagram is drawn
- **THEN** the relation is dropped rather than the box being invented, because a diagram
  with a mystery box is worse than one missing a line

### Requirement: Layout is deterministic geometry
The layout SHALL be computed in a pure module and rendered as plain SVG, with no diagramming
dependency.

#### Scenario: Running the tests
- **WHEN** `npm test` runs
- **THEN** the layout is asserted without a browser

### Requirement: Every connector segment lies in a reserved corridor
Horizontal runs SHALL lie in the gap above or below a row, and vertical runs in the gap
beside a column.

#### Scenario: Two boxes with something between them
- **WHEN** they are connected
- **THEN** the line goes around rather than underneath, because a relation you cannot follow
  with your eye defeats the only purpose the picture has

#### Scenario: Many wires at once
- **WHEN** a corridor carries several
- **THEN** it widens to fit them, so clearance is structural rather than a constant that
  happens to be big enough

#### Scenario: A long route
- **WHEN** it must cross rows
- **THEN** it takes the nearest quiet vertical corridor rather than the nearest one, because
  routes that all pile into one become a bundle nobody can follow

### Requirement: Every corner lies inside the drawing
No point on a connector SHALL fall outside the bounds of the picture.

#### Scenario: A route with no corridor assigned
- **WHEN** the lane is unset
- **THEN** it is a failure, not a line at the left edge — this check exists because "no
  connector passes under a box" passed while four routes ran off the edge of the picture

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

### Requirement: The notation is ArchiMate's
The drawing SHALL use the ArchiMate layer colours, a concept icon per element, rounded
corners for behaviour and square for structure, and the standard relationship decorations.

#### Scenario: Someone who knows ArchiMate opens it
- **WHEN** they look at it
- **THEN** they read the layers from the fill without being told

### Requirement: Connectors are drawn after the boxes
Connectors SHALL be rendered over the boxes and SHALL NOT receive pointer events.

#### Scenario: An end decoration meets a box
- **WHEN** a relationship ends at a border
- **THEN** its decoration is fully visible rather than half-buried

#### Scenario: A line lies against a border
- **WHEN** the user clicks the box there
- **THEN** the box is opened, because the line cannot swallow the click

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

### Requirement: The diagram leaves in an open format
The diagram SHALL be downloadable as an ArchiMate Open Exchange file carrying the elements,
the relationships, the layers as the model tree, and a view whose coordinates match the
screen.

#### Scenario: Opening the file in an ArchiMate tool
- **WHEN** it is imported
- **THEN** the layout matches what was on screen, so the work does not have to be retyped

#### Scenario: The three layer bands
- **WHEN** the file is written
- **THEN** the bands are not exported as container nodes, because nested nodes carry
  coordinates relative to their parent — a well-known source of import bugs — and a band is
  decoration rather than containment

### Requirement: Clicking a box opens where it came from
An element derived from a chapter SHALL link back to that chapter.

#### Scenario: Clicking an application service
- **WHEN** it came from a capability
- **THEN** that chapter opens
