# Specman

[![Build](https://github.com/zateckar/specman/actions/workflows/build.yml/badge.svg)](https://github.com/zateckar/specman/actions/workflows/build.yml)

AI-guided application design for non-technical users. A colleague describes the application
they need; an agent interviews them, chapter by chapter, and writes the design document. They
never edit it directly, and the index always shows what is still left to decide.

Every application gets its own Git repository. Changes are proposed on a branch and approved
before they reach `main`, and approval also writes a build-ready `spec/` for a developer.

## Running it

```bash
npm install
cp .env.example .env   # gateway URL and key, model names, admin password
npm run dev            # http://localhost:5173
```

First boot creates an `admin` account from `ADMIN_PASSWORD`, only while there are no users.

| | |
|---|---|
| `npm test` | unit tests **and** the documentation check |
| `npm run check` | type check |
| `npm run build` | production build |
| `node scripts/proxy-sim.mjs` | stand in for the authenticating gateway, to sign in locally |

## Deploying it

The image `ghcr.io/zateckar/specman` is built by GitHub Actions, and only after the tests and
the documentation check pass.

```bash
cp .env.example .env
docker compose up -d
```

`docker-compose.yml` explains itself inline. Three settings in it matter more than the rest:

- **`/app/data` is a volume.** It holds the database *and* every application's repository.
  Without it, a new image silently starts empty.
- **The port is bound to loopback.** Specman trusts `X-Forwarded-User` from the gateway in
  front. Anyone who can reach the port directly can claim to be anyone.
- **`ORIGIN` is the public URL.** If it is wrong, every form fails, including sign-in.

`latest` follows `main`; pin a release or `sha-<commit>` with `SPECMAN_IMAGE`. A new GHCR
package is private until you make it public or `docker login` on the host.

## Documentation

Specman's own documentation is [OpenSpec](openspec/AGENTS.md), and it is checked, not
trusted: `npm test` fails when a file under `src/` belongs to no capability, or when a
requirement has no scenario.

| | |
|---|---|
| [`openspec/AGENTS.md`](openspec/AGENTS.md) | how to change anything — read first |
| [`openspec/project.md`](openspec/project.md) | stack, layout, the rules that are not negotiable |
| [`openspec/specs/`](openspec/specs/) | what the application does, and why, one capability per folder |
| [`PLAN.md`](PLAN.md) | what is not built yet, and lessons carried forward |
