## MODIFIED Requirements

### Requirement: Applications are shared within the organisation
Every signed-in colleague SHALL be able to open, continue and approve every application;
who created one SHALL be recorded but SHALL NOT restrict who may work on it. Only an
untouched draft MAY be deleted, and only by its creator or an administrator.

#### Scenario: A colleague opens someone else's application
- **WHEN** a signed-in user opens an application another user created
- **THEN** they may read it, answer its questions and approve its changes, because a design
  document is commissioned by a team and the person who happened to create it is not its
  only owner; presence on the page is what tells two colleagues they are both at work

#### Scenario: A colleague's untouched draft
- **WHEN** someone other than its creator or an administrator would delete a draft nobody has
  touched
- **THEN** it is refused, though they may open it and work on it, because throwing a draft
  away is the decision of whoever asked for it, while working on it is anyone's

#### Scenario: Nobody is signed in
- **WHEN** a request for an application or its endpoints carries no identity
- **THEN** it is refused, because sharing within the organisation is not sharing with
  whoever can reach the port

#### Scenario: A page is opened signed out
- **WHEN** the request is for a page
- **THEN** the user is sent to sign in and brought back to the same address afterwards,
  including what follows the `?`, which chooses the chapter

#### Scenario: The page calls an endpoint after the session ended
- **WHEN** a request under `/api/` carries no identity
- **THEN** it is answered 401 with a sentence saying to sign in again, because a redirect
  answered with the sign-in page, which the conversation read as a reply with nothing in it
