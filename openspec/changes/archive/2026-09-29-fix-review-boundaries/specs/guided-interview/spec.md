## MODIFIED Requirements

### Requirement: A turn finishes whether or not anyone is watching
A turn SHALL run to completion once it has begun, and failing to deliver an event to the
browser SHALL NOT stop the work; a gateway generation failure SHALL leave existing chapter
content unchanged and report the failure instead of saving a partial draft.

#### Scenario: The tab is closed mid-turn
- **WHEN** the browser disconnects while the assistant is replying
- **THEN** the reply, the chapter it rewrote, the requirements and decisions it settled, the
  reassessed status and the commit recording them are all still written

#### Scenario: Returning to the application afterwards
- **WHEN** the user opens the chapter again
- **THEN** they find the turn they did not wait for already recorded, rather than being
  asked the same question a second time

#### Scenario: Delivery fails for a reason of our own
- **WHEN** an event cannot be serialised
- **THEN** it is raised rather than counted as a disconnected browser, because a defect in
  what we send and a reader who left must not be handled the same way

#### Scenario: Generation stops partway through a draft
- **WHEN** the gateway reports an error or an incomplete response after returning chapter text
- **THEN** the user sees an error, their submitted answer remains stored, and the partial
  draft does not replace the chapter or reach the proposal
