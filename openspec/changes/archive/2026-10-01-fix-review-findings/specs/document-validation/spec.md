## ADDED Requirements

### Requirement: A finding names the rule in the user's words
A finding about a requirement SHALL quote the rule's statement, shortened if long, and SHALL NOT
name it by its reference.

#### Scenario: Two rules say the same thing
- **WHEN** a duplicate is reported to the user
- **THEN** the message quotes the rule — `the rule “Bookings can be cancelled until noon”` —
  because `REQ-014` is storage the user never sees, and a finding they cannot place is one
  they cannot fix

## MODIFIED Requirements

### Requirement: Set-aside chapters are not validated
A chapter that does not apply SHALL be excluded from validation.

#### Scenario: A set-aside compliance chapter
- **WHEN** the document is validated
- **THEN** its emptiness is not reported as a fault

#### Scenario: A rule in a chapter that was set aside
- **WHEN** a requirement belongs to a chapter that is set aside
- **THEN** it is reported as a warning that the chapter was set aside as not applying, with an
  invitation to open it if it does — not as an error saying the chapter does not exist, which
  it does
