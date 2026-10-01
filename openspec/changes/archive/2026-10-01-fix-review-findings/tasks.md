# Tasks

- [x] Security: links and images, the return path, sign-in throttling and timing, the OIDC
      nonce, and proxy adoption of company accounts.
- [x] Interview:
      - parser recovery and filing;
      - a gateway-valid conversation;
      - plain failure messages;
      - turn budgets;
      - set-aside chapters reopened by writing into them;
      - standards protected from deletion.
- [x] Decisions, review and repository:
      - a discard reopens the chapter and asks again;
      - a 409 when another window settled it first;
      - idempotent confirmation;
      - the review page reloads after a check;
      - validation findings quote the rule;
      - a resumable `ensureRepo`;
      - manifest errors raised.
- [x] Storage:
      - one-off repairs run once;
      - booting is one transaction;
      - backfills run only with their column;
      - repaired documents stay recorded until committed;
      - creation is atomic and rolls back;
      - reserved and taken folder names are avoided.
- [x] Interface:
      - a failed redraw keeps the last good diagram;
      - the diagram is accessible, and wires cannot cross the layer names;
      - long names wrap;
      - the chat has a turn lock, drafts per chapter, focus and live regions;
      - set-aside chapters can be included;
      - home cards match the index;
      - admin validation;
      - a clipboard fallback;
      - no `state_referenced_locally` warnings.
- [x] Fold the requirements into the specifications. Record the lessons and the remaining
      limits in `PLAN.md`.
- [x] Verify in a throwaway instance behind the sign-in proxy, with a stub gateway, a separate
      database and no `.env`.

Validation:
- 411 agent checks, 10 repository checks and 208 boundary checks pass.
- `svelte-check` reports no errors and no warnings.
- The production build passes.

The interface was driven in the browser pane against the throwaway instance. Confirmed there:
- an application named "Con" is stored as `con-app`;
- including a set-aside chapter moves the count from 9 to 10 and commits;
- while another chapter's turn runs, Send and Start are disabled, and the typed answer
  survives switching chapters;
- the reply stays on screen and focus returns to the answer box;
- a failed redraw keeps all six boxes and shows a plain alert;
- keyboard focus outlines a box and fades what it does not connect to;
- with the clipboard API removed, the export text is selected and the user is told to press
  Ctrl+C;
- the home card's total matches the index.

The verification found one defect, fixed before archiving: the diagram's failure message
claimed "Your message is saved" when no message had been sent.
