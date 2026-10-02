# Switch account, fall back to Gemini, and show the writing as it happens

## Why

Four things a user of the running installation ran into:

- **No way to the administrator account.** Behind the proxy everyone is signed in by the
  header, the sign-in page sends a signed-in user home, and "Sign out" goes to the proxy or
  nowhere. An administrator who reaches Specman through the proxy cannot use the password
  that makes them one.
- **`PROXY_AUTH_TRUSTED_IPS` is the operator's burden, not a safeguard they asked for.**
  Turning proxy sign-in on is the operator saying the proxy is the only route and overwrites
  the header. Withholding administrator rights until a list of addresses is also kept
  correct made rights granted on the People page silently do nothing.
- **Gemini is configured but never used.** `GEMINI_API_KEY` and `GEMINI_MODEL` are read and
  documented as a fallback, and no code calls them. With only Gemini set, every assistant
  feature fails on the missing `LLM_URL`; with the primary down, nothing falls back.
- **The reply feels slow.** The model writes the chapter first and its short reply last, so
  for most of a turn the user watches an empty bubble, although text is arriving the whole
  time.

## What Changes

- **Accounts:**
  - a password or company sign-in takes precedence over the proxy's header, so an
    administrator can sign in with their own account behind the proxy;
  - "Sign out" leads everyone to the sign-in page. Behind the proxy, that page names the
    account the gateway signed them in as, offers to continue with it, and offers the
    password form; signing out of the password account returns them to the gateway's;
  - `PROXY_AUTH_TRUSTED_IPS` is removed. With proxy sign-in on, the header is believed and
    rights granted on the People page apply; failed sign-ins are counted against the caller
    the proxy names in `X-Forwarded-For`.
- **Models:**
  - a Gemini client with the same two call shapes — streamed prose and a forced tool call;
  - the primary gateway is used when it is configured; Gemini answers when it is not, and
    when the primary fails before anything of its answer has been passed on;
  - after the primary fails, it is left alone for two minutes, so every call of a turn does
    not wait through the same failure;
  - `/health/llm` reports which providers are configured and which one answered.
- **Live writing:**
  - the chapter being written appears in the document pane as it streams, marked as being
    written, and reverts if the turn fails;
  - the chat says what the assistant is doing — thinking, writing a named chapter with a
    word count, noting a rule, checking what is still open, saving — instead of a bare cursor.

## Impact

- Specs: access-control, llm-gateway, guided-interview, document-structure.
- Code: `hooks.server.ts`, `auth/index.ts`, `env.ts`, `llm/forwarded.ts`, `login`, `logout`,
  the layout; `llm/gateway.ts`, new `llm/gemini.ts`, `llm/gemini-format.ts`,
  `llm/fallback.ts`, `llm/transport.ts`; `llm/blocks.ts`, `api/chat`, the project page,
  `AgentChat.svelte`, `DocumentPreview.svelte`.
- Deployment: `PROXY_AUTH_TRUSTED_IPS` is ignored; `.env.example` and `docker-compose.yml`
  stop mentioning it. Gemini alone is now a working configuration.
