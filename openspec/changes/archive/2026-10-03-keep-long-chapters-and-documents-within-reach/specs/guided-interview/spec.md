# The guided interview

## MODIFIED Requirements

### Requirement: The interviewer reads the whole document
A conversation turn SHALL show the model every other chapter that applies, with its rules, in
as much detail as its room allows, and SHALL let the model read any chapter in full during its
reply, so that what the colleague says can be checked against what the document already says
however long the document grows.

#### Scenario: An answer contradicts another chapter
- **WHEN** the colleague says something in one chapter that another chapter says differently
- **THEN** the assistant corrects the other chapter in the same reply and says which chapter
  it changed and what it said before, because with only the other chapters' titles it wrote
  the new answer down and left the contradiction for nobody to find (seen on 2026-10-03:
  missed on the old prompt, corrected in seven of eight replies on the new one); and it does
  not merely offer to, because an offer depends on a later turn that may never come

#### Scenario: It cannot tell which is meant
- **WHEN** it is unclear whether the colleague means to change the other chapter
- **THEN** the assistant asks instead of changing it

#### Scenario: A document that fits
- **WHEN** the rest of the document fits in 48 000 characters, about 12 000 tokens
- **THEN** every chapter is shown whole and no reading is offered, because a read would be a
  round trip that learns nothing

#### Scenario: A long document
- **WHEN** it does not fit
- **THEN** the chapters that bear least on the one under discussion are shown in less detail
  first — as an outline of their headings and the first sentence of each paragraph, then as
  their rules alone, then as their title — and the Overview and the chapter's own parent,
  sub-chapters and siblings keep their detail until the rest is down to rules; every chapter
  stays named and every rule stays until the last step, rather than the end of each long
  chapter being cut off unseen, as an equal share did

#### Scenario: Which chapters bear on this one
- **WHEN** relatedness is decided
- **THEN** it is read from what the chapter under discussion is for — its title, goal, purpose
  and questions — and not from what it says now, so the choice does not move from turn to turn
  and the system prompt stays one the gateway's cache can serve

#### Scenario: A chapter shown only in part matters
- **WHEN** the model needs what an outline leaves out
- **THEN** it calls `read_chapter` with the chapter's key, or a key and one heading, and is
  given the chapter as it stands; the chat says which chapter is being read. Live on
  2026-10-03, with a document of 190 000 characters, the model read Users and roles, found a
  contradiction buried mid-paragraph, and corrected that part

#### Scenario: Reading does not go on for ever
- **WHEN** a reply keeps reading
- **THEN** it may read in three rounds, the third saying it was the last, and a call after it
  ends the reply with what it has written

#### Scenario: A set-aside chapter
- **WHEN** the triage set a chapter aside
- **THEN** it is not shown, because it is not part of what will be built

## ADDED Requirements

### Requirement: A long chapter is written a part at a time
When the chapter under discussion is longer than 3 000 characters and has headings, the
assistant SHALL be asked to write only the parts that change, as section blocks, and the
server SHALL put each into the chapter by its heading, leaving every other part exactly as it
was.

#### Scenario: An answer changes one part
- **WHEN** the reply carries `<section chapter="data" heading="Cars">` with new text
- **THEN** that part is replaced, and every other line of the chapter is kept as written, so
  the change a reviewer sees is the change that was made; live on 2026-10-03 such turns
  changed a few lines each, where a whole rewrite of the same chapter cut it from 5 500
  characters to 1 400

#### Scenario: A part that is not there yet
- **WHEN** the heading matches none of the chapter's parts
- **THEN** it is added at the end, at the chapter's heading level

#### Scenario: How headings match
- **WHEN** the heading differs from the chapter's only in case, emphasis, numbering or a final
  colon
- **THEN** it is the same part

#### Scenario: A part with no heading named
- **WHEN** a section block has no heading attribute and its text does not begin with one
- **THEN** nothing is saved and the colleague is told part of the answer was not filed,
  because taken as the text before the first heading it would replace the chapter's opening

#### Scenario: An empty part
- **WHEN** a section block is empty
- **THEN** nothing changes, as with an empty chapter block; a part is removed only when the
  block says `action="remove"`

#### Scenario: A long chapter with no headings
- **WHEN** the chapter is long and has no headings
- **THEN** it is rewritten whole once, organised under headings, so later answers can change
  one part at a time

#### Scenario: A chapter too long to show
- **WHEN** the chapter under discussion is longer than 40 000 characters
- **THEN** it is shown as its outline and its parts, and the model reads the part it changes
  before writing it

#### Scenario: A short chapter
- **WHEN** the chapter is shorter than that
- **THEN** it is rewritten whole as before, because a short rewrite is quick and its changes
  are easy to see in review
