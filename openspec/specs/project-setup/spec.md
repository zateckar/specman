# Starting an application

## Purpose

A tool for five people in one office should not face the same compliance battery as
something holding personal data for the whole company. Asking anyway wastes the requester's
time and teaches them that most of the document is box-ticking — which is when people start
answering carelessly. A handful of questions at creation produce a **profile** that decides
which chapters this application actually needs.

## Source

- `src/routes/+page.server.ts`
- `src/routes/+page.svelte`
- `src/lib/server/llm/profile.ts`

## Requirements

### Requirement: An application is created with a name and a profile
Creating an application SHALL require a name and SHALL record how far it reaches, whether
it holds personal data, whether it touches money, safety or legally required records, and
whether it changes something that already exists.

#### Scenario: No name is given
- **WHEN** the form is submitted without a name
- **THEN** creation fails with a message asking for one, and nothing is created

#### Scenario: A valid submission
- **WHEN** name and answers are given
- **THEN** the application, its chapters, its repository and its first working branch all
  exist before the user reaches the workspace

### Requirement: Unanswered means the cautious answer
An unreadable, missing or unrecognised profile value SHALL resolve to the answer that keeps
more of the document.

#### Scenario: Personal data is not stated
- **WHEN** the personal-data answer is absent
- **THEN** the application is treated as holding personal data

#### Scenario: An unknown condition appears on a chapter
- **WHEN** a chapter carries a condition the code does not recognise
- **THEN** the chapter is kept rather than silently removed

### Requirement: A chapter applies if any of its conditions hold
Chapter applicability SHALL be the disjunction of its conditions, and a chapter with no
conditions SHALL always apply.

#### Scenario: A team-only tool with no personal data
- **WHEN** the profile reaches one team only and holds no personal data
- **THEN** chapters conditioned solely on personal data or on reaching beyond the team are
  set aside, and the rest are kept

### Requirement: A chapter that does not apply is marked, never deleted
A set-aside chapter SHALL remain in the document carrying a reason in plain language, and
SHALL remain openable by the user.

#### Scenario: Reading a set-aside chapter
- **WHEN** the user opens the index
- **THEN** the chapter is shown as set aside, with why, and an invitation to open it anyway
  if they think it does apply

#### Scenario: The reason is written down
- **WHEN** a chapter is set aside because the application reaches one team and holds no
  personal data
- **THEN** the recorded reason names those facts in the user's terms, not as condition names

### Requirement: Set-aside chapters cost nothing downstream
A chapter that does not apply SHALL be excluded from progress counts, validation, the
verification pass and the assistant's context.

#### Scenario: Counting progress
- **WHEN** nine of twelve chapters apply
- **THEN** progress is reported against nine

### Requirement: Slugs are unique and derived from the name
The application's slug SHALL be derived from its name, stripped of diacritics, and made
unique by suffixing.

#### Scenario: Two applications with the same name
- **WHEN** a second application is created with an existing name
- **THEN** it gets a distinct slug, and therefore a distinct repository path

### Requirement: The home page and the chapter index agree
Progress shown on an application's card SHALL be counted by the same rule the chapter index
uses.

#### Scenario: A document with a split chapter
- **WHEN** one chapter has been split into sections
- **THEN** the card and the index report the same totals, because a container's progress is
  its children's and counting both would count the same work twice
