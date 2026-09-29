# Keep identity, approval and verification boundaries reliable

## Why

The application review reproduced account adoption by username, unreviewed database
content reaching the approved bundle, failed checks being reported as clean, ignored
stream errors, and decision changes missing from Git.

## What Changes

- OIDC accepts only an existing issuer/subject link or a genuinely new account name.
- Approval builds from committed proposal data, including a compatibility path for older repositories.
- Verification retains successful findings and reports failed coverage in the UI and repository.
- Incomplete or failed gateway streams cannot finish a chat turn successfully.
- Decision-only turns and confirmation/discard actions commit to the working proposal.

## Impact

Capabilities: access-control, change-review, application-repository, decisions,
document-verification, llm-gateway, guided-interview and storage-and-migrations.
Migration: add a failed-checks column with an empty default; older proposals are read
from Git without importing live database content. Previously stored check outcomes
cannot be retrospectively validated. No additional gateway calls.
