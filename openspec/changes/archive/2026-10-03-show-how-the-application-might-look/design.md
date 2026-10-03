# Design — Show how the application might look

## The questions

1. Where the model's page is shown, given that it is JavaScript nobody has read.
2. Whether making it is a request the page waits on, or work the server owns.
3. What the model is given, what is kept, and what counts as a usable reply.

## 1. Showing a page the model wrote

The page is untrusted code. A colleague's document is model input, so a sentence in it can
steer what the script does, and the model can write a broken or hostile script without being
asked. Whatever shows it must hold no matter what it contains.

### A — `<iframe srcdoc>` with a sandbox attribute

The HTML travels inside the workspace page. A `srcdoc` document inherits the policy of the
page around it rather than having its own, so restricting its network means a policy spliced
into the model's markup. The download would not be covered at all.

### B — a blob or data URL

Same inheritance problem.

### C — its own address, served with its own policy, shown only in a frame (chosen)

`/projects/<id>/mockup/view` answers with the stored page and a `Content-Security-Policy`:

    sandbox allow-scripts allow-forms;
    default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
    img-src data: blob:; font-src data:; media-src data: blob:;
    connect-src 'none'; form-action 'none'; base-uri 'none';
    frame-ancestors 'self'

- `sandbox` without `allow-same-origin` gives the document an opaque origin. It cannot read
  Specman's cookies or storage or the page around it. Any request it makes carries
  `Origin: null`, which the `/api/` cross-site check refuses.
- `default-src 'none'` with `connect-src 'none'` stops it fetching, or loading a script, style
  or image from anywhere. Inline script and style are what it is made of.
- `allow-forms` is needed for a mock-up's submit handler to run at all: a sandbox without it
  drops the submission before the `submit` event fires. `form-action 'none'` stops a form
  going anywhere.
- No `allow-modals`. Dialogs from a sandboxed frame are suppressed by some browsers anyway.
  In a page of its own, a `prompt()` would ask for something under Specman's host name.
- No `allow-top-navigation`, `allow-popups` or `allow-downloads`.
- `frame-ancestors 'self'` with `X-Frame-Options: SAMEORIGIN`: Specman may frame it, nobody
  else may. Browsers prefer `frame-ancestors` and match `'self'` against the response's URL,
  not the sandboxed document's opaque origin. The hook that denies framing everywhere now
  keeps `SAMEORIGIN` when a response set it, and replaces anything else with `DENY`, so no
  response can be framed by another site.

**Only in a frame (review finding).** In a tab of its own the page would sit on Specman's
real origin, with the colleague's session, protected by the response header alone. Something
between Specman and the browser that dropped the header — a rewriting proxy — would leave the
model's script running as Specman. The frame repeats the sandbox in Specman's own markup, so
there it holds whatever happens to the header. So the address refuses a request whose
`Sec-Fetch-Dest` says anything but `iframe`, and the page offers full screen, which keeps the
frame, instead of a tab of its own. A browser that sends no `Sec-Fetch-Dest` is answered,
with the header.

**The file carries its own limits (review finding).** A downloaded file opened from a disk or
an email comes with no header. The page as kept has, first in its head:

- the encoding, for Czech text opened from a disk;
- the same policy as a `<meta>`, without `sandbox` and `frame-ancestors`, which have no
  effect there;
- a viewport, if it has none.

A policy in the page can only narrow what a header allows, so it changes nothing when the
page is served. It also gets a doctype if it has none, so it is never drawn in quirks mode.

**Stand-ins for what the sandbox takes away (review finding).** With an opaque origin,
`localStorage`, `sessionStorage` and `document.cookie` throw. A model's script touches them
as the page starts, and one throw there leaves the whole mock-up dead. A short script, ahead
of anything of the page's own, gives them in-memory stand-ins. It also turns `alert`,
`confirm` and `prompt` into a note on the page, answering a question yes so the mock-up goes
on. The prompt also says to keep changes in memory; the stand-ins are there because the
models drop instructions.

**Accepted:** a sandboxed frame can still navigate itself, and a few channels are governed by
no policy: link hints and WebRTC. A script could carry something out that way. What it holds
is its own markup, made from a document the colleague can already read; it has no cookie, no
session and nothing of Specman's. The page says not to type anything real into it.

## 2. A request, or the server's work

### A — a request, like the diagram

The diagram is a POST the page waits on. A mock-up is the size of a drafted chapter or larger.
The live draft measured about six minutes for 14 000 output tokens, and a proxy in front of
Specman is under no obligation to hold a silent request that long. Closing the tab would lose
the work.

### B — a job the server owns (chosen)

As with a draft: the POST starts the job and returns, the job saves the mock-up when it
finishes, and the page reads progress from `/api/mockup` every few seconds. One job per
application, in memory.

- **A shared limit (review finding).** A mock-up's call takes one of the same three places as
  a drafted chapter's (`longCalls`, moved from `drafting.ts` into `llm/parallel.ts`).
  Otherwise each colleague's mock-up was one more long stream on a shared gateway, uncounted.
  While it waits for a place, the page says so.
- **Stopping it.** A click by mistake holds a place for minutes. The page offers Stop while a
  job runs.
- **A restart** loses a job part-way, and nothing is stored until the end, so the last
  mock-up stays. The page that was following it sees it gone with nothing new and no reason,
  and says it stopped before it was finished.
- **Deleting an untouched draft** stops its mock-up after the deletion stands, inside the
  repository lock. A refused deletion leaves a good job running.

