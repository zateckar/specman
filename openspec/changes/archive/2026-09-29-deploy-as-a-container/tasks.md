# Tasks

## 1. Specification

- [x] 1.1 Write the delta under `specs/deployment/spec.md`
- [x] 1.2 `npm run docs` passes

## 2. Implementation

- [x] 2.1 `GET /health` in `src/routes/health/+server.ts`: 200 only when the database opens,
      503 otherwise. No gateway call, no session required — `/health` is already public.
      **Correction to this proposal as written** — "when the database opens" is not the
      check it needed. SQLite holds the file open, so `SELECT 1` keeps answering long after
      the volume behind it has gone or been remounted read-only, which is exactly the failure
      a probe is for. The route now also tests the database directory for writability
- [x] 2.2 `Dockerfile`, multi-stage. Builder runs the real `npm run build`; the runtime stage
      carries production dependencies, the build output, **`git`**, and nothing else
- [x] 2.3 The runtime stage runs as a non-root user and owns `/app/data`, so a named volume
      mounted there is writable
- [x] 2.4 `.dockerignore` — keep `data/`, `.env`, `node_modules` and `build` out of the
      build context, so a local `.env` can never be copied into a published image
- [x] 2.5 `.github/workflows/build.yml`: test job (`npm test`, `npm run check`) gating a
      build-and-push job to `ghcr.io/<owner>/specman`
- [x] 2.6 A pull request builds the image but does not push it
- [x] 2.7 `docker-compose.yml`: named volume for `data/`, loopback-only port, `ORIGIN` and the
      proxy-trust settings present with the reasoning next to them, healthcheck on `/health`
- [x] 2.8 *(added while doing 2.2)* `engines.node` in `package.json`. The Node version is not
      a preference — `node:sqlite` is the database driver and the test scripts are TypeScript
      run without a compile step — and nothing said so anywhere

## 3. Migration

- [x] 3.1 Nothing stored changes shape — no backfill
- [x] 3.2 No document is rewritten, so nothing has to reach a repository

## 4. Verification

- [x] 4.1 `npm test` and `npm run check` clean
- [x] 4.2 `GET /health` returns 200 signed out, and 503 when the database cannot be opened.
      Both seen: 200 against a running server with no session; 503 with
      `EACCES: permission denied, access '/app/data'` after the data directory was made
      read-only under a running container. `/health/llm` still 403s unauthenticated, so it
      cannot be mistaken for the probe
- [x] 4.3 Build the image locally and run it: it creates a project, which proves `git` is
      present and `data/` is writable by the runtime user. Done — the image built, booted
      with the trusted-peers warning, and creating an application produced
      `/app/data/repos/container-smoke-test` with a real commit on `spec/0001`, owned by
      `node`
- [x] 4.4 Stop and recreate the container — the project is still there, which is what the
      volume is for. Done twice: `docker restart`, and a full `rm` followed by a fresh
      `docker run` against the same named volume
- [x] 4.5 Confirm the published port is not reachable from another interface. Loopback
      answered 200; the host's other address refused the connection outright.
      Also watched the declared healthcheck flip: healthy at 30s and 60s, unhealthy at 90s —
      three consecutive failures, as `--retries=3` says — and healthy again once repaired
- [x] 4.6 `README.md` deployment section, and `openspec/project.md` commands
- [x] 4.7 Delta folded into `openspec/specs/` and this change archived
