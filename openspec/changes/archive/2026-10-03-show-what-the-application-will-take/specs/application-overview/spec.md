# The business and technical overview

## ADDED Requirements

### Requirement: An overview can be made from the document
On request, the system SHALL have the assistant write the overview of an application from what
its document says, in the background, in one call.

#### Scenario: Making an overview
- **WHEN** the user asks for an overview
- **THEN** the server makes it in the background, and the page shows progress: waiting for the
  assistant, then reading the document, then how much it has written. The user may leave and
  come back, because it takes minutes and a proxy in front of Specman need not hold a silent
  request that long

#### Scenario: What the assistant is given
- **WHEN** the call is made
- **THEN** it is given what the mock-up is given — every chapter that applies, in reading
  order, with its prose and its rules for the first version — and what the triage said about
  the application: how far it reaches, whether it holds personal data, whether it is critical,
  and whether it changes one that exists. Estimates are for the first version, so what is set
  aside, for later or out of scope is not given

#### Scenario: Nothing written yet
- **WHEN** no chapter that applies has any prose
- **THEN** it is refused with a sentence saying so, before any call is made

#### Scenario: Asked for twice
- **WHEN** an overview is already being made for the application
- **THEN** a second request follows that one rather than starting another

#### Scenario: Several at once
- **WHEN** overviews, mock-ups and drafts are being made across the installation
- **THEN** they share the same three places for long calls, because each runs for minutes on a
  shared gateway and everyone's conversation waits behind them

#### Scenario: Stopping it
- **WHEN** the user stops an overview being made
- **THEN** the call ends, nothing is kept, the last overview stays, and the page says it was
  stopped

#### Scenario: The server restarts part-way
- **WHEN** the page was following an overview being made and the job is gone with nothing new
  kept and no reason given
- **THEN** the page says it stopped before it was finished and offers to make it again

#### Scenario: No model is configured
- **WHEN** neither the gateway nor Gemini is set up
- **THEN** it is refused with a sentence saying so

### Requirement: The assistant judges and the code counts
The assistant SHALL be asked for judgements and no money, and every figure in the overview
SHALL be calculated in code from those judgements, a stated day rate, stated shares and a
priced catalogue.

#### Scenario: What the assistant writes
- **WHEN** the call is made
- **THEN** it is asked for the pitch, the business case, a business and a technical rating of
  low, medium or high with their reasons, the work of building the first version by hand in
  person-days per part, the Azure services it needs from a listed catalogue with a size each,
  and its assumptions — in the document's language — and told to write no money, because
  Specman calculates it

#### Scenario: Building it by hand
- **WHEN** the figures are calculated
- **THEN** the building is the parts' person-days, which count programming and the developers'
  own testing only, and Specman adds design and analysis, testing and acceptance and project
  management as shares of it, and days to set up hosting and deploy by technical complexity,
  because asked for everything, a model leaves out what it forgets, differently every time

#### Scenario: Building it with an AI coding assistant
- **WHEN** the figures are calculated
- **THEN** the AI writes the code, working on its own for long stretches, and people look in
  at checkpoints to set its next task, review what it wrote and correct its course: a small
  share of the building, larger the harder the technology, because their time is intermittent,
  not a working day beside it. Project management is smaller still, because little is left to
  manage when most of the work is the AI's; design is smaller because the design document
  exists; testing and acceptance stay, because people do them; hosting takes one or two days,
  because it writes the pipelines and infrastructure templates as well as the code; and the
  AI's usage is costed per day of building it replaces
- **AND** directing it is 6, 10 or 15 per cent of the building and management 2 per cent,
  where they were 15 to 35 and 5: costed as continuous work, the AI route came to 27
  person-days for 43 days of building, which the colleague who commissioned it judged too
  high (2026-10-03)
- **AND** with hosting at two days where it was six, that application's AI route is 16
  person-days over two weeks; at six it was three weeks, which the same colleague judged too
  long for what the AI does in the time

