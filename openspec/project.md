# Project context

## Purpose

Specman interviews a non-technical colleague about the application they need and writes
their design document for them. They never edit the document; they only talk. Every
application gets its own Git repository, and changes are reviewed as a proposal before
they are merged.

The audience is the constraint that decides most arguments: the user is a person who
commissions software, not one who builds it. Notation may be *stored* — `SHALL`,
`WHEN`/`THEN`, ArchiMate — but it is never *shown*.

## Stack

| | |
|---|---|
| Framework | SvelteKit 2, Svelte 5 (runes), `adapter-node` |
| Language | TypeScript, ESM |
| Database | `node:sqlite` (`DatabaseSync`) — no ORM, no driver dependency |
| Git | `simple-git`, one repository per application |
| Model access | One gateway, Anthropic Messages API shape, not answered by Claude |
| Tests | plain Node (`node scripts/test-agent.mjs`) — no test runner |

## Commands

| | |
|---|---|
| `npm run dev` | development server on :5173 |
| `npm run check` | type-check (`svelte-check`) |
| `npm test` | agent tests **and** the documentation check |
| `npm run docs` | the documentation check on its own |
| `npm run verify` | Lean 4.34.1 protocol proofs and axiom audit |
| `npm run build` | production build |
| `docker compose up -d` | run the published image; set `SPECMAN_IMAGE` first |
| `GET /health` | liveness — 200 while storage is readable and writable |

Behind the gateway there is no login page, so nothing in the application can be reached from
a browser on a developer's machine unless something in front supplies the headers. That is
`node scripts/proxy-sim.mjs --port 6001 --target http://127.0.0.1:5199 --user novak.jan`.
It overwrites `X-Forwarded-*` rather than adding to them, which is the behaviour the real
proxy must also have — run two on different ports to be two colleagues at once. It
authenticates nobody; never put it in front of anything real.

## Conventions that are not negotiable

These are the rules the codebase has paid for. Each one exists because its absence caused
a failure that reached a user, and each is a requirement in the specification it governs.

- **Deterministic first, model second.** Anything that must hold is enforced in code; the
  prompt is the first layer only. The served models drop instructions, so a rule that lives
  only in the prompt is a rule that sometimes does not exist.
- **Long output rides the text stream, never a tool argument.** Truncation inside a tool
  call is a hard HTTP 400 with no usable content. Tool arguments carry a key, an enum, a
  short question — nothing that grows.
- **`max_tokens` is working room for reasoning, not the size of the answer.** The served
  model thinks before it writes, out of the same budget. Three features have returned
  nothing because of this.
- **No developer notation reaches the user.** Storage format and display format are
  separate decisions.
- **Pure modules are testable modules.** Logic that must be tested lives import-free under
  `src/lib/server/llm/` so `npm test` can load it directly.
- **Adding a capability migrates nothing.** A new column, condition or arrangement needs an
  explicit backfill for databases that already exist. This has bitten three times.
- **An instruction that depends on a future turn is a plan with no owner.** If work must
  happen, the server does it when the trigger occurs.

## Layout

```
src/lib/server/llm/     gateway client, the agent, and the pure logic modules
src/lib/server/db/      schema, queries, seeded template and standards
src/lib/server/git/     one repository per application
src/lib/server/auth/    sessions, password login, OIDC
src/lib/components/     the three panes and the diagram
src/routes/             pages and the SSE/JSON endpoints
openspec/               these specifications
scripts/                tests, the documentation check, the proxy stand-in
formal/                 Lean protocol models and their implementation mapping
Dockerfile              the published image — note that it installs git
docker-compose.yml      how it is meant to be run, with the reasoning inline
.github/workflows/      tests gate the image build; a pull request never pushes
```

## Where the truth lives

- **Git** holds chapter prose for each application. `chapters.content_md` is a read cache.
- **SQLite** holds everything else: status, transcript, requirements, decisions, templates.
- **`openspec/specs/`** holds what this codebase does today. If the two disagree, one of
  them is a bug — see `openspec/AGENTS.md`.
