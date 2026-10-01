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

### Requirement: Inherited requirements are not re-interviewed
The assistant SHALL be told to take an inherited requirement as given, and to raise it only
when what the user describes would break it.

#### Scenario: Sign-in is covered by a standard
- **WHEN** the conversation reaches sign-in
- **THEN** the assistant states the standard as settled and asks only about exceptions

### Requirement: Standards apply to new applications only
Changing or activating a standard SHALL NOT alter applications that already exist.

#### Scenario: A standard is activated today
- **WHEN** an application was created last week
- **THEN** its requirements are unchanged, because a document must not gain rules its author
  never saw
