## MODIFIED Requirements

### Requirement: A repository has one writer at a time
Within one server process, repository writes SHALL remain serialized until the current
writer's work settles, including after its caller times out.

#### Scenario: The caller times out while Git continues writing
- **WHEN** a write exceeds the caller deadline but its work has not settled
- **THEN** the caller receives an error and subsequent writes to that repository wait for settlement

#### Scenario: Other repositories
- **WHEN** one repository has a timed-out writer
- **THEN** writes to different repository keys continue independently

#### Scenario: Settlement after timeout
- **WHEN** the timed-out work completes or rejects
- **THEN** the next queued writer proceeds and the failure cannot escape as an unhandled rejection

### Requirement: A commit with nothing to commit produces nothing
Committing SHALL be a no-op when the working tree is unchanged, and SHALL take place only on
the branch the caller named.

#### Scenario: Staging normalizes unchanged content
- **WHEN** rewriting files changes their working-tree line endings but staging produces an empty diff
- **THEN** committing returns no commit rather than failing with nothing to commit
