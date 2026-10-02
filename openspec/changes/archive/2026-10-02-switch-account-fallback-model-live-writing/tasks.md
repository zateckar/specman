# Tasks

- [x] Accounts:
      - a session ahead of the proxy's header;
      - "Sign out" to the sign-in page, which offers the gateway's account and the form;
      - `PROXY_AUTH_TRUSTED_IPS` removed, rights from the People page honoured through the
        header, attempts counted against the forwarded caller.
- [x] Models:
      - shared transport (errors, idle limit, back-off);
      - a Gemini client for streamed prose and forced tool calls, translated by an
        import-free module;
      - a provider that uses the primary when configured and Gemini when not, or when the
        primary fails before passing anything on, with a two-minute rest for a failed primary;
      - `/health/llm` names the providers.
- [x] Live writing:
      - the parser exposes the block being written;
      - the turn sends what is being written and what the assistant is doing;
      - the page shows the chapter as it is written, and the chat says what is happening.
- [x] Fold into the specifications; `PLAN.md`, `.env.example`, `docker-compose.yml`,
      `README.md` where they mention the removed setting.
- [x] Tests for the translation, the fallback rule, the parser's partial block, the
      forwarded address and the account switch.
- [x] Verify in a throwaway instance behind the sign-in proxy, with a stub gateway and a stub
      Gemini, a separate database and no `.env`.

## Validation

- `npm test`: 509 agent checks, 14 repository checks and 264 boundary checks pass, and the
  documentation check is clean. `npm run check` reports no errors and `npm run build` passes.
- The suite blanks `GEMINI_API_KEY` before loading anything, so no fallback test can read the
  real key from `.env` and reach Google.
- In the running instance, behind a proxy signing everyone in as `verifier`:
  - "Sign out" led to the sign-in page, which named the gateway's account, offered to continue
    as it, and showed the password form open;
  - the administrator's password signed in behind the proxy, with the administrator's pages;
  - signing out of it returned to the sign-in page, and "Continue as verifier" back to the
    gateway's account;
  - rights granted to `verifier` on the People page applied through the header, with no
    address list configured;
  - a turn showed "Thinking…", then "Writing “Overview” — 5 … 56 words so far…" while the
    document pane showed the chapter growing under "being written…", then the reply, with the
    stored chapter and its status in place;
  - with the primary answering 401, the turn was answered by Gemini at once, and the
    completeness call after it went to Gemini without trying the primary again;
  - with the primary not configured at all, turns and `/health/llm` were answered by Gemini and
    the primary was never called; the health report named Gemini alone;
  - with the primary failing part-way through the chapter, the user was told in words, the
    pane went back to the stored chapter, and Gemini was not asked to repeat the turn.
- Not driven in the browser, covered by tests only: a Gemini refusal or budget exhaustion, a
  stalled primary turning to Gemini without retrying, and the company sign-in button from the
  switch page.
