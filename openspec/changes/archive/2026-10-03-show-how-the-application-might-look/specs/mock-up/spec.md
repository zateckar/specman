## ADDED Requirements

### Requirement: A mock-up can be made from the document
On request, the system SHALL have the assistant write one self-contained page in plain HTML,
CSS and JavaScript, showing one way the application could look, from what the document says.

#### Scenario: Making a mock-up
- **WHEN** the user asks for a mock-up
- **THEN** the server makes it in the background, and the page shows progress: waiting for the
  assistant, then deciding the screens, then working out the page, then how much it has
  written. The user may leave and come back, because it takes minutes and a proxy in front of
  Specman need not hold a silent request that long

#### Scenario: What the assistant is given
- **WHEN** either call is made
- **THEN** it is given every chapter that applies, in reading order, with its prose and its
  rules for the first version, and nothing set aside, for later or out of scope. What it is
  not given, it is less likely to show as the first version
- **AND** a document of many chapters has its prose shared out, so the request stays a size
  every backend takes

#### Scenario: The screens are decided first
- **WHEN** a mock-up is made
- **THEN** a first, short call decides the screens: their names, who uses each, what is on each
  and the sample records it shows. The page call is given them as decided and told to write at
  once, because asked to decide and write together the served model reasoned for five minutes
  until its 32000 tokens were gone and wrote no page (measured on 2026-10-03)

#### Scenario: No screens are decided
- **WHEN** deciding the screens runs out of room or writes no list
- **THEN** the page call is made without them and decides them itself, because that is slower
  to succeed but not a reason to give up
- **AND** when the gateway cannot be reached for the first call, no page is asked for, and the
  reason is given in words as for the page

#### Scenario: The size asked for
- **WHEN** the page is asked for
- **THEN** it is asked to be compact from the first attempt: at most six screens, a few rows in
  a list, around 20 to 30 KB, and told why. With the screens decided, a full-size page still
  reasoned until its budget was gone; asked for that size from the start, it was made at the
  first attempt in four and a half minutes with 25 168 of its 32 000 tokens, a page with three
  roles and the document's rules on its fields (measured on 2026-10-03)

#### Scenario: Nothing written yet
- **WHEN** no chapter that applies has any prose
- **THEN** it is refused with a sentence saying so, before any call is made

#### Scenario: Asked for twice
- **WHEN** a mock-up is already being made for the application
- **THEN** a second request follows that one rather than starting another

#### Scenario: Several at once
- **WHEN** mock-ups and drafts are being made across the installation
- **THEN** they share the same three places for long calls, because each runs for minutes on
  a shared gateway and everyone's conversation waits behind them

#### Scenario: Stopping it
- **WHEN** the user stops a mock-up being made
- **THEN** the call ends, nothing is kept, the last mock-up stays, and the page says it was
  stopped, because a click by mistake would otherwise hold a shared place for minutes

#### Scenario: The server restarts part-way
- **WHEN** the page was following a mock-up being made and the job is gone with nothing new
  kept and no reason given
- **THEN** the page says it stopped before it was finished and offers to make it again

#### Scenario: No model is configured
- **WHEN** neither the gateway nor Gemini is set up
- **THEN** it is refused with a sentence saying so

### Requirement: Only a whole page is kept
The system SHALL keep only a reply holding a complete HTML document with a body, and SHALL ask
once more, for something smaller and self-contained, when the first reply ran out of room,
held no page, or loads a script or stylesheet from outside the file.

#### Scenario: Talk and code fences around the page
- **WHEN** the reply wraps the page in a code fence or says something before or after it
- **THEN** only the document is kept, from its doctype to its closing tag, or to the end of its
  body when it has no closing tag

#### Scenario: The first reply does not finish
- **WHEN** the first reply runs out of room or holds no page
- **THEN** it is asked for once more, smaller. If that fails too, nothing is kept, the user is
  told in words, and the previous mock-up stays

#### Scenario: A page that loads from the internet
- **WHEN** the first reply's page loads a script or a stylesheet from outside the file
- **THEN** it is asked for once more, self-contained, because the frame it is shown in can load
  nothing from elsewhere and the page would show unstyled
- **AND** the second is kept only if it loads less from outside; otherwise the fuller first one
  is kept, and the page says some of it may be missing

#### Scenario: A typeface from the internet
- **WHEN** the only thing the page loads from outside is a typeface
- **THEN** it is kept without asking again, because the page falls back to the system's
  typeface and is none the worse for minutes of a retry

#### Scenario: The gateway fails
- **WHEN** the call fails
- **THEN** nothing is stored, the previous mock-up stays on screen and in the download, and the
  reason is given in plain words

### Requirement: A mock-up cannot act as Specman
The mock-up SHALL be shown only in a sandboxed frame on its page, served with a policy that
gives it an origin of its own, lets it load nothing from elsewhere, fetch nothing and send no
form, and lets it neither navigate the page around it, open a window nor show a dialog; only
Specman's pages SHALL frame it.

