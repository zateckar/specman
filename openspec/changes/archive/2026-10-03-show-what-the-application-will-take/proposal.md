# Show what the application will take

## Why

The colleague who commissions an application has to get it approved, funded and staffed
before anyone builds it. The design document says what it must do, but it says nothing
about the questions management asks first: what is it, in two sentences; why is it worth
doing; how hard is it; what will it cost to build; what will it cost to run. Today they
answer those from memory, or ask a developer who has not read the document.

So, as the diagram and the mock-up are made on request, the assistant can write a business
and technical overview from the document: an elevator pitch, a short business case, how
complex the application is for the business and technically, what building it would take
by people and with an AI coding assistant, and what it would cost to run on Azure in a
reference architecture. It can be saved as one HTML page to pass on as a report.

## What Changes

- **An overview page per application**, reached from the workspace beside the diagram and
  the mock-up. It offers to make the overview, shows the latest, says when it was made, marks
  it out of date once the document has changed, and offers to refresh it.
- **The assistant judges, the code counts.** One streamed call writes the pitch, the business
  case, the two complexity ratings with their reasons, the work to build it in person-days
  per part, and which Azure services in the reference architecture it needs at which size.
  It writes no money. Every figure is calculated in code from those judgements, a stated day
  rate, stated shares for design, testing, management and deployment, and a priced
  catalogue of Azure services, so the same judgements always give the same figures and every
  assumption is printed beside them.
- **The reference architecture is enforced, not suggested.** Sign-in through Entra ID, a key
  vault, monitoring, private networking and Defender are always counted; an application
  people outside the company reach always gets a front door with a firewall; one with no
  hosting chosen gets App Service. A service the assistant names that is not in the
  catalogue is listed as not priced rather than dropped silently.
- **Made by the server in the background**, sharing the three places for long calls with
  drafting and mock-ups; it can be stopped, and a reply that is unusable or runs out of room
  is asked for once more.
- **Saved as a report**: one self-contained HTML file with its styles inside, no script, a
  policy that lets it load nothing, and print styles, which says when it was made and
  whether the document had changed since.
- **Only the latest is kept**, in the database, outside the document, the review and the
  handoff. Making one is looking, not touching.

## Impact

| | |
|---|---|
| Capabilities | new `application-overview`; `whole-document-draft` (refused while drafting; not a touch; the shared limit on long calls); `llm-gateway` (its budget) |
| Migration | One new table, `overviews`, created on boot. No application has an overview yet, so there is nothing to backfill, and no document changes. |
| Gateway | Nothing per turn. One long streamed call, two at most, on request. |
