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
- `src/routes/admin/users/+page.server.ts`
- `src/routes/admin/users/+page.svelte`
- `src/routes/+layout.server.ts`
- `src/routes/+layout.svelte`
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
