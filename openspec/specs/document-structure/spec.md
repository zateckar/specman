# Document structure

## Purpose

"What the application does" is the chapter that grows. Once it covers six capabilities it is
a wall of prose nobody can navigate, and the assistant rewrites all of it to add a sentence.
So it proposes an arrangement — the whole set of sub-chapters, declaratively — and the server
works out the difference and moves the prose.

Two rules govern everything here: **reconciliation never destroys written work**, and
**anything that cannot be placed confidently stays where it is**.

## Source

- `src/lib/server/llm/subchapters.ts`
- `src/lib/server/markdown.ts`
- `src/lib/safe-markdown.ts`
- `src/lib/components/DocumentPreview.svelte`

## Requirements

### Requirement: An arrangement is proposed as a whole
A split SHALL be expressed as the complete ordered set of sub-chapters, not as incremental
additions and moves.

#### Scenario: The assistant proposes a split
- **WHEN** an arrangement arrives
- **THEN** the server computes the difference against what exists, so the whole plan can be
  checked before anything is written

### Requirement: Reconciliation never destroys written work
A sub-chapter omitted from a new arrangement SHALL be kept and placed after the planned
ones. Only one holding nothing at all MAY be removed.

#### Scenario: The assistant forgets a section
- **WHEN** an arrangement omits a sub-chapter that holds prose, a requirement, or a
  conversation
- **THEN** it survives, moved after the planned sections

#### Scenario: An empty section is dropped
- **WHEN** the omitted sub-chapter has no prose, no requirement and no conversation
- **THEN** it is removed

### Requirement: Identity is fixed, wording is free
A sub-chapter's key SHALL never change; its title MAY be reworded at any time.

#### Scenario: A section is renamed
- **WHEN** a later arrangement gives the same key a different title
- **THEN** the title changes and nothing else moves

### Requirement: Splitting moves the prose into the sections
When a chapter is split, its existing sections SHALL be filed into the matching
sub-chapters at that moment, deterministically and without a model call.

#### Scenario: A chapter written as six headed sections is split
- **WHEN** the arrangement is applied
- **THEN** each heading's content is moved into the sub-chapter it matches

#### Scenario: Wording has drifted
- **WHEN** a heading reads "My bookings and cancellation" and the section is titled "Seeing
  and cancelling my bookings"
- **THEN** they are matched, because matching is on stemmed words rather than exact text

#### Scenario: Two headings compete for one section
- **WHEN** several headings could match the same section
- **THEN** the strongest pairing across the whole set is taken first, so an exact match
  claims its own section before a loose one can take it

#### Scenario: A section's content is written back into its parent later
- **WHEN** a reply after the split rewrites the parent with a heading that matches an empty
  section
- **THEN** that content is filed into the section on the same terms as at split time, because
  the prompt tells the model never to do this and the model sometimes does

### Requirement: An unplaceable heading stays with its parent
Content that cannot be matched confidently SHALL remain in the parent chapter, and SHALL NOT
be filed by position.

#### Scenario: A heading matches nothing
- **WHEN** no section title is close enough
- **THEN** the content stays where it is, because a heading filed under the wrong capability
  is a wrong document, whereas one left in place is merely untidy

### Requirement: Nothing is ever written over
A sub-chapter that already holds content SHALL NOT be overwritten by filing.

#### Scenario: A section was written before the split completed
- **WHEN** a heading matches a section that already holds prose
- **THEN** the heading stays with the parent and the section is left as it is

### Requirement: A container shows its sections
A chapter that has been split SHALL display its sections beneath it, and SHALL NOT report
itself as unwritten when its content lives in them.

#### Scenario: Viewing a split chapter
- **WHEN** the container is selected
- **THEN** anything left in the parent is shown, followed by each section

#### Scenario: The parent holds nothing of its own
- **WHEN** all of its prose was filed into six sections
- **THEN** it says it is written as six parts, rather than not written

### Requirement: Sub-chapter position is relative to the parent
Ordering SHALL be stored relative to the parent so a parent can move without renumbering
anything beneath it.

#### Scenario: A split chapter is moved
- **WHEN** the parent's position changes
- **THEN** its sections follow it, in their order, untouched

### Requirement: Chapter prose is rendered as text, never as markup
The preview SHALL escape any HTML in a chapter, and SHALL render a link or image only when
its address uses http, https, mailto, tel, or no scheme at all.

#### Scenario: A chapter contains a tag
- **WHEN** the prose holds something that looks like HTML
- **THEN** it is shown as the characters it is, because a chapter is written by the model
  out of what the user typed and read by every colleague in the organisation

#### Scenario: A link with an executable address
- **WHEN** a link or image address uses any other scheme
- **THEN** the address is dropped and the wording kept, since the words are the user's
  content and the address is not

#### Scenario: The scheme is written with character references
- **WHEN** an address spells its scheme or colon as `&#106;`, `&#x6A;` or `&colon;`
- **THEN** it is read as the browser would read it and refused, because the browser decodes
  those before it looks at the scheme and `&#106;avascript:` is a working script link

#### Scenario: Image description or link title holds a quote
- **WHEN** the words describing an image, or a link's title, contain `"`
- **THEN** they are escaped inside the attribute, because marked writes an image description
  verbatim and `![x" onerror="…](a.png)` ran script for every reader without a click

### Requirement: A chapter's title is added once
The document writer SHALL supply a chapter's heading, and a duplicate heading written into
the content SHALL be removed.

#### Scenario: The assistant writes the title into the prose
- **WHEN** content begins with the chapter's own heading
- **THEN** it is stripped on save, on render and on git write, so the rule holds for content
  written before it existed
