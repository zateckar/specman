## ADDED Requirements

### Requirement: Failed coverage cannot be reported as clean
A verification run SHALL retain successful findings and separately record failed chapter
and cross-document calls, counting only successful chapters as checked.

#### Scenario: Every gateway call fails
- **WHEN** the gateway is unavailable for the entire run
- **THEN** the result records no successfully checked chapters and reports incomplete coverage
  both in the interface and repository, without asserting that the document agrees with itself

#### Scenario: One chapter succeeds while another fails
- **WHEN** only some checks finish
- **THEN** their findings survive and the failed coverage survives reopening the review page

#### Scenario: The user retries successfully
- **WHEN** a subsequent run checks all relevant parts successfully
- **THEN** the latest result has no failed coverage and can report a clean check when it finds no issues
