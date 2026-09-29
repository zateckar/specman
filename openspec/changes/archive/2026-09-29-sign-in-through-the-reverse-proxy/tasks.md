# Tasks

## 1. Specification

- [x] 1.1 Write the delta under `specs/access-control/spec.md`
- [x] 1.2 `npm run docs` passes

## 2. Implementation

- [x] 2.1 Import-free `src/lib/server/llm/forwarded.ts`: read the three headers into an
      identity, and decide whether a peer may assert them — both pure, so `npm test` covers
      the trust rule directly
- [x] 2.2 `PROXY_AUTH_ENABLED` (default on) and `PROXY_AUTH_TRUSTED_IPS` in `env.ts`
- [x] 2.3 `userFromProxy` in `auth/index.ts`: resolve or register the identity, always as an
      ordinary user, refusing a name that belongs to a local password account
- [x] 2.4 `hooks.server.ts` resolves the proxy identity before the session cookie, so the
      proxy wins where both are present
- [x] 2.5 Boot warning when enabled with no trusted peers configured
- [x] 2.6 Sign-out says what it can and cannot end when the session came from the proxy
- [x] 2.7 `.env.example` documents both settings and the risk

## 3. Migration

- [x] 3.1 Nothing stored changes shape — no backfill
- [x] 3.2 No document is rewritten, so nothing has to reach a repository

## 4. Verification

- [x] 4.1 `npm test` and `npm run check` clean
- [x] 4.2 Invariant test: an untrusted peer establishes nobody; a trusted one establishes
      exactly the named user and never an administrator
- [x] 4.3 Browser check: with no headers, the login page still offers both ways in
- [x] 4.4 Behind the real proxy — a first-time user is registered, appears on the people
      page as an ordinary user, and an administrator can grant them rights.
      Done against `scripts/proxy-sim.mjs`, which overwrites the headers the way the real
      gateway does. Two users registered on first sight, appeared as ordinary users, and a
      grant took effect on their next request; a header naming the other user still got 403.
      **This found a defect and it is fixed here**: the page reported both of them as
      "Cannot sign in yet", because it read only the password and company-account columns —
      neither of which a gateway account has. `users.created_via` now records how an account
      arrived, with a backfill for the two cases a stored row can still prove and a
      record-on-arrival for the one it cannot
- [x] 4.5 Confirm the proxy overwrites client-supplied `X-Forwarded-*` rather than adding to
      them. Confirmed by the operator on 2026-09-29: the proxy overwrites. This is the
      assumption the whole change rests on, and it is now answered rather than open
- [x] 4.6 Delta folded into `openspec/specs/` and this change archived
