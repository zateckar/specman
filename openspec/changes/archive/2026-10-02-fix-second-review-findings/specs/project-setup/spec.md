## MODIFIED Requirements

### Requirement: An application is created with a name and a profile
Creating an application SHALL require a name and SHALL record how far it reaches, whether
it holds personal data, whether it touches money, safety or legally required records, and
whether it changes something that already exists.

#### Scenario: No name is given
- **WHEN** the form is submitted without a name
- **THEN** creation fails with a message asking for one, and nothing is created

#### Scenario: The form is refused
- **WHEN** creation fails for any reason
- **THEN** the form stays open with every answer as it was submitted, because it closed and
  emptied itself, and the description the user had written was gone

#### Scenario: What the form promises
- **WHEN** the profile questions are shown
- **THEN** they do not say the answers can be changed later, because nothing in the
  application changes a profile once it is created

#### Scenario: A valid submission
- **WHEN** name and answers are given
- **THEN** the application, its chapters, its repository and its first working branch all
  exist before the user reaches the workspace

#### Scenario: The repository cannot be made
- **WHEN** creating the repository or its first branch fails
- **THEN** the application and any folder made for it are removed, and the user is told in
  plain words that it could not be created — left in place, it was listed on the home page,
  every turn in it failed, and trying again made a second one beside it

### Requirement: A chapter that does not apply is marked, never deleted
A set-aside chapter SHALL remain in the document carrying a reason in plain language, and
SHALL remain openable by the user.

#### Scenario: Reading a set-aside chapter
- **WHEN** the user opens the index
- **THEN** the chapter is shown as set aside, with why, and a control to include it if they
  think it does apply

#### Scenario: The user includes a set-aside chapter
- **WHEN** the user includes it
- **THEN** it applies from then on — counted, validated, verified and handed off like any
  other — and the change is committed to the working branch, because merely opening it
  changed nothing until something happened to be written there

#### Scenario: The chapter is included but the commit fails
- **WHEN** the chapter was kept as included and recording it in the repository failed
- **THEN** the user is told it is included and will be recorded with the next change, rather
  than that it could not be included; and including it again records it, because a second
  attempt saw a chapter already included and committed nothing

#### Scenario: Something is written in a set-aside chapter
- **WHEN** a turn writes prose, a requirement or a decision into a set-aside chapter
- **THEN** the chapter applies again, because what the user described says it does

#### Scenario: The reason is written down
- **WHEN** a chapter is set aside because the application reaches one team and holds no
  personal data
- **THEN** the recorded reason names those facts in the user's terms, not as condition names

### Requirement: The home page and the chapter index agree
Progress shown on an application's card SHALL be counted by the same rules the chapter index
uses: the same chapters, and the same status.

#### Scenario: A document with a split chapter
- **WHEN** one chapter has been split into sections
- **THEN** the card and the index report the same totals, because a container's progress is
  its children's and counting both would count the same work twice

#### Scenario: A complete chapter resting on an unconfirmed decision
- **WHEN** a chapter is stored as complete but holds a decision the user has not confirmed
- **THEN** the card counts it as in progress, as the index does

#### Scenario: Questions in a chapter that does not count
- **WHEN** a set-aside chapter or a split container still holds open questions
- **THEN** the card does not count them as questions still to answer

#### Scenario: One question left
- **WHEN** a card counts a single open question
- **THEN** it says "1 open question", in the singular