#### Scenario: The totals
- **WHEN** a route is shown
- **THEN** its rows are half days, never less than half a day for work that exists, because
  whole days rounded every small row up to a day and inflated the AI route most; its total is
  the sum of the rows as shown and its cost the total at the day rate plus any AI usage, so a reader who
  adds the table gets the headline
- **AND** a range is shown from a fifth below to half above, because an estimate made before
  the design is finished is more often low than high, with calendar time from a team sized by
  the work at four productive days a person a week
- **AND** the AI route's team is one person fewer than by hand, but two where two would build it
  by hand, because one person alone made it the slower route, which contradicts the time it
  saves: 24 person-days for one person was six weeks against five by hand (seen live on
  2026-10-03)

#### Scenario: What the building consists of
- **WHEN** the parts of the building are listed
- **THEN** each is shown as its share of the building, in whole per cent with a bar, adding up
  to exactly 100 by giving the rounding to the largest remainders, and a part too small for a
  whole per cent as under one. Shares say how big each part is against the others; its
  person-days are the assistant's estimate, and printed beside the routes' totals they read as
  a figure to argue with rather than a size

#### Scenario: Running it
- **WHEN** the running cost is calculated
- **THEN** production is the sum of the chosen services' monthly prices at their sizes;
  development and test environments are a stated share of it; a year is twelve months; and
  support and small changes are a stated share of building it by hand, each year

#### Scenario: The same judgements again
- **WHEN** an overview is shown twice from the same stored judgements
- **THEN** every figure is the same, because none of them came from the model

### Requirement: Only a usable reply is kept
The system SHALL keep only a reply holding a pitch and at least one part of the work, and SHALL
ask once more, with more room and briefly, when the first was not one or ran out of room.

#### Scenario: How the reply is written
- **WHEN** the reply wraps its sections in talk or a code fence, leaves out a closing tag, puts
  a header row or a separator in a list, writes a part as `part | 5` or `part: 5 days`, a range
  as `3-5` or a decimal with a comma, or a size as a word
- **THEN** each is read as meant: a section without its closing tag runs to the next section,
  a range is its middle, and a header is not a part or a service

#### Scenario: A part out of all proportion
- **WHEN** one part claims more than 250 person-days
- **THEN** it is counted as 250, because a figure that size is a slip, not an estimate

#### Scenario: The first reply is not usable
- **WHEN** the first reply has no pitch or no work, or runs out of room
- **THEN** it is asked for once more with more room and told to keep each section short. If
  that fails too, nothing is kept, the user is told in words, and the previous overview stays

#### Scenario: The gateway fails
- **WHEN** the call fails
- **THEN** nothing is stored, the previous overview stays on screen and in the download, and
  the reason is given in plain words

### Requirement: The reference architecture is enforced
The system SHALL count what the reference architecture requires of every application whether
or not the reply named it, and SHALL price nothing outside the catalogue.

#### Scenario: What every application needs
- **WHEN** an overview is kept
- **THEN** sign-in through Entra ID, a key vault, monitoring, private networking and security
  monitoring are counted, at the size the reply gave, or a small one, or medium when the
  technology is rated high

#### Scenario: Reached from outside the company
- **WHEN** the triage says people outside the company use the application, and the reply chose
  no front door
- **THEN** a front door with a firewall is counted and the report says why, because a rule that
  lives only in the prompt is a rule that sometimes does not exist

#### Scenario: Nothing chosen to run it
- **WHEN** the reply chose no hosting
- **THEN** App Service is counted, small for one team and medium otherwise, and the report says
  so

#### Scenario: A service named twice
- **WHEN** the reply names a service on two lines
- **THEN** it is counted once, at the larger size

#### Scenario: A service not in the catalogue
- **WHEN** the reply names a service the catalogue does not hold
- **THEN** the report names it as not in the price list and not counted, rather than dropping it
  in silence or guessing its price

#### Scenario: A rating left out
- **WHEN** the reply gives no business or technical rating, or one that is not low, medium or
  high
