# Let the assistant draft a whole document

## Why

Specman only knows one way to start: the assistant interviews the user, chapter by chapter.
That is the right way to reach a document someone will build from, and the wrong way to
find out what such a document would even say. A colleague with a vague idea has to answer a
dozen chapters of questions before seeing the shape of the result, and some would be content
with a sensible default for most of it.

So, at creation, the user can ask for the opposite: the assistant writes every chapter
itself, from the name, the description and the four triage answers, making every assumption
on their behalf. The result is inspiration, a starting point, or occasionally good enough.

Two things make that safe rather than confusing. A document nobody has touched must be told
apart from one that holds people's answers, wherever it is listed. And since a draft is cheap
to make and many will be thrown away, one nobody has touched must be deletable, which nothing
in Specman can do today.

## What Changes

- **Creation offers a choice of how to start:** answer the assistant's questions (as today),
  or let the assistant draft all of it. Drafting needs a description to draft from, and a
  configured model.
- **The draft is written by the server, in the background:** the Overview first, then the
  other chapters that apply, each with its prose, its rules and its decisions. Every decision
  is the assistant's, awaiting confirmation, and every chapter carries at least one. Each
  chapter is committed to the working branch as it lands, and is assessed for completeness as
  a turn would be.
- **The draft can be watched:** the workspace names the chapters being written and counts
  those done; the home page card says how far it has got. Everything that would race it
  waits: the conversation, the whole-document check, the diagram and approval.
- **A draft that stopped can be finished:** if the gateway fails or the server restarts
  part-way, the workspace says which chapters are missing and offers to draft the rest.
- **An untouched draft is marked "AI draft":** on its card and in its workspace. The mark is
  derived and never stored, so nothing has to remember to clear it. It disappears the moment
  anyone puts something of their own into the document: an answer, a confirmed or rejected
  decision, an included chapter, an approval.
- **An untouched draft can be deleted** by the person who asked for it or by an administrator,
  from its card or its workspace. A deleted draft is gone from the database and from disk.
  Anything a person has touched cannot be deleted from the interface, as is the case today.
- **A chapter's assumptions can be confirmed together**, so taking a draft on does not mean
  confirming forty assumptions one at a time.

## Impact

| | |
|---|---|
| Capabilities | new `whole-document-draft`; `project-setup` (how an application starts); `guided-interview` (the conversation waits; a drafted chapter says so); `decisions` (confirm a chapter's together); `storage-and-migrations` (where an application came from); `access-control` (who may delete a draft) |
| Migration | Two columns on `projects`: `origin` defaults to `interview` and `drafted_revision` to null. That is the correct value for every application that exists, because every one of them was started by interview, so the default is the backfill. No document changes, so nothing has to reach a repository. |
| Gateway | Nothing extra per turn. A draft costs one streamed call and one assessment call per applicable chapter, about twenty calls for a full document. No more than three drafting calls run at a time across the whole installation. |
