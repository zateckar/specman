## ADDED Requirements

### Requirement: Verification failures survive schema upgrades
Existing databases SHALL gain a failed-coverage column without losing stored verification results.

#### Scenario: A database predates coverage reporting
- **WHEN** the application starts against an older verifications table
- **THEN** the column is added with an empty default, preserving the old result without guessing which old calls failed
