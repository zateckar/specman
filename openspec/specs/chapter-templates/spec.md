# Chapter templates

## Purpose

The document has a shape before anyone talks about a specific application: twelve chapters,
each with a one-sentence goal, the questions worth asking, and the criteria that decide when
it is finished. Administrators edit that shape. The rule that protects users from it is that
a document keeps the questions it started with.

## Source

- `src/lib/server/db/default-template.ts`
- `src/routes/admin/templates/+page.server.ts`
- `src/routes/admin/templates/+page.svelte`

## Requirements

### Requirement: Chapters are snapshot into an application at creation
Creating an application SHALL copy the template's chapters into it, and later edits to the
template SHALL NOT change documents already in progress.

#### Scenario: A template chapter is reworded mid-interview
- **WHEN** an administrator edits the template
- **THEN** applications created before the edit keep the chapters they started with

#### Scenario: A new application after the edit
- **WHEN** an application is created afterwards
- **THEN** it receives the edited chapters

### Requirement: Every chapter has a single-sentence goal
A template chapter SHALL carry a goal short enough to state in one sentence.

#### Scenario: The index needs more than a status dot
- **WHEN** the chapter index is rendered
- **THEN** each chapter shows what it is for, not only how far along it is

### Requirement: A chapter declares when it applies
A template chapter SHALL carry the conditions under which an application needs it.

#### Scenario: A compliance chapter
- **WHEN** the chapter is conditioned on personal data
- **THEN** an application holding no personal data receives it set aside rather than active

### Requirement: A template chapter is always usable
An edit SHALL NOT leave a template chapter without a title or a purpose, and an edit to a
chapter that no longer exists SHALL be answered rather than fail.

#### Scenario: The title or the purpose is cleared
- **WHEN** an administrator saves a chapter with a blank title or a blank purpose
- **THEN** nothing is saved and the form says what is missing, because every new application
  would copy a chapter nobody can find in the index or one the assistant has no guidance for

#### Scenario: The chapter was removed since the page loaded
- **WHEN** the form names a chapter that is not there
- **THEN** the administrator is asked to reload the page, rather than shown a server error

### Requirement: The seeded template is complete on first boot
The server SHALL seed a default template while none exists, so a fresh deployment can create
an application immediately.

#### Scenario: First boot
- **WHEN** no template exists
- **THEN** the default template and its chapters are created

#### Scenario: A first boot that stopped after the template row
- **WHEN** the default template exists with no chapters
- **THEN** its chapters are seeded, because a template with none produces applications with
  nothing to ask

#### Scenario: Any later boot
- **WHEN** a template already exists
- **THEN** it is left alone, including any edits made to it — a goal an administrator cleared
  stays cleared
