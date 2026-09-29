# Working in this repository

Specman interviews a non-technical colleague about the application they need and writes
their design document. The audience decides most arguments: the user commissions software,
they do not build it.

## Before you change anything

Read [`openspec/AGENTS.md`](openspec/AGENTS.md). It is short, and it is the working
agreement. [`openspec/project.md`](openspec/project.md) has the stack, the commands, and the
rules that are not negotiable.

## The documentation rule

**No change is finished until the specification agrees with it.**

This is checked, not trusted. `npm test` runs `scripts/check-docs.mjs`, which fails when:

- a capability has no purpose, no sources, or a requirement with no scenario;
- a file under `src/` is claimed by no capability, or by two;
- a `## Source` list names a file that no longer exists;
- a change folder has no proposal, no tasks, or no spec delta.

So, in practice:

| you change | you also change |
|---|---|
| behaviour of an existing area | the requirements in `openspec/specs/<capability>/spec.md` |
| add, rename, move or delete a file under `src/` | that capability's `## Source` list |
| something large enough to argue about | a folder under `openspec/changes/`, before writing code |
| why a thing is done this way, with evidence | `README.md` |
| what is not built, or a lesson learned | `PLAN.md` |

A hook prints which specification governs each file you edit, and a second one runs the
full check when a turn ends. Neither is a substitute for running `npm test`.

## The standing rules

Written up with their evidence in `README.md`; repeated here because each was paid for.

- **Deterministic first, model second.** Anything that must hold is enforced in code. The
  served models drop instructions, so a rule that lives only in the prompt is a rule that
  sometimes does not exist.
- **Long output rides the text stream, never a tool argument.** Truncation inside a tool
  call is a hard HTTP 400 with nothing usable in it.
- **`max_tokens` is working room for reasoning, not the size of the answer.** An empty
  result usually means the budget, not the parser. The tell is an output-token count landing
  exactly on the ceiling.
- **No developer notation reaches the user.** `SHALL`, `WHEN`/`THEN` and ArchiMate are
  storage; the interface renders plain sentences.
- **Adding a capability migrates nothing.** A new column, condition or arrangement needs an
  explicit backfill, and a document the backfill rewrites has to reach its repository too.
- **An instruction that depends on a future turn is a plan with no owner.** If the work must
  happen, the server does it when the trigger occurs.
- **An invariant test proves what it says and nothing more.** Ask what the test does *not*
  say. "No connector passes underneath a box" held while four routes ran off the edge of the
  picture.

## Commands

```bash
npm test        # agent tests and the documentation check
npm run check   # svelte-check
npm run docs    # the documentation check on its own
npm run dev     # development server on :5173
```

Pure logic goes in import-free modules under `src/lib/server/llm/` so `npm test` can load
them directly. There is no test runner; `scripts/test-agent.mjs` is plain Node.

## Secrets

`.env` holds a live gateway key, a Gemini key and the admin password, and is excluded by
`.gitignore` along with `data/`. Do not read them back into the conversation, do not paste
them into a form, and do not commit either path.