#### Scenario: Its script looks for the session
- **WHEN** the mock-up's script reads cookies, storage or the page around it
- **THEN** it finds nothing of Specman's, because the page is sandboxed into an origin of its
  own: the model wrote the script, and the document it was made from is model input that
  anyone working on it can write

#### Scenario: Its script calls out
- **WHEN** it fetches from Specman or the internet, or loads a script, style or image from
  anywhere
- **THEN** the policy blocks it; a write to `/api/` that got out would carry `Origin: null` and
  be refused as cross-site

#### Scenario: Its address opened as a page of its own
- **WHEN** a browser asks for the mock-up's address to show it as a page rather than in its
  frame
- **THEN** it is refused and pointed to its page, because there the sandbox would rest on a
  response header alone, and something between Specman and the browser that dropped it would
  leave the model's script running as Specman with the colleague's session. Full screen is
  offered on the page instead, with the frame kept

#### Scenario: Another site frames it
- **WHEN** a page on another site puts the mock-up in a frame
- **THEN** the browser refuses, as it does for every other page of Specman

#### Scenario: What the sandbox still allows
- **WHEN** a script in the mock-up navigates its own frame elsewhere, or uses a channel no
  policy governs
- **THEN** this is accepted: what it could carry is its own markup, made from a document its
  readers can already see, with no cookie or session of Specman's, and the page asks for
  nothing real to be typed into it

### Requirement: A mock-up works in its sandbox
The system SHALL give the page stand-ins for what an origin of its own takes away, ahead of
any script of its own.

#### Scenario: The page keeps something in storage
- **WHEN** the mock-up's script uses local or session storage or cookies
- **THEN** they work, in memory, because in the sandbox they throw, and one throw as a page
  starts leaves the whole mock-up dead

#### Scenario: The page shows a dialog
- **WHEN** the mock-up calls `alert`, `confirm` or `prompt`
- **THEN** the message is shown as a note on the page and a question is answered yes, because
  dialogs are refused in the sandbox, and in a page of its own a `prompt` would ask for
  something under Specman's name

#### Scenario: A form in it is submitted
- **WHEN** the user submits a form in the mock-up
- **THEN** its script's handler runs and the form goes nowhere, because a sandbox that forbids
  forms drops the submission before the handler sees it

### Requirement: A mock-up says what it is
The page and the downloaded file SHALL say that the assistant made the mock-up with invented
sample data, when, and that the document is what to build from.

#### Scenario: Looking at it
- **WHEN** the mock-up page is open
- **THEN** it says this is one way the application could look, made up from the document with
  sample data, not a design anyone has agreed to, and not a place to type anything real

#### Scenario: The document changed since
- **WHEN** the document has been changed since the mock-up was made, including by a draft
  that started while it was being made
- **THEN** the page says so and offers to make it again. This is read from the document
  revision the mock-up was made from, so no path that changes the document has to remember
  to say it

#### Scenario: The downloaded file
- **WHEN** the file is opened in an editor
- **THEN** a comment at its top names the application, says when the mock-up was made, and
  says that the document is what to build from, because a file is passed on without the page
  that explained it

### Requirement: The mock-up can be seen and taken away
The page SHALL show the latest mock-up at a laptop's width and a phone's and full screen, and
offer it as one HTML file that opens in any browser with no network and no build step.

#### Scenario: At a phone's width
- **WHEN** the user picks the phone width
- **THEN** the frame narrows to a phone's width, so a mock-up meant to work on a phone can be
  seen doing so

#### Scenario: Downloading
- **WHEN** the user downloads the mock-up
- **THEN** they get one `.html` file named for the application, with everything it needs
  inside it, its encoding, and the same limits on what it may load and send written into it,
  because opened from a disk or an email no response header comes with it

#### Scenario: Nothing has been made
- **WHEN** no mock-up has been made for the application
- **THEN** the page offers to make one, and the download and the frame answer that none has
  been made

#### Scenario: Finding it
- **WHEN** the workspace is open
- **THEN** a link to the mock-up sits beside the one to the diagram

### Requirement: Only the latest mock-up is kept, outside the document
The system SHALL keep one mock-up per application, replaced by each one that succeeds, and
SHALL NOT commit it to the application's repository or include it in the handoff.

#### Scenario: Made again
- **WHEN** a new mock-up is made
- **THEN** it replaces the previous one

#### Scenario: Keeping it
- **WHEN** a mock-up is kept
- **THEN** the document revision does not move, because it is not a change to the document:
  a turn running beside it is not made stale, and a draft keeps its mark

#### Scenario: The handoff and the review
- **WHEN** the document is reviewed, approved or handed to a developer
- **THEN** the mock-up is not part of it, because everything in it beyond what the document
  says is invented

#### Scenario: The application is deleted
- **WHEN** an untouched draft is deleted
- **THEN** its mock-up goes with it, and one being made is stopped once the deletion stands