Progress is what the stream shows: waiting, thinking, then writing, with the size written so
far. A page that changes nothing for minutes looks broken.

## 3. Input, budget, output

**Input.** Every chapter that applies is given, in reading order, with its prose and its
first-version rules as statements, at most twenty a chapter.

- Prose is cut to 3000 characters a chapter, shared out from 45 000 when there are many
  chapters, never below 600 each.
- Rules for later and out of scope are not given, because what is not shown cannot be
  mistaken for the first version. Set-aside chapters are left out.
- No chapter key is privileged, so a custom template gets the same treatment.
- A document with no prose in any chapter is refused before a call is made.

**Budget.** `max_tokens` 32 000. It is working room for the reasoning as well as the answer:
a page of 30 KB is around 9 000 tokens before any thinking. The largest live draft used
14 261 of 16 000. That the gateway accepts the figure is checked live.

**Two calls, found live.** As first built, one call decided the screens and wrote the page. On
the live gateway it reasoned for five minutes until all 32 000 tokens were gone and wrote no
page. That is the diagram's lesson again: naming the parts and connecting them in one call
spent its whole budget too. So the work is now split the same way.

- A first call, with 16 000 tokens of room, decides the screens. It lists at most six, each
  with who uses it, what is on it and the sample records, between `<screens>` tags, in plain
  lines. Live, it took forty seconds and 4 606 tokens.
- The page call is given that list, clipped to 8 000 characters, after the document. It is
  told the screens are decided and to write at once. Writing from a decided list is nearly
  mechanical.
- Both calls hold one place among the three long calls, one after the other.
- When deciding runs out of room or writes no list, the page call decides the screens itself,
  as the single call did. When it cannot reach the gateway, no page is asked for.

**Compact from the first attempt, found live.** With the screens decided, the first page call
still reasoned until 32 000 tokens were gone. The retry, asked for "the three or four most
important screens, a few rows of sample data, compact CSS", worked out its page in eighty
seconds. It wrote 21.5 KB in another minute, 14 764 tokens in all, and the page was a good
one: three roles, a booking that showed up in the fleet office's list, and the document's
rules on its fields. Each full-size attempt cost five minutes of a shared place for nothing.
So the first page call asks for that size too: at most six screens, three to six rows in a
list, around 20 to 30 KB, and why. The retry stays, smaller again.

Measured with both changes: the screens took twenty seconds and 2 065 tokens, and the page
was written at the first attempt. It started writing after two minutes fifty and was kept at
four minutes twenty, with 25 168 of its 32 000 tokens. That margin is not wide. A larger
document may still need the retry, and the retry is what it is for.

The live run also showed a Gemini key that the fallback could not use. A primary that ran out
of room was then reported as the fallback's failure, "cannot be reached", and the out-of-room
retry never ran. Which error wins when every model fails belongs to the gateway, not to this
change, so it is left there.

**A usable reply** is what lies between the first `<!DOCTYPE html` at the start of a line (or
`<html`, when there is no doctype) and the last `</html>`. With no closing tag, it ends after
the last `</body>`, or else at a closing code fence, so talk after the page is not shown as
page text. It must have a `<body>`.

**One retry**, with a brief instruction to be smaller and self-contained. It happens when the
first reply ran out of room, held no usable page, or loads a script or stylesheet from
outside. A script or stylesheet from a CDN is what these models reach for, and the policy
blocks it, so the page would show unstyled.

- A typeface from outside is not counted. The page falls back to the system's, which is not
  worth minutes of a retry. Neither is an image.
- The second reply is kept only if the first had no page or the second loads less from
  outside. Asked to be smaller, it is likely to be less, and a fuller page that is partly
  unstyled may be the better of the two.
- A kept page that still loads from outside is said on the page to be possibly incomplete.
- Running out of room on both attempts is said as such. The general advice for that, "ask for
  one part at a time", is the retry's job here.

**Stamped.** A comment after the doctype says what the file is, which application, when it was
made, that the document is what to build from, and that the first lines of the head are
Specman's. A downloaded file is passed on without the page that explained it.

**Kept.** One row per application, replaced by each successful run, holding the page and the
document revision it was read at. The document and its revision are read in one tick, with
nothing awaited between, so "changed since" can only err toward saying so.

- It is a new table, not a column, and it cascades with its application.
- It moves no revision. Making a mock-up is not a write to the document, so it does not end a
  draft's mark and does not make a turn stale.
- A draft starting beside a running mock-up is not refused: the mock-up then reads as made
  before the document changed, which is true.

**Not in the repository or the handoff.** Everything in it beyond what the document says is
invented. A developer builds from the document. The mock-up can be downloaded and passed on by
whoever wants to.

## What these tests do not say

- The header tests check that every response carrying the mock-up has the policy. They do not
  say a browser honours it. That is checked in a real browser:
  - the frame cannot fetch;
  - it cannot read Specman's cookie;
  - its storage and dialogs fall back to the stand-ins;
  - its form handler runs.
- "A usable reply has a `<body>`" says nothing about whether the page works, or resembles the
  document. Only looking at it says that.
- "Nothing loaded from outside" is a pattern over `src`, `href` and `@import`. A script that
  builds an address at run time is not caught. The policy blocks it either way; the check
  exists only to spend the retry where it helps.
- The hook is not exercised by the tests: importing it runs the boot. Its one change —
  `SAMEORIGIN` kept, anything else `DENY` — is checked on the running server.
