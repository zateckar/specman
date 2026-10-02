# Tasks

- [x] Security:
      - the return path checked as it will be sent;
      - administrator rights through the proxy only with trusted peers;
      - cross-site writes refused, and framing denied;
      - a 401 in words for `/api/`;
      - throttling against the caller the proxy saw;
      - OIDC discovery retried;
      - the session purge compared in the stored format;
      - a signed-in user's sign-in form sent home.
- [x] Interview:
      - the revision trigger excludes the verdict, and the verdict is guarded per chapter;
      - a reply that writes nothing is not checked;
      - a refused reply is not stored;
      - taken section keys are claimed under the parent;
      - unfiled rules and decisions are reported, and restated rules matched;
      - an empty reply is reported;
      - a heartbeat on the stream;
      - in-stream overload retried before any text, and an idle limit on every call;
      - delegated choices attributed to the assistant, and `standard` refused from the model;
      - an empty chapter never complete, and an assessment budget;
      - presence kept for as long as a turn writes;
      - loose tags and unquoted attributes read.
- [x] Repository:
      - a missing history refused and reported;
      - repositories followed at boot;
      - a stale `index.lock` cleared;
      - a commit confirmed from `HEAD`;
      - including a chapter always commits and inherits its standards.
- [x] Interface:
      - a pane switch on narrow windows;
      - a failed send restores the answer;
      - the review page in chapters and events, with "nothing to review";
      - approval failures in words, without claiming a commit that failed;
      - page titles and an error page;
      - the home form keeps what was typed;
      - the export page's version note, and warnings in the bundle;
      - set-aside chapters marked in the preview;
      - keyboard access to boxes with no chapter;
      - a standard's examples editable.
- [x] Fold the requirements into the specifications. Record the lessons and the remaining
      limits in `PLAN.md`. Document `LLM_IDLE_TIMEOUT_MS` and the proxy's administrator rule in
      `.env.example` and `docker-compose.yml`.
- [x] Verify in a throwaway instance behind the sign-in proxy, with a stub gateway, a separate
      database and no `.env`.

## Validation

- `npm test`: 461 agent checks, 14 repository checks and 239 boundary checks pass, and the
  documentation check is clean. `npm run check` reports no errors and `npm run build` passes.
- In the running instance:
  - administrator rights are withheld through the proxy without trusted peers and honoured
    with them;
  - a standard's examples are edited, and an unreadable line is refused, quoted, with the
    typed values kept;
  - the home form keeps what was typed;
  - including a chapter commits and inherits its standard;
  - a turn writes prose, a rule, options and a commit, and a restated rule is not duplicated;
  - an empty reply, an in-stream overload, "you decide" and an unfiled rule each behave as
    specified, and heartbeats arrive every 15 seconds;
  - framing is denied, `/api/` answers 401 in words, and a sign-in redirect keeps the query;
  - the review page shows chapters, gaps and events, and nothing to review after approval;
  - the export notes its version and carries warnings;
  - the narrow-window pane switch and the "Not needed" badge;
  - a repository is followed at boot, and a missing one is refused in words without being
    made again.
- Defects the running instance found, fixed here:
  - a refused standard lost the rest of the edit;
  - the cross-site finding was a false positive, because SvelteKit already refuses form
    posts; the check is kept as a second line and its comment says so;
  - with the history missing, the review page said everything was already approved. It now
    says the history is missing, and "nothing to review" no longer claims approval.
- Not driven in the browser, covered by tests and types only: keyboard access to diagram
  boxes, OIDC discovery retry, and the session purge.
