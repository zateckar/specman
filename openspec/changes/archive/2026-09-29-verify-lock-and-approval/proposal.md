# Verify repository ownership and reviewed approval

## Why
A caller timeout released a still-running writer, permitting overlapping Git writes.
Approval also merged the current branch without identifying the commits actually reviewed.

## What Changes
Retain ownership until work settles. Read review artifacts from immutable commits and
validate proposal identity, proposal commit and approved base inside the approval lock.
Merge the validated commit. Add Lean 4.34.1 protocol models, counterexamples, regression
tests and a mandatory CI proof check with an explicit implementation mapping and limits.
Treat a staging-normalized empty diff as a no-op; regression testing exposed a false failure
when an unchanged document was rewritten after approval on Windows.

## Impact
Application repository, change review, formal verification and deployment specifications.
A permanently stuck writer blocks its own repository until recovery; other keys continue.
