# Sign in through the reverse proxy

## Why

Specman is to be deployed behind a reverse proxy that has already authenticated the caller
against the company directory. Making the user sign in a second time, to the same directory,
through a second redirect chain, is a worse experience than the deployment is capable of —
and it means the application maintains a session alongside the proxy's, which can disagree
with it.

Where a proxy is in front, it passes on who it authenticated:

| header | meaning |
|---|---|
| `X-Forwarded-User` | the account name the proxy authenticated |
| `X-Forwarded-Email` | their address |
| `X-Forwarded-Preferred-Username` | the name they are known by, when it differs |

Taking these is enough to sign someone in with no interaction at all.

## What Changes

- When the headers are present, the request establishes a signed-in user without a login
  page. The person is registered locally on first sight, exactly as company sign-in does, as
  an ordinary user whose rights an administrator grants.
- When they are absent, nothing changes: the login page appears with company sign-in and,
  behind it, a local password.
- Controlled by `PROXY_AUTH_ENABLED`, **on by default**.
- A trusted-peer list, `PROXY_AUTH_TRUSTED_IPS`, restricts which callers may assert these
  headers. Unset means any caller may — see the risk below — and the server says so on boot.
- **Breaking:** none. An installation with no proxy sees no change, because a request that
  carries none of these headers behaves exactly as it does today.

## The risk this carries, stated plainly

An HTTP header is not a credential. It is a string the caller chose. Trusting
`X-Forwarded-User` is safe only while the proxy is the *only* way to reach the application,
because it rests on two things being true at once:

1. The proxy sets these headers on every request it forwards, overwriting anything the
   client sent — if it merely *adds* them, a client can send their own.
2. Nothing else can reach the application's port.

Where both hold, this is the standard and correct arrangement. Where either fails, it is a
complete authentication bypass: `curl -H 'X-Forwarded-User: admin'` becomes a sign-in as any
user, and creates that user if they do not exist.

The mitigations here are deliberate and partial:

- `PROXY_AUTH_TRUSTED_IPS` makes point 2 enforceable in the application rather than assumed
  of the network. It is the setting that turns "we believe nothing else can reach us" into
  something checked.
- Header sign-in never grants administrator rights, and never grants them to an account that
  already has them by another route. The worst a spoofed header can do is become an ordinary
  user.
- The account is refused if the name belongs to a local password account, on the same
  reasoning as company sign-in: a name is not proof of identity.

What is *not* mitigated: with no trusted list configured, an attacker who can reach the port
directly can be any ordinary user, and read every application's unreleased design. The
default is on because the intended deployment always has a proxy; the warning exists because
the unintended one does not.

## Impact

| | |
|---|---|
| Capabilities | `openspec/specs/access-control/` — a third way of establishing identity |
| Migration | none — no stored data changes shape; users arriving this way are created on sight, as they are through OIDC |
| Gateway | none |
