## ADDED Requirements

### Requirement: Approval failures are explained in the user's terms
A refused approval SHALL say what happened and what to do in plain words, and the cause SHALL
go to the log.

#### Scenario: The changes moved on during the review
- **WHEN** the reviewed revision is no longer the proposal's
- **THEN** the user is told the changes moved on and to look over them again, without
  mention of revisions, bases or merges

#### Scenario: An earlier approval is stuck
- **WHEN** recovery of an earlier approval is blocked
- **THEN** the user is told nothing more can be approved until it finishes and that whoever
  looks after Specman is needed, with the details in the log

### Requirement: The review page says when there is nothing to review
The page SHALL say there is nothing to review, and offer no approval, when the open proposal
holds no change from the approved document or cannot be read, and SHALL say that the history
is missing, rather than that nothing is waiting, when the application's repository is gone.

#### Scenario: The proposal holds no change
- **WHEN** the proposal's text does not differ from the approved document
- **THEN** the page says nothing is waiting, because an empty difference split into one empty
  line, was counted as a change, and offered an Approve button for nothing

#### Scenario: The proposal's branch was never made
- **WHEN** the open proposal's first commit failed, so its branch does not exist
- **THEN** the page still opens and says there is nothing to review yet, rather than failing
  to load

#### Scenario: What "nothing to review" claims
- **WHEN** the page says there is nothing to review
- **THEN** it says no recorded changes are waiting, and not that everything written is already
  approved, which is untrue whenever a change failed to reach the history — exactly when
  someone comes to look

#### Scenario: The application's history is missing
- **WHEN** the application has had a repository and it is not there
- **THEN** the page says the history cannot be found, that the answers are kept and who can
  restore it, and offers no approval; read as an empty review, it said everything was already
  approved, as observed in a running instance

### Requirement: The history reads as events, not as Git
The review page's history SHALL describe each entry in words and SHALL NOT show commit
hashes or branch names.

#### Scenario: An approval in the history
- **WHEN** the history lists a merge
- **THEN** it reads "Changes approved", not "Merge design changes from spec/0003" beside a hash

## MODIFIED Requirements

### Requirement: Approval merges and refreshes the developer bundle
Approving SHALL merge the working branch and rewrite the build-ready bundle on the main
branch.

#### Scenario: A colleague clones the repository after approval
- **WHEN** they read the bundle
- **THEN** it matches the approved document rather than whatever was approved last time

#### Scenario: The bundle cannot be written
- **WHEN** producing it fails
- **THEN** the merge still stands and the failure is logged, rather than the approval being
  lost

#### Scenario: Newer answers are not yet committed
- **WHEN** the database contains a newer revision while an earlier proposal is approved
- **THEN** the developer bundle uses the proposal's committed export snapshot, and the newer
  answers remain pending rather than reaching main without review

#### Scenario: A proposal predates export snapshots
- **WHEN** an older working branch is approved
- **THEN** its bundle is reconstructed from its committed manifest and chapter files,
  with a warning about metadata the older format did not retain, never from live database content

#### Scenario: A failed commit left files in the working tree
- **WHEN** approval finds staged, modified or untracked files
- **THEN** it leaves the proposal open, so the bundle commit cannot sweep those unreviewed
  files onto main, records the outstanding changes on the proposal at once and asks the user
  to look over them again — rather than telling them to "record another change", which they
  had no way to do; if recording them fails too, it says nothing was approved and does not
  claim they were recorded

### Requirement: A change is summarised as a requirement-level delta
The review SHALL report requirements added, changed and removed, naming the chapter and what
moved, computed deterministically.

#### Scenario: A requirement is reworded
- **WHEN** its statement changes
- **THEN** the review says so, distinguishing a change of wording from a change of timing or
  of the example

#### Scenario: A requirement moves to another chapter
- **WHEN** only the chapter it belongs to changes
- **THEN** it is reported as changed, naming the move, because the document changed even
  though no word of the rule did, and the review had reported nothing

#### Scenario: How a change is named
- **WHEN** a change or a check finding is listed
- **THEN** it is placed by chapter title; rule references such as `REQ-004` are how the
  check finds a rule, not how the user knows it, and are not shown

#### Scenario: Cost of producing the summary
- **WHEN** the review page loads
- **THEN** no model call is made, because both sides come from the manifest

### Requirement: The text diff remains available
The prose diff SHALL remain reachable behind a toggle.

#### Scenario: A reviewer wants the exact text
- **WHEN** they open the diff
- **THEN** they see the change line by line, each file headed by the title of the chapter it
  holds and the gaps between changed passages shown as "…", because the file names, the
  `---`/`+++` lines and the `@@` markers are how the change is stored and were shown as they
  were
