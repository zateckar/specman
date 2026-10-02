# Company standards

## Purpose

Škoda has standard answers for sign-in, data handling, licensing and telemetry.
Interviewing every requester about them from scratch wastes their time and produces
inconsistent documents. A standard that applies is copied into a new application as a
requirement the assistant is told not to re-interview — it asks only where the application
needs to deviate.

This capability carries the project's sharpest safety rule: **the seeded standards are
examples, not policy, and ship switched off.**

## Source

- `src/lib/server/db/default-standards.ts`
- `src/routes/admin/standards/+page.server.ts`
- `src/routes/admin/standards/+page.svelte`

## Requirements

### Requirement: Seeded standards are inactive
Standards seeded by the application SHALL be created inactive, and SHALL NOT be activated by
any automatic process.

#### Scenario: A fresh deployment
- **WHEN** the example standards are seeded
- **THEN** none of them is active, and none is copied into any application

#### Scenario: Why this matters
- **WHEN** a standard is active
- **THEN** it is copied into every application it applies to, where it reads as official —
  so a wrong one becomes a wrong line in every specification, silently

### Requirement: An applicable active standard is inherited at creation
Creating an application SHALL copy each active standard whose conditions hold into it as a
requirement recorded as coming from a standard.

#### Scenario: A standard conditioned on personal data
- **WHEN** the application holds personal data
- **THEN** the standard arrives as one of its requirements, marked as inherited

#### Scenario: A standard that does not apply
- **WHEN** none of its conditions hold for this application
- **THEN** it is not copied in

#### Scenario: A standard whose chapter was set aside
- **WHEN** the standard belongs to a chapter the triage set aside for this application
- **THEN** it is not copied in, because a rule in a chapter that does not apply was reported
  as a broken reference and counted in the handoff as something to build

#### Scenario: The set-aside chapter is included afterwards
- **WHEN** the user includes a chapter the triage set aside
- **THEN** the active standards filed under it whose conditions hold are copied in then, as
  they would have been at creation; included without them, a security chapter was interviewed
  from nothing and the company's own rules for it were missing from the handoff
- **AND** a standard the chapter already holds is not copied twice when it is set aside and
  included again

### Requirement: A standard's conditions are ones the code knows
Saving a standard SHALL accept only known condition names, and SHALL read a blank list as
`always`.

#### Scenario: A misspelt condition
- **WHEN** an administrator types `personal-data` instead of `personal_data`
- **THEN** nothing is saved and the form names the word it did not recognise and lists the
  ones it does, because an unknown condition is treated as holding — the cautious answer for
  a chapter — and the typo silently made the standard apply everywhere

#### Scenario: The field is cleared
- **WHEN** the conditions are saved empty
- **THEN** the standard applies always, the same as one that never had conditions, rather
  than being stored with an empty list

#### Scenario: The standard was removed since the page loaded
- **WHEN** the form names a standard that is not there
- **THEN** the administrator is asked to reload the page, rather than shown a server error

### Requirement: A standard's examples are edited with its wording
The standards page SHALL let an administrator edit a standard's examples, one to a line in
the words they are shown in — "If …, then …" — and SHALL refuse a standard with none.

#### Scenario: The wording is changed
- **WHEN** an administrator rewrites what must be true
- **THEN** the examples beside it can be rewritten in the same form, because left fixed they
  went on describing the old rule, and every application inherited a requirement whose own
  examples contradicted it

#### Scenario: A line that is not an example
- **WHEN** a line cannot be read as "If …, then …"
- **THEN** nothing is saved and the form quotes the line, rather than dropping it quietly

#### Scenario: Any save is refused
- **WHEN** the wording, the conditions or the examples are refused
- **THEN** the refusal is shown on that standard's card, which still holds everything that was
  typed into it, because reloaded from storage the rest of an edit was lost over one line

#### Scenario: Every example removed
- **WHEN** the examples are saved empty
- **THEN** nothing is saved, because a requirement with no example cannot be checked and the
  validation would report it in every application that inherits it

### Requirement: Inherited requirements are not re-interviewed
The assistant SHALL be told to take an inherited requirement as given, and to raise it only
when what the user describes would break it.

#### Scenario: Sign-in is covered by a standard
- **WHEN** the conversation reaches sign-in
- **THEN** the assistant states the standard as settled and asks only about exceptions

### Requirement: Standards apply to new applications only
Changing or activating a standard SHALL NOT alter requirements an application already holds,
and SHALL reach an existing application only through a chapter the user includes.

#### Scenario: A standard is activated today
- **WHEN** an application was created last week
- **THEN** its requirements are unchanged, because a document must not gain rules its author
  never saw

#### Scenario: A standard is reworded today
- **WHEN** an application inherited the earlier wording
- **THEN** it keeps the earlier wording, which is the one its author read

#### Scenario: A chapter is included today
- **WHEN** the user includes a chapter that was set aside
- **THEN** it receives the standards as they stand today, because the user is opening that
  chapter now and reads them as it opens
