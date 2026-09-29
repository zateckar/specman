## ADDED Requirements

### Requirement: Protocol proofs are checked before publication
CI SHALL kernel-check repository ownership and reviewed-approval protocol theorems with
Lean 4.34.1, rejecting incomplete proofs and dependencies beyond Lean's standard logical axioms.

#### Scenario: A protocol proof is incomplete or relies on an extra axiom
- **WHEN** the formal check runs
- **THEN** it fails and the image publication job cannot start

### Requirement: The proof boundary is explicit
The formal documentation SHALL map modeled transitions to implementation and identify
assumptions, regression tests, and application behavior outside the proofs.

#### Scenario: A reviewer evaluates the safety claim
- **WHEN** they read the formal models
- **THEN** they can identify the single-process and work-settlement assumptions and the unproved crash and concurrent-chat behavior
