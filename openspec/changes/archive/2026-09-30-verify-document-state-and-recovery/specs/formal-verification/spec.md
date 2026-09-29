## ADDED Requirements

### Requirement: Remaining document and identity protocols have checked invariants
The proof gate SHALL check optimistic update, approval recovery, chapter completion,
verification coverage and identity-linking invariants with explicit implementation mappings.

#### Scenario: Delayed updates or interrupted approval
- **WHEN** the modeled execution contains conflicting updates or arbitrary crashes
- **THEN** stale updates cannot enter the accepted history and closed approvals have durable merge evidence

#### Scenario: Completion, coverage or identity status
- **WHEN** the corresponding model is checked
- **THEN** pending assumptions prevent completion, failed checks cannot count as successful, and a name collision cannot acquire another identity's account

## MODIFIED Requirements

### Requirement: Protocol proofs are checked before publication
CI SHALL kernel-check the documented document, recovery and identity protocol theorems with
Lean 4.34.1, rejecting incomplete proofs and dependencies beyond Lean's standard logical axioms.

#### Scenario: A protocol proof is incomplete or relies on an extra axiom
- **WHEN** the formal check runs
- **THEN** it fails and the image publication job cannot start

### Requirement: The proof boundary is explicit
The formal documentation SHALL map modeled transitions to implementation and identify
assumptions, regression tests, and application behavior outside the proofs.

#### Scenario: A reviewer evaluates the safety claim
- **WHEN** they read the formal models
- **THEN** they can identify the single-process, work-settlement and durability assumptions,
  supported recovery and optimistic updates, and behavior outside the models
