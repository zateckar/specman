# Access control

## Purpose

Specman holds one organisation's unreleased plans, so who is signed in has to be settled
before anything else happens on a request. Sign-in is either a company account through OIDC
or a local password, and the first administrator has to come from somewhere without leaving
a permanent way in.

The per-request session lookup happens in `src/hooks.server.ts`, which belongs to
`storage-and-migrations` because the boot sequence is the larger part of what it does. The
behaviour of that lookup is specified here.

## Source

- `src/lib/server/auth/index.ts`
- `src/lib/server/auth/oidc.ts`
- `src/lib/server/llm/forwarded.ts`
- `src/lib/server/llm/return-path.ts`
- `src/lib/server/llm/attempts.ts`
- `src/routes/admin/users/+page.server.ts`
- `src/routes/admin/users/+page.svelte`
- `src/routes/+layout.server.ts`
- `src/routes/+layout.svelte`
- `src/routes/+error.svelte`
- `src/routes/login/+page.server.ts`
- `src/routes/login/+page.svelte`
- `src/routes/login/oidc/+server.ts`
- `src/routes/login/oidc/callback/+server.ts`
- `src/routes/logout/+server.ts`

## Requirements

### Requirement: Every request resolves an identity
The server SHALL resolve the session cookie to a user, or to no user, before any route
handler runs.

#### Scenario: A valid session
- **WHEN** a request carries a session cookie that exists and has not expired
- **THEN** the user is available to every load function and action on that request

#### Scenario: An expired session
- **WHEN** the session's expiry has passed
- **THEN** the session is deleted and the request proceeds as signed out

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

### Requirement: The sign-in form is for signing in
Submitting the sign-in form while already signed in SHALL send the user to the front page
without checking a password.

#### Scenario: The form is sent from a tab left open
- **WHEN** someone already signed in submits it
- **THEN** they are taken home, rather than having a password checked, counted against them
  and a second session issued

### Requirement: Stored credentials never leave the server
The user record made available to a page SHALL carry no password hash and no salt.

#### Scenario: Any page is rendered
- **WHEN** the signed-in user is passed to the browser
- **THEN** the fields sent are named one by one, so a column added to the user table cannot
  reach the page by having been selected with the rest

#### Scenario: A column is added to the user table
- **WHEN** a query asks for every column and the result is typed as the narrower record
- **THEN** that is a defect: the type says the field is absent while the object carries it,
  and serialisation follows the object

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

### Requirement: The bootstrap admin is not a permanent backdoor
The server SHALL create the initial `admin` account from `ADMIN_PASSWORD` only while no
user exists.

#### Scenario: First boot
- **WHEN** the user table is empty and `ADMIN_PASSWORD` is set
- **THEN** an administrator account is created and the fact is logged

#### Scenario: Any later boot
- **WHEN** at least one user exists
- **THEN** no account is created, whatever `ADMIN_PASSWORD` says

#### Scenario: First boot with no password configured
- **WHEN** the user table is empty and `ADMIN_PASSWORD` is unset
- **THEN** a warning is logged and no account is created

### Requirement: Company sign-in is linked, not duplicated
An OIDC identity SHALL be unique per issuer and subject, and map to exactly one user.

#### Scenario: The same colleague signs in twice
- **WHEN** an identity that has been seen before signs in again
- **THEN** they resume the same user rather than gaining a second account

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

### Requirement: The people page says how each person gets in
Each account SHALL record how it came to exist, and the people page SHALL describe every way
its holder can sign in.

#### Scenario: Someone the gateway signs in
- **WHEN** their account has no password and no linked company account
- **THEN** the page says the gateway signs them in, rather than that they cannot sign in —
  which is the ordinary case behind a gateway and would otherwise describe everybody

#### Scenario: An account that really cannot sign in
- **WHEN** nothing at all is recorded against it
- **THEN** the page says so, because an administrator deciding what someone may do needs to
  know whether they can get in at all

#### Scenario: An account created before this was recorded
- **WHEN** the gateway signs that person in
- **THEN** that is recorded then, because no examination of the stored row can recover it
  afterwards

### Requirement: Administrator rights can be granted and withdrawn
An administrator SHALL be able to see everyone and change who administers Specman, and the
last administrator SHALL NOT be removable.

#### Scenario: Granting rights to a colleague
- **WHEN** an administrator grants them on the people page
- **THEN** that person administers Specman from their next request

#### Scenario: Removing the last one
- **WHEN** the only administrator would lose their rights
- **THEN** it is refused, because the bootstrap account is created only while no user exists
  and there would be no way back

### Requirement: An identity asserted by the proxy is re-read every request
Where the reverse proxy asserts who the caller is, the server SHALL resolve that identity on
each request and SHALL NOT convert it into a session of its own.

#### Scenario: The directory disables an account
- **WHEN** the proxy stops asserting that person
- **THEN** they are signed out here at once, rather than when a session minted earlier would
  have expired

#### Scenario: A caller not permitted to assert an identity
- **WHEN** trusted peers are configured and the request comes from another address
- **THEN** the headers are ignored and the login page is shown

#### Scenario: No proxy in front
- **WHEN** a request carries none of these headers
- **THEN** nothing changes: the session cookie decides, as it does today

#### Scenario: Signing out from behind the proxy
- **WHEN** the identity came from the proxy
- **THEN** the interface does not offer to end a session it did not create, and points at
  the proxy's own sign-out where one is configured

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

### Requirement: Administration is restricted
The template and standards pages SHALL be reachable only by an administrator.

#### Scenario: A non-administrator opens an admin page
- **WHEN** a signed-in user without the administrator flag requests it
- **THEN** they are refused rather than shown the editor

### Requirement: Signing out ends the session server-side
Sign-out SHALL delete the session row, not only clear the cookie.

#### Scenario: A copied cookie is replayed after sign-out
- **WHEN** the same session id is presented again
- **THEN** it resolves to no user

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
