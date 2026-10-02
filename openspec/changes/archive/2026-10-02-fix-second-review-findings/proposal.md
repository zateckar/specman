# Fix what the second application review found

## Why

A second review of the whole application, a day after the first was fixed, found faults
that the first had not reached, and a few that its fixes had introduced:

- **Security:** a return path that left the site through a dot segment; proxy sign-in that
  carried administrator rights from any caller while no trusted address was configured;
  pages that another site could frame; and sign-in throttling that, behind the proxy, locked
  everyone out together. The review also suspected that another site's page could post
  `text/plain` to the conversation endpoints. The running instance showed that SvelteKit's own
  origin check already refuses that; a check of every content type is added as a second line.
- **Interview:** the document revision counted the assessor's verdict as a change, so a
  colleague's question back failed a slower turn and threw its work away; an arrangement
  whose section key was already taken failed the whole reply; rules and decisions with
  nowhere to go were dropped without a word; an empty reply ended the turn as if answered;
  a quiet model was cut off by the proxy; a refused reply stayed in the transcript claiming
  what it had recorded; "you decide" was stored as the user's own choice.
- **Repository:** a missing repository was quietly started again empty; the stored path tied
  every repository to the folder the server was started in; a lock left by a killed git
  failed every commit after it; a commit that recorded nothing read as "nothing changed".
- **Interface:** the document pane could not be reached on a narrow window; a refused send
  lost the typed answer; the review showed diff notation, hashes and rule references, and
  offered Approve for an empty difference; every tab was titled "Specman"; errors showed a
  status code; a standard's examples could not be edited with its wording.
- **Messages:** several said what is true in the usual case and untrue in the one they were
  shown in — see `PLAN.md`.

## What Changes

- **Security:**
  - the return path is checked as it will be sent;
  - administrator rights pass through the proxy only with `PROXY_AUTH_TRUSTED_IPS` set;
  - cross-site writes to `/api/` are refused whatever their type, and framing is denied;
  - a signed-out call to `/api/` is answered 401 in words;
  - failed sign-ins are counted against the caller the proxy saw;
  - a failed OIDC discovery is retried, and expired sessions are purged on the right day.
- **Interview:**
  - the revision counts the document, not the verdict on it, and a verdict is guarded by its
    own chapter;
  - a reply that writes nothing is not checked for conflicts;
  - a refused reply is not stored;
  - taken section keys are prefixed with the parent;
  - unfiled rules and decisions are reported;
  - restated rules and lower-case references match what exists;
  - an empty reply is reported;
  - a heartbeat keeps a quiet stream open;
  - an overloaded backend reported inside the stream is retried before any text;
  - a silent gateway call is given up on after `LLM_IDLE_TIMEOUT_MS`;
  - a delegated choice is the assistant's, and a model cannot call its choice a standard;
  - a chapter with no prose is never complete, and the assessment has a reasoning budget.
- **Repository:**
  - an application with a history is refused a new empty repository, and told so;
  - repositories are followed to this installation's folder at boot;
  - a stale `index.lock` is cleared;
  - a commit is confirmed from the repository rather than from git's output;
  - including a chapter commits even when it was included before, and inherits the
    standards filed under it.
- **Interface:**
  - a Conversation / Document switch on narrow windows;
  - a failed send puts the answer back and says why;
  - the review reads as chapters and events, and says when there is nothing to review;
  - every page names itself;
  - errors are explained in words;
  - the home form reopens as submitted;
  - the export page says which version it shows, and the bundle lists the warnings too;
  - the preview marks set-aside chapters;
  - diagram boxes with no chapter can be reached by keyboard;
  - a standard's examples are edited in "If …, then …" form.

## Impact

- **Capabilities:**
  - access-control, application-repository, architecture-diagram, change-review;
  - chapter-progress, company-standards, decisions, developer-handoff;
  - document-structure, document-validation, guided-interview, llm-gateway;
  - project-setup, requirements, storage-and-migrations.
- **Deployment:** an installation whose administrators arrive through the proxy with
  `PROXY_AUTH_TRUSTED_IPS` empty loses their administrator rights through the header until it
  is set. The boot warning, `.env.example` and `docker-compose.yml` say so. A new optional
  setting, `LLM_IDLE_TIMEOUT_MS`, defaults to three minutes.
- **Migration:**
  - the chapter revision trigger is rebuilt on every boot from the table's columns;
  - the boot that adds chapter goals records each rewritten application for a commit;
  - stored repository paths are corrected at boot where the repository is found under
    `data/repos/<slug>`.
  - No data is rewritten otherwise.
- **Gateway:** no additional calls. The assessment's budget is set to 6 000 tokens. A stream
  that reports an overloaded backend before any text is retried, as a 5xx already was.
