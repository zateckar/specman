## ADDED Requirements

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

## MODIFIED Requirements

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
