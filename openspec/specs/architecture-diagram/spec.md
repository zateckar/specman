# The architecture diagram

## Purpose

The document drawn as three ArchiMate layers — business, application, technology — with the
capabilities from *What the application does* as the application services. It is the one
view that shows the whole application at once, and it is also the artefact an architect can
take away: the notation is ArchiMate's, not an approximation of it, and the file it exports
is the one every ArchiMate tool reads.

See `README.md`, *The diagram*, *Routing: why the lines are where they are*, and *Reading
it, and taking it away*.

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
