## MODIFIED Requirements

### Requirement: Progress counts each piece of work once
Counting SHALL exclude a chapter that has been split into sections, because its progress is
its children's.

#### Scenario: A document with one split chapter
- **WHEN** totals are computed
- **THEN** the container is not counted alongside its sections

#### Scenario: Every counted chapter is complete
- **WHEN** each chapter that counts is complete and nothing is open
- **THEN** the index says everything is answered — compared against what is counted, because
  compared against every chapter, set-aside and split ones included, it never could
