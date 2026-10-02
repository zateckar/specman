## ADDED Requirements

### Requirement: A colleague behind the proxy can switch account
Signing out SHALL lead to the sign-in page, which, for someone the proxy signed in, SHALL
name that account, offer to continue with it, and offer to sign in with another.

#### Scenario: Becoming the administrator
- **WHEN** a colleague the gateway signed in signs out and signs in with the administrator's
  password
- **THEN** they work as the administrator, with its rights, until they sign out of it

#### Scenario: Handing back to the gateway
- **WHEN** they sign out of that account
- **THEN** the session is ended and the sign-in page offers to continue as the account the
  gateway names, because the proxy still signs them in on every request

#### Scenario: Leaving altogether
- **WHEN** the proxy publishes its own sign-out
- **THEN** the sign-in page links to it, because the proxy's session is the proxy's to end and
  nothing here can end it

## MODIFIED Requirements

### Requirement: Every request resolves an identity
The server SHALL resolve the session cookie, or failing that the reverse proxy's assertion,
to a user, or to no user, before any route handler runs.

#### Scenario: A valid session
- **WHEN** a request carries a session cookie that exists and has not expired
- **THEN** the user is available to every load function and action on that request

#### Scenario: A session behind the proxy
- **WHEN** a request carries both a valid session and the proxy's header
- **THEN** the session decides, because it exists only because someone signed in here on
  purpose — and behind the proxy that is the only way an administrator reaches the account
  that makes them one; read the other way round, the header always won and the password was
  useless

#### Scenario: An expired session
- **WHEN** the session's expiry has passed
- **THEN** the session is deleted and the request proceeds as signed out

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
- **WHEN** proxy sign-in is on and the proxy names, last in `X-Forwarded-For`, the address it
  saw
- **THEN** the failures are counted against that address, because counted against the
  proxy's own, six wrong passwords from anyone locked the administrator's sign-in for the
  whole company; with proxy sign-in off the header is ignored, because nothing vouches for it

### Requirement: The sign-in form is for signing in
Opening or submitting the sign-in form while signed in here — with a password or the company
account — SHALL send the user to the front page without checking a password; someone signed
in only by the proxy's header SHALL be able to use it.

#### Scenario: The form is sent from a tab left open
- **WHEN** someone already signed in here submits it
- **THEN** they are taken home, rather than having a password checked, counted against them
  and a second session issued

#### Scenario: The gateway's colleague opens it
- **WHEN** the only identity on the request is the proxy's
- **THEN** the form is shown and checked, because it is where they switch to another account;
  sent home, an administrator behind the proxy had no way to their own account

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

#### Scenario: A colleague made an administrator signs in through the proxy
- **WHEN** the proxy names an account that was granted administrator rights on the people page
- **THEN** they have them, because turning proxy sign-in on is the operator saying the proxy
  is the only route here and overwrites the header; a list of trusted addresses kept beside
  that said the same thing again, and while it was empty the rights silently did nothing

### Requirement: An identity asserted by the proxy is re-read every request
Where the reverse proxy asserts who the caller is, the server SHALL resolve that identity on
each request and SHALL NOT convert it into a session of its own.

#### Scenario: The directory disables an account
- **WHEN** the proxy stops asserting that person
- **THEN** they are signed out here at once, rather than when a session minted earlier would
  have expired

#### Scenario: Proxy sign-in is switched off
- **WHEN** `PROXY_AUTH_ENABLED` is `false`
- **THEN** the headers are ignored and the sign-in page is shown, which is how an installation
  with no proxy in front stays closed to anyone sending the header themselves

#### Scenario: No proxy in front
- **WHEN** a request carries none of these headers
- **THEN** nothing changes: the session cookie decides, as it does today

#### Scenario: Signing out from behind the proxy
- **WHEN** the identity came from the proxy and the user signs out
- **THEN** they reach the sign-in page rather than the proxy's sign-out, because that is
  where they switch account; the proxy's sign-out is linked from there
