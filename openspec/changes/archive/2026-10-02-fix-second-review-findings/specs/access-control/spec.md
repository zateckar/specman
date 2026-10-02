## ADDED Requirements

### Requirement: The sign-in form is for signing in
Submitting the sign-in form while already signed in SHALL send the user to the front page
without checking a password.

#### Scenario: The form is sent from a tab left open
- **WHEN** someone already signed in submits it
- **THEN** they are taken home, rather than having a password checked, counted against them
  and a second session issued

### Requirement: Another site cannot act through a colleague's browser
The server SHALL refuse a write to its endpoints that a browser says came from another
origin, and SHALL tell browsers not to show its pages inside another site's.

#### Scenario: A page elsewhere posts to the conversation
- **WHEN** a request under `/api/` other than GET, HEAD or OPTIONS carries an `Origin` that is
  not this site
- **THEN** it is refused with 403, whatever its content type; SvelteKit already refuses the
  types a browser sends cross-site without a preflight, `text/plain` among them, and this
  holds the rule for every type besides, because behind the proxy the identity is added on
  the way in whichever page sent the request

#### Scenario: A page elsewhere frames Specman
- **WHEN** any page is served
- **THEN** it says it may not be framed, so a click on "That's right" cannot be someone else's
  click on an invisible copy

### Requirement: Errors are explained in words
A page that cannot be shown SHALL say why in plain words and offer the way back, and SHALL
NOT show a status code or the developer's message.

#### Scenario: An application that does not exist
- **WHEN** the address names an application that is not there
- **THEN** the page says there is nothing here and links back to the applications

#### Scenario: A page for administrators
- **WHEN** someone without the rights opens one
- **THEN** the page says it is for the people who look after Specman

## MODIFIED Requirements

### Requirement: Passwords cannot be guessed quickly
After a few failed sign-ins for one name from one address, the server SHALL refuse further
attempts from there for a wait that grows with each failure, up to a ceiling.

#### Scenario: Someone keeps guessing
- **WHEN** a sixth wrong password arrives for the same name from the same address
- **THEN** it is refused unchecked, with a plain message saying how long to wait

#### Scenario: Someone guesses badly on purpose to lock a colleague out
- **WHEN** the same name is then tried from a different address
- **THEN** it is checked as usual, because the wait is held against the address and the name
  together and a name alone would let anyone lock anyone out

#### Scenario: The right password arrives
- **WHEN** a sign-in succeeds
- **THEN** the failures before it are forgotten

#### Scenario: Everyone arrives through the proxy
- **WHEN** the caller is a trusted proxy that names, in `X-Forwarded-For`, the address it saw
- **THEN** the failures are counted against that address, because counted against the
  proxy's own, six wrong passwords from anyone locked the administrator's break-glass
  sign-in for the whole company; from any other peer the header is ignored, because it is
  the caller's own invention

### Requirement: Sign-in returns the user to this application
After a successful sign-in the server SHALL send the user to a path on this host.

#### Scenario: The return address points elsewhere
- **WHEN** the requested destination is anything other than a plain path — including one
  beginning `//`, which names another host
- **THEN** the user goes to the front page instead, because the moment after sign-in is the
  most credible one in which to land someone on another site

#### Scenario: The other host is hidden behind a tab
- **WHEN** the destination is `/<tab>/evil.example`
- **THEN** it is resolved the way the browser will resolve it and sent home, because the
  browser drops the tab, reads `//evil.example` and leaves this host

#### Scenario: The other host is reached through a dot segment
- **WHEN** the destination is `/..//evil.example`
- **THEN** the user goes to the front page, because it resolves on this host to the path
  `//evil.example`, and the browser reads that path again as an address once it is sent
  back; what is checked is the path that will be sent, not only the one that arrived

### Requirement: A company sign-in is bound to its own attempt
Company sign-in SHALL send a fresh nonce with each attempt and SHALL refuse an ID token that
does not carry it.

#### Scenario: A token from another sign-in is replayed
- **WHEN** the callback presents an ID token issued for a different attempt
- **THEN** sign-in fails, because state and PKCE protect the code but not which token comes
  back with it

#### Scenario: The directory could not be reached once
- **WHEN** looking up the provider's configuration failed
- **THEN** the next sign-in looks it up again, because the failed lookup was kept and every
  company sign-in failed until the server was restarted

### Requirement: Rights are granted here, never asserted from outside
Signing in from outside SHALL register an ordinary user, and SHALL NOT grant or withdraw
administrator rights.

#### Scenario: A colleague signs in for the first time
- **WHEN** the directory or the proxy names someone unknown
- **THEN** they are registered as an ordinary user, so an administrator can decide what they
  may do

#### Scenario: A token or header claims an administrator
- **WHEN** anything arriving from outside would make someone an administrator
- **THEN** it does not, because who someone is and what they may do are separate questions
  and only the first is the directory's to answer

#### Scenario: A colleague made an administrator signs in through an unchecked proxy
- **WHEN** the proxy names an account that was granted administrator rights, and no trusted
  peers are configured
- **THEN** that request is treated as an ordinary user's, because with no address checked
  anyone who can reach the port can send the same header; the rights are honoured once
  `PROXY_AUTH_TRUSTED_IPS` is set, and the boot warning says so

### Requirement: Applications are shared within the organisation
Every signed-in colleague SHALL be able to open, continue and approve every application;
who created one SHALL be recorded but SHALL NOT restrict who may work on it.

#### Scenario: A colleague opens someone else's application
- **WHEN** a signed-in user opens an application another user created
- **THEN** they may read it, answer its questions and approve its changes, because a design
  document is commissioned by a team and the person who happened to create it is not its
  only owner; presence on the page is what tells two colleagues they are both at work

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

### Requirement: Expired sessions do not accumulate
Sessions past their expiry SHALL be removed without waiting to be presented again.

#### Scenario: Someone stops using Specman
- **WHEN** their session expires and they never return
- **THEN** the row is cleared out anyway, rather than being kept for ever because only a
  visit would have deleted it

#### Scenario: A session expired earlier today
- **WHEN** the clear-out runs
- **THEN** that session is removed, because expiries are compared in the form they are
  written in; compared against SQLite's `datetime('now')`, whose space sorts before the
  stored `T`, every session expiring today looked unexpired until tomorrow
