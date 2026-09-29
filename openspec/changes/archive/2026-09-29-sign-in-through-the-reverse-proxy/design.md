# Design — sign in through the reverse proxy

## The question

A proxy-authenticated request arrives on every request, not once at a login. Does it
establish identity for that request only, or does it mint a session like the other two ways
in?

## Options

### A — Identity per request, no session

Read the headers in `hooks.server.ts`, resolve the user, done. Nothing is stored, no cookie
is set. The proxy is the session.

Simplest, and it cannot drift: the moment the proxy stops sending the header the user is
signed out, which is the correct behaviour and comes for free. It also means no session row
per request, and no cookie to leak.

Costs: every request pays a user lookup, which is one indexed SQLite read in-process — the
same cost the session lookup already pays. Sign-out has nothing to delete, so the existing
sign-out has to mean something different here.

### B — Mint a session on first sight

Take the headers once, create a session, set the cookie, and behave like the other two paths
from then on.

Costs the thing that matters: the application's session now outlives the proxy's. Someone
whose directory account is disabled keeps working here for up to fourteen days, because
their cookie is still valid and nothing rechecks the header. That is a real failure — it is
the exact scenario a proxy deployment is usually bought to prevent — and it would be
invisible.

## Decision

**A — identity per request, no session.**

The property that decides it is the one the project already states about ownerless work: an
arrangement that depends on something happening later is a plan with no owner. Option B's
correctness depends on a future revalidation that nothing performs. Option A has no later:
the answer is recomputed from the proxy's own assertion every time, so revocation is
immediate and requires no code.

This makes sign-out mean something different behind a proxy, and that has to be said rather
than discovered — the button cannot end a session the application did not create. Behind a
proxy it points at the proxy's own sign-out where one is configured, and where it is not it
says plainly that closing the browser is what ends the session.

The trusted-peer check lives with the header read rather than in a separate layer, because
the two are one decision: *may this caller assert who they are?* Splitting them invites a
future caller that reads the headers without asking.

## What this test does not say

The invariant test will say: **a request carrying proxy headers from an untrusted peer does
not establish a user, and a request carrying them from a trusted peer establishes exactly
the user named, never an administrator.**

It does not say the headers are true. Nothing in this application can determine that — the
test runs against the peer address the runtime reports, and if the deployment terminates
several proxies deep, that address is the nearest hop rather than the client. Configuring
`PROXY_AUTH_TRUSTED_IPS` correctly for a multi-hop deployment is an operator's job and this
test will pass whether or not they did it.

It also says nothing about the proxy overwriting client-supplied headers. That is point 1 of
the risk in the proposal, it lives entirely in the proxy's configuration, and no test here
can reach it.
