## ADDED Requirements

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

### Requirement: A company sign-in is bound to its own attempt
Company sign-in SHALL send a fresh nonce with each attempt and SHALL refuse an ID token that
does not carry it.

#### Scenario: A token from another sign-in is replayed
- **WHEN** the callback presents an ID token issued for a different attempt
- **THEN** sign-in fails, because state and PKCE protect the code but not which token comes
  back with it

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

## MODIFIED Requirements

### Requirement: Passwords are stored as salted hashes
Local passwords SHALL be stored as a scrypt hash with a per-user random salt, and compared
in constant time.

#### Scenario: Checking a password
- **WHEN** a password is verified
- **THEN** the comparison does not reveal how much of the hash matched through its timing

#### Scenario: A user signs in through the company account
- **WHEN** the account has no local password
- **THEN** password sign-in fails rather than succeeding on an empty credential

#### Scenario: A name that has no password is tried
- **WHEN** the name is unknown, or belongs to an account without a password
- **THEN** a full hash is still computed before refusing, so the time taken to answer does
  not say which names exist

#### Scenario: Many sign-ins arrive at once
- **WHEN** passwords are being checked
- **THEN** the hash runs off the event loop, because sign-in is the one place an
  unauthenticated caller makes the server run scrypt and the synchronous form stalls every
  other request while it works

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

### Requirement: A matching name is not proof of identity
Establishing who someone is from outside — through the company account or through the
reverse proxy — SHALL NOT adopt a local account that has a password of its own.
OIDC SHALL resume an existing account only through its issuer and subject link, and
SHALL refuse an unfamiliar identity whose username is already in use.

#### Scenario: The name collides with a password account
- **WHEN** the name asserted is one a local password account already uses
- **THEN** sign-in is refused, because an account someone holds a password for belongs to
  whoever knows that password, and the bootstrap administrator is called `admin`

#### Scenario: A passwordless administrator name is recycled
- **WHEN** a different OIDC subject carries the name of an existing passwordless administrator
- **THEN** sign-in is refused without linking the new subject or inheriting its rights

#### Scenario: A name belongs to an account the proxy created
- **WHEN** an unfamiliar OIDC identity has the same username as a proxy account
- **THEN** sign-in is refused because the shared name does not establish shared ownership

#### Scenario: The proxy names a company sign-in account
- **WHEN** the proxy asserts a username that belongs to an account linked to an issuer and
  subject
- **THEN** sign-in is refused, which is the same rule in the other direction: the account
  belongs to that subject, and a header carrying the same string is not it

#### Scenario: The original subject changes its username
- **WHEN** the original issuer and subject sign in under a new display username
- **THEN** the original account resumes because the stable identity link still matches
