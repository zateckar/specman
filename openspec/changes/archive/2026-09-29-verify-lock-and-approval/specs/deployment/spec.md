## MODIFIED Requirements

### Requirement: An image is published only if the documentation agrees with the code
The build SHALL run the tests, documentation check and Lean protocol proofs before
publishing, and SHALL NOT publish from a proposal.

#### Scenario: A protocol proof fails
- **WHEN** the pinned Lean compiler rejects a proof or its axiom audit
- **THEN** the test job fails and the image job cannot start

#### Scenario: A pull request
- **WHEN** it is opened
- **THEN** the image is built but not pushed