- **THEN** the technical one is derived from the size of the work and the business one from how
  far the application reaches, and the report says so, so Specman's guess is never passed off
  as the assistant's judgement

#### Scenario: The prices
- **WHEN** a service is priced
- **THEN** it is at Azure's list price for West Europe, pay as you go, read from Azure's
  published prices, with the month they were read stated in the report and that company
  agreements usually pay less

### Requirement: The overview says what it rests on
The page and the saved report SHALL show the assistant's assumptions, every decision Specman
made where the reply left something out, and the basis of every figure, beside the figures.

#### Scenario: Reading the figures
- **WHEN** the overview is open
- **THEN** it states the day rate, every share and fixed number of days, the AI usage rate, the
  range, the working week, the price list's region and month, and the shares for other
  environments and support, because a figure whose basis is hidden cannot be challenged

#### Scenario: What it is
- **WHEN** the overview is open or saved
- **THEN** it says the assistant made it from the design document, when, that its figures are
  estimates for planning and not a quote, and that the document is what to build from

#### Scenario: What the model wrote
- **WHEN** the reply's text is shown
- **THEN** it is shown as paragraphs and lists, with headings and emphasis dropped and nothing
  rendered as markup, because the report's own headings say what each part is
- **AND** each line is its own paragraph, and the reasons for a rating and the assumptions,
  asked for as short lines, are lists, because the models do not wrap their lines, and joined,
  five assumptions read as one breathless paragraph (seen live on 2026-10-03)

### Requirement: An out-of-date overview is marked and can be refreshed
The page SHALL mark an overview made from a document that has changed since, and SHALL offer to
make it again.

#### Scenario: The document changed since
- **WHEN** the document has been changed since the overview was made
- **THEN** the page marks it out of date at its title and above it, and offers to refresh it.
  This is read from the document revision it was made from, so no path that changes the
  document has to remember to say it

#### Scenario: Refreshing
- **WHEN** the user refreshes it
- **THEN** a new overview is made from the document as it is now and replaces the old one once
  it succeeds; until then the old one stays on the page

### Requirement: The overview can be saved as a report
The page SHALL offer the overview as one HTML file that opens in any browser with no network,
runs nothing, and prints whole.

#### Scenario: Saving it
- **WHEN** the user saves the overview
- **THEN** they get one `.html` file named for the application, with its styles inside it, its
  encoding, and print styles

#### Scenario: What it may do
- **WHEN** the file is opened, from Specman or from a disk or an email
- **THEN** it carries no script, every word that came from the model is escaped, and a policy
  inside it, and on the response, lets it load nothing, because the model's words are written
  from a document anyone working on it can write

#### Scenario: Saved when out of date
- **WHEN** it is saved after the document has changed
- **THEN** the file says the document has changed since the overview was made, because the file
  is rendered when it is saved and is passed on without the page that would have said so

#### Scenario: Nothing has been made
- **WHEN** no overview has been made for the application
- **THEN** the page offers to make one, and the download answers that none has been made

#### Scenario: Finding it
- **WHEN** the workspace is open
- **THEN** a link to the overview sits beside the ones to the diagram and the mock-up

### Requirement: Only the latest overview is kept, outside the document
The system SHALL keep one overview per application, as the assistant's settled judgements,
replaced by each one that succeeds, and SHALL NOT commit it to the application's repository or
include it in the handoff.

#### Scenario: Keeping it
- **WHEN** an overview is kept
- **THEN** the judgements are stored, not the figures, and the document revision does not
  move, because it is not a change to the document: a turn running beside it is not made
  stale, and a draft keeps its mark

#### Scenario: The handoff and the review
- **WHEN** the document is reviewed, approved or handed to a developer
- **THEN** the overview is not part of it, because it is an estimate about the document, not
  part of what to build

#### Scenario: The application is deleted
- **WHEN** an untouched draft is deleted
- **THEN** its overview goes with it, and one being made is stopped once the deletion stands
