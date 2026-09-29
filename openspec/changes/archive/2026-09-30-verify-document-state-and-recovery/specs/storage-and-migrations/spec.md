## ADDED Requirements

### Requirement: Document revisions cover every persisted model input
Storage SHALL migrate existing projects to a monotonic document revision and invalidate
snapshots on chapter, requirement, decision and project-context changes, including section planning.

#### Scenario: An older project is opened
- **WHEN** its schema lacks document revisions
- **THEN** the revision column and mutation triggers are installed while preserving its content

#### Scenario: A guarded update fails
- **WHEN** any part of a reply's synchronous transaction raises
- **THEN** all its mutations and revision changes roll back together

#### Scenario: A counter would rewind or overflow
- **WHEN** a write cannot advance the revision as an exact safe integer
- **THEN** storage rejects it without saving unversioned document changes

### Requirement: Verification and recovery migrations preserve evidence
Storage SHALL preserve old reports with unknown input revisions and install a durable
approval journal with at most one unfinished intent per project.

#### Scenario: An old report is read
- **WHEN** it predates revision capture
- **THEN** it remains available as stale coverage rather than being treated as current

#### Scenario: Startup finds an unfinished approval
- **WHEN** the journal contains pending work
- **THEN** recovery is attempted before startup document commits, and every later writer checks it independently
