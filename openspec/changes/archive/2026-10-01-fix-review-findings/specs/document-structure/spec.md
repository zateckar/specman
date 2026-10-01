## MODIFIED Requirements

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
