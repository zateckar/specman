## MODIFIED Requirements

### Requirement: An application is created with a name and a profile
Creating an application SHALL require a name and SHALL record how far it reaches, whether
it holds personal data, whether it touches money, safety or legally required records,
whether it changes something that already exists, and whether the user will be interviewed
or the assistant will draft it.

#### Scenario: No name is given
- **WHEN** the form is submitted without a name
- **THEN** creation fails with a message asking for one, and nothing is created

#### Scenario: A draft with nothing to draft from
- **WHEN** drafting is chosen and the description is empty
- **THEN** creation fails with a message asking what it should do, and nothing is created,
  because a name alone gives the assistant nothing to make its assumptions about

#### Scenario: A description too long
- **WHEN** the description is longer than 2000 characters
- **THEN** creation fails with a message asking for fewer words, because a draft sends it with
  every chapter's call and the card shows three lines of it

#### Scenario: The form is refused
- **WHEN** creation fails for any reason
- **THEN** the form stays open with every answer as it was submitted, the way to start
  included, because it closed and emptied itself, and the description the user had written
  was gone

#### Scenario: What the form promises
- **WHEN** the profile questions are shown
- **THEN** they do not say the answers can be changed later, because nothing in the
  application changes a profile once it is created

#### Scenario: Choosing how to start
- **WHEN** the form is shown
- **THEN** answering the assistant's questions is the way already chosen, and drafting says
  plainly that the assistant makes every assumption itself and that the result can be deleted

#### Scenario: A valid submission
- **WHEN** name and answers are given
- **THEN** the application, its chapters, its repository and its first working branch all
  exist before the user reaches the workspace

#### Scenario: The repository cannot be made
- **WHEN** creating the repository or its first branch fails
- **THEN** the application and any folder made for it are removed, and the user is told in
  plain words that it could not be created — left in place, it was listed on the home page,
  every turn in it failed, and trying again made a second one beside it
- **AND** no draft is started for it
