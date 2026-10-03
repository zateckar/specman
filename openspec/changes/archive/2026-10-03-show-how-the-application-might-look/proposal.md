# Show how the application might look

## Why

The document says what the application must do, in words. A colleague who commissions
software reacts to a screen far more readily than to a chapter: seeing a list they would
work from, or a form with the fields they named, is when "that is not how we do it" gets
said. Today the only picture Specman draws is the architecture diagram, which shows how the
parts fit together, not what anyone would see.

So, as the diagram is drawn on request, the assistant can make a mock-up: one clickable page
in plain HTML, CSS and JavaScript, with invented sample data, showing one way the
application could look. It is inspiration and a prompt for corrections, not a design anyone
has agreed, and it can be downloaded as a single file that opens in any browser.

## What Changes

- **A mock-up page per application**, reached from the workspace beside the diagram. It
  offers to make a mock-up, shows the latest one, says when it was made and whether the
  document has changed since, and offers it at laptop and phone width, full screen, and as a
  download.
- **Made by the server in the background:** one streamed call writes the whole page, sharing
  the three places for long calls with drafting. It takes minutes, so the page shows progress,
  may be left, and can stop it; the mock-up is kept when it finishes. A reply that does not
  finish, or depends on files from the internet, is asked for once more, smaller and
  self-contained.
- **Shown where it cannot do harm:** the model writes JavaScript, so the page is shown only in
  a sandboxed frame, served with a policy that lets it load and send nothing and reach nothing
  of Specman's, the colleague's session or the page around it. The downloaded file carries the
  same limits inside it. Enforced by the response and the file, not asked for in the prompt;
  storage and dialogs, which the sandbox takes away, get stand-ins so an ordinary page still
  works.
- **Only the latest is kept**, in the database. It is not part of the document, is not
  committed to the application's repository and is not in the handoff, because everything in
  it beyond what the document says is invented.
- **Nothing that reads the document as finished runs beside a draft:** making a mock-up waits
  for a running draft, as the diagram does. Making one is looking, not touching: an untouched
  draft keeps its mark.

## Impact

| | |
|---|---|
| Capabilities | new `mock-up`; `whole-document-draft` (refused while drafting; not a touch; the shared limit on long calls); `access-control` (the mock-up's own frame is the one page that may be framed, and only by Specman) |
| Migration | One new table, `mockups`, created on boot. No application has a mock-up yet, so there is nothing to backfill, and no document changes. |
| Gateway | Nothing per turn. A mock-up is one long streamed call, two at most, on request. |
