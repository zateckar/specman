# Design

Five questions are worth arguing about: how "nobody has touched it" is known, who runs the
draft and what waits for it, what each chapter's call may write, how deletion avoids leaving
half an application behind, and how a user takes a draft on as their own.

The plan was reviewed before building. The review found no hole in the untouched rule. It
found guarantees that rested on the prompt alone, writers the deletion did not account for,
and endpoints the draft would have raced. The fixes are folded in below, each marked
*(review)*.

## 1. "Untouched" is derived from the document revision

A stored flag such as `curated = 1`, set by every path through which a person changes a
document, is a rule that lives in the memory of whoever adds the next such path. This plan
has recorded that failure three times.

The database already has the counter this needs. `projects.document_revision` is raised by
triggers on every write to chapters (prose, title, applicability, but not status or open
questions), requirements, decisions and the project's own name, description, kind and
profile. A path added later raises it without anyone remembering to.

So a drafted application records `drafted_revision`, the revision its draft left the document
at. Every write the drafter makes runs in one transaction that reads both numbers first:

```
before = (document_revision, drafted_revision)
…the chapter's prose, rules and decisions…
if before.document_revision == before.drafted_revision:
    drafted_revision = document_revision          -- the chain holds
```

Once anything else has written, `document_revision` is ahead of `drafted_revision` and the
chain never closes again. The counter only increases, and the drafter only advances
`drafted_revision` while the two are still equal. Updating `drafted_revision` trips neither
the metadata trigger, which watches name, description, kind, profile and template, nor the
revision guard.

An application is an **untouched draft** when all of these hold:

| condition | catches |
|---|---|
| `origin = 'generated'` | it was drafted at all |
| `drafted_revision = document_revision` | any change to prose, rules, decisions, applicability or project details, whoever made it |
| no message with `role = 'user'` | an answer that changed nothing, such as a question asked back |
| no proposal past `draft`, and no approval journal row *(review)* | an approval, which changes the repository but not the revision; the journal row exists before the proposal reads `merged` |

