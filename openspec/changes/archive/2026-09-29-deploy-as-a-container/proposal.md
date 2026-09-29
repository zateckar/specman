# Deploy Specman as a container

## Why

Specman has been run from a developer's machine with `npm run dev` and a `.env` file beside
it. Nothing in the repository says how it is meant to run anywhere else: which Node version,
that it needs `git` on the PATH at all, which directory has to survive a restart, or which of
the twelve settings in `.env.example` are required rather than optional. Somebody deploying
it has to read the source to find out, and the one who reads it wrong loses every design
document on the first container restart — `data/` holds both the database and every
application's Git repository, and an image with no volume behind that path throws it away
without an error.

The deployment this is for has an authenticating reverse proxy in front, which is already
built and already flagged in `PLAN.md` as resting on two assumptions the application cannot
check for itself: that the proxy overwrites `X-Forwarded-*`, and that nothing else can reach
the port. The second one is a deployment decision and has never been written down anywhere it
would be read at the moment it is made. Publishing the port to every interface is the single
mistake that turns header sign-in into "anyone who can route to the host is an administrator",
and it is one line of a compose file.

## What Changes

- Specman ships as a container image, built and published by GitHub Actions to the GitHub
  Container Registry on every push to `main` and every tag.
- The image is built only after `npm test` and `npm run check` pass, so an image that exists
  is an image whose specification agrees with its code.
- A `docker-compose.yml` that runs it the way it is meant to be run: a named volume for
  `data/`, the port published **to the loopback interface only**, and the proxy-trust
  settings present and commented rather than left to be discovered.
- `GET /health` answers whether the server can serve — process up *and* database openable.
  `/health/llm` already exists and is deliberately not this: it is administrators-only and
  spends gateway quota, so nothing can use it as a probe.
- `README.md` gains a deployment section: what the image needs, what must persist, and what
  has to be true of whatever sits in front.

**Not breaking.** No stored data changes shape. An installation running from a checkout keeps
working exactly as it does now; `npm run dev` is untouched.

## Impact

| | |
|---|---|
| Capabilities | `openspec/specs/deployment/` — new: how the server is run, configured and probed |
| Migration | none — nothing stored changes shape |
| Gateway | none — the liveness probe makes no gateway call, which is the point of it |

The container needs `git` installed, because `simple-git` shells out to the real binary and
every application is a real repository. A Node image without it starts cleanly and fails on
the first project anyone creates.
