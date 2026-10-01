# Fix what the application review of 2026-10-01 found

## Why

A review of the whole application — five reviewers in parallel, direct probes, and a
throwaway running instance — found faults in every layer:

- **Security:** links and images whose markup a crafted reply could break out of; a sign-in
  return path that could leave the site; password guessing at full speed, with a timing
  difference between known and unknown names; an OIDC response not bound to its own
  attempt; and a proxy header able to adopt a company sign-in account.
- **Interview:** a turn that lost or misfiled what the model wrote; a conversation the
  gateway rejects; failures quoted at the user in developer terms.
- **Decisions, review and repository:** decisions that vanished without reopening anything;
  a check that made the next approval fail; a repository left half-made for good.
- **Storage:** boot repairs that ran on every start, and creation that left broken
  applications behind.
- **Interface:** a diagram that a failed redraw replaced with an empty one, an answer sent
  during another turn that silently disappeared, and a picture nobody could read without
  seeing it.

## What Changes

- **Security:** links and images are built by hand with escaped attributes, and character
  references are decoded before a scheme is judged. The return path must stay on the site.
  Sign-in attempts are throttled per address and name, and every name costs a full hash, run
  off the event loop. OIDC carries a nonce. The proxy cannot assert an account that signs in
  through the company.
- **Interview:** the block parser recovers from a forgotten close tag and from single quotes,
  and files a keyless or title-keyed block where it was meant to go. The conversation sent to
  the model is normalised. Failures are described in plain words. A turn's budget covers a
  whole chapter. Writing into a set-aside chapter brings it back. Company standards cannot be
  deleted in conversation.
- **Decisions:** saying an assumption is wrong reopens its chapter and asks the question
  again. A decision settled in another window is reported rather than failed. Confirming is
  idempotent.
- **Review and repository:** the review page reloads after a check. Validation quotes rules
  rather than naming references. Set-aside chapters are left out of inheritance and the
  handoff. Repositories resume an interrupted initialisation. Reading the manifest tells an
  absent one from a broken one.
- **Storage:** a one-off repair runs once. Booting is one transaction, and a failed boot
  leaves no handle behind. Backfills run only with their column. Repaired documents stay
  marked until they are committed. Creating an application is all or nothing, and avoids
  Windows device names and folders already on disk.
- **Interface:**
  - A failed redraw keeps the last good diagram.
  - The diagram has a description in words, keyboard focus, and layer names that no wire
    can cross; long names wrap.
  - The chat refuses a second turn, keeps drafts per chapter, holds the reply until the page
    has caught up, and supports screen readers and keyboard use.
  - The index can include a set-aside chapter.
  - The home cards agree with the index.
  - The admin forms validate what they save.
  - The handoff page copies without a secure connection.

## Impact

- **Capabilities:** access-control, application-repository, architecture-diagram,
  change-review, chapter-progress, chapter-templates, company-standards, decisions,
  developer-handoff, document-structure, document-validation, document-verification,
  guided-interview, llm-gateway, project-setup, requirements and storage-and-migrations.
- **Migration:**
  - two new tables, `migrations` and `migrated_documents`, created empty;
  - the one-off repairs run once more on the first boot after this change, then are recorded
    as done;
  - empty diagrams already stored are skipped rather than deleted.
- **Gateway:** no additional calls. Budgets are raised for the turn (16 000), answer
  suggestions (4 000) and the per-chapter check (12 000), because each of them came back
  empty at its old ceiling.