Things that do not count: opening it, the completeness verdict, a whole-document check, the
diagram, the export, and clicking an open question (an assistant turn, not the user's).
None of them puts a person's choice into the document.

The error is always on the safe side. A future startup repair that rewrites a draft's chapter
raises the revision, and the draft stops counting as untouched. A wrong answer in that
direction hides a delete button; it never offers one over someone's work.

Per chapter, "touched" uses the same rule: a chapter is the drafter's to write while it has
no prose, no message from a person, no decision and no rule of its own *(review: the first
version counted assistant messages too, so an open question clicked in an empty chapter would
have made the drafter drop its reply)*.

## 2. The server runs the draft, and what waits for it

Drafting takes minutes: about ten chapters, one streamed call each plus an assessment.
Following the rule that an instruction depending on a future turn is a plan with no owner,
the server runs it from start to finish, whether or not anyone is watching. The job is
started by the creation action and is not tied to any request.

- **In memory, one per application**, in `src/lib/server/drafting.ts`: the chapters done,
  being written and failed, plus an `AbortController` and a promise that settles when it
  ends. This is the same one-process limit as the repository lock and presence. The job is
  started detached, so it is wrapped in a top-level catch; an unhandled rejection would end
  the process *(review)*.
- **Nothing is lost by losing the job.** Every chapter is saved and committed as it lands,
  and the job ends with one more commit, which does nothing unless an earlier one failed
  *(review)*. A restart leaves a document with some chapters written and the rest empty, and
  the state shown is derived from that, not from the job.
- **A restart does not resume the draft by itself.** The workspace offers to draft the rest,
  and the user decides. Resuming at boot would retry a chapter that fails every time on every
  restart. This is a deliberate choice, not a plan with no owner: the remedy is offered at the
  one place someone will see it.
- **Order:** the Overview alone first, because every other chapter is written against it.
  Then the remaining applicable chapters in document order. If the Overview fails, the rest
  still run, from the name and description.
- **Three drafting calls at a time across the whole installation**, not per draft
  *(review)*. Five colleagues starting drafts would otherwise be fifteen long streams on a
  shared gateway, starving everyone's conversations. A small slot counter
  (`createSlots` in `llm/parallel.ts`) is shared by every job. Work given up while it waits
  leaves the queue at once *(found in building: a deleted draft's chapters queued behind
  other people's calls would have held its deletion until each got a slot)*.
- **Consistency across parallel calls:** each call is given the Overview's prose and the
  statements of decisions already recorded in other chapters. These are short, the same
  approach the verification pass uses across chapters. Full chapters are not passed, because
  context windows vary by backend.

**What waits for the draft.** Anything compared with the document revision, or that would
read a half-written document as if it were finished, is refused with 409 while the draft
runs, before it stores anything:

| endpoint | why it waits |
|---|---|
| `/api/chat` | a turn compares the revision it started from, and would be refused as stale after the user waited for it; and its stored message would mark the draft touched over a turn that recorded nothing |
| `/api/ask` | it opens the conversation, which is closed *(review)* |
| `/api/verify` | it compares the revision at the end of several gateway calls, so it would fail after the wait *(review)* |
| `/api/architecture` | it would draw and keep a diagram of half a document *(review)* |
| approving on the review page | it would approve half a document, and go stale with every chapter that lands *(review)* |

The page closes the conversation the same way a running turn does: Send, the suggested
answers, the open questions and the start button *(review: the first version named only the
answer box)*. It hides "Review changes" and "Diagram" while the draft runs.

**What does not wait:** confirming or rejecting a decision, and including a chapter. Neither
calls the model nor compares a revision, and each is a person's choice in the document, which
correctly ends its untouched status.

**"Draft the rest"** starts a new run over whatever is still unwritten. It is refused while a
run is going, or while anyone has a turn running in the document (`presence.writing`).

## 3. Each chapter's call writes that chapter and nothing else

The interview prompt is for questions, and its budget is spent (PLAN.md, Stage B). Drafting
gets its own short prompt in the import-free `src/lib/server/llm/draft.ts`: there is nobody
to ask; decide everything; record each choice as a decision with a Why; write the chapter in
full; record the rules with WHEN/THEN; write in the language of the description; the company
standards in the chapter are listed and are not to be restated; for an application that
already exists, mark what it assumes is already true and record each such guess as a decision.

What a reply may change is decided in code:

- **Prose:** the block naming this chapter by key, then one naming none, then one naming its
  title. The prose is normalised before it is judged empty, because a block holding only the
  chapter's heading is empty once the heading is stripped *(review)*. A block for any other
  chapter is ignored, because that chapter is being drafted by another call at the same
  moment. The key-or-title matching is the same rule as `draftTarget` in the chat endpoint,
  kept separately because the module has to stay import-free.
- **Requirements:** all are filed in this chapter, whatever `chapter=` says, and all are new.
  A `ref` is dropped and `action="remove"` is ignored, because there is nothing of the draft's
  to change. A rule worded identically (by `sameStatement`) to one the chapter already holds,
  a company standard included, or to one earlier in the same reply, is skipped.
- **Decisions:** filed in this chapter, and always `source = 'agent'`, `status = 'proposed'`.
  Nobody told the assistant anything, so a decision labelled `user` is a mislabel, and that
  label is the one that would be stored as confirmed.
- **At least one decision, whatever the model did** *(review)*. The decisions come last in a
  reply, and the end of a long instruction is what these models drop. A drafted chapter with
  no decision would read "complete" with nothing to check, which is the one thing a draft must
  not do. So a reply that records none gets one filed for it: *"The assistant wrote this
  chapter on its own."*, with the Why *"Nothing in it has been checked with you yet."* The
  chapter then reads "in progress" until a person confirms it.
- **Ignored:** options, sub-chapter plans, findings. The functionality chapter is written as
  one chapter with sub-headings; splitting it is left to a conversation.
- **No prose, no write.** Its rules and decisions are not saved on their own: a failure
  stored as a result is worse than no result.
- **One more try, with more room** *(review)*. A reply with no chapter, or one that ran out of
  `max_tokens`, which the gateway reports as an error rather than as an empty reply, is tried
  once more with 24000 tokens instead of 16000 and an instruction to keep the chapter short.
  Anything else has already been retried by the gateway client. A second failure reports the
  chapter as not drafted.
- **A chapter a person has touched in the meantime is not overwritten.** The write checks,
  inside its transaction, that the chapter is still the drafter's to write (§1). Otherwise
  the reply is dropped.

The drafted prose is assessed by the existing `assessChapter` and `reconcileAssessment`
*before* it is written, and the write and the chapter's commit then run as one held section
under the repository lock (`writeAndCommit`). *(Found in building: written first and committed
after, chapters landing in parallel were swept into whichever commit came next, and one named
for a single chapter carried eight.)* The draft has no reply, so the reconciliation is given
an empty one *(review)*: stray question marks in model chatter cannot become open questions.
The verdict decides the stored status: complete when the criteria are met, which still reads
"in progress" until the chapter's decisions are confirmed, by the existing rule. If the
assessment fails, the chapter is stored in progress. *(The first version promised that the
verdict would list what the draft could not settle as open questions. The assessor files
questions the reply asked, and a draft asks none, so that promise is withdrawn.)*

Budget: 16000 tokens per chapter, the figure the interview uses for a full rewrite of a
chapter with its rules and decisions. A draft is that same output. The prompt asks for a
focused chapter rather than an exhaustive one.

## 4. Deleting a draft

`deleteProject` exists, used only to undo a creation that could not make its repository.
Deleting a draft is a separate path with its own guards:

1. Signed in, and the creator of the draft or an administrator. Applications are shared
   within the organisation for working on them. Throwing one away is the person who asked
   for it deciding they do not want it, and nobody else's call.
2. Untouched, checked again at the moment of deleting rather than trusted from the page.
3. A running draft is aborted, and deletion waits for it to settle. If it has not settled
   within 70 seconds, the deletion is refused rather than carried on *(review: fail closed)*.
4. Under the repository lock: the database rows are deleted (everything cascades, including
   the approval journal, the verification results and the diagrams), then the folder is
   removed, with retries, since a page load reading the history can hold a file on Windows
   for a moment *(review)*. If the folder still cannot be removed, that is logged and the
   deletion stands. A folder left behind is never adopted, because creating an application
   already skips a slug whose folder exists.
5. **No writer may bring the repository back** *(review)*. The drafter is not the only thing
   that can be queued for the repository when a draft is deleted: a whole-document check
   still running ends with a commit. Finding no proposals for an application that no longer
   exists, `ensureRepo` would have made a fresh repository in the folder just removed. So
   `workingProposal`, which every repository writer passes through under the lock, refuses an
   application that is no longer in the database.

The control asks once more in the page ("Delete for good?") rather than in a browser dialog,
which a screen reader handles badly and our own browser checks cannot drive. Focus moves to
the confirming button, and back when the user keeps the draft.

## 5. Taking a draft on

"Sometimes the user may go with it." A draft carries several assumptions per chapter.
Confirming them one click and one commit at a time is forty round trips for a user who has
read a chapter and agrees with it *(review)*. So the box of assumptions in a chapter offers
"All of these are right" when it holds more than one, confirming the chapter's assistant
decisions in one transaction and one commit. That is a person's choice and ends the untouched
status, as it should. There is no "accept the whole document": agreeing to forty assumptions
unread is not what the confirmation is for.

A drafted chapter that nobody has discussed says so in its pane: the assistant drafted it on
its own and nothing in it has been checked with them. It offers to go through it, rather than
"already written".

## 6. Limits, stated so they are not rediscovered

- **Provenance ends at the first touch** *(review)*. Once a person has done anything in a
  draft, the mark is gone. The rules the draft invented then look like any rules the
  assistant wrote in an interview: both are `source = 'agent'`. Its decisions keep their
  state, and stay "decided for you" until confirmed, which is where the assumptions are
  surfaced. For an application that already exists, the draft's guesses about how it works
  today are the riskiest content, and each one is a decision for that reason.
- **One process**, as for the repository lock: a second instance neither sees a running
  draft nor refuses a turn beside it.
- **A draft needs a model**: creation refuses to start one when neither the gateway nor
  Gemini is configured, rather than creating a document that fails every chapter.
- **The description is capped at 2000 characters**, because it is sent with every chapter's
  call, and the card shows three lines of it.
