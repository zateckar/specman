# Access control

## ADDED Requirements

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

### Requirement: A matching name is not proof of identity
Establishing who someone is from outside — through the company account or through the
reverse proxy — SHALL NOT adopt a local account that has a password of its own.

#### Scenario: The name collides with a password account
- **WHEN** the name asserted is one a local password account already uses
- **THEN** sign-in is refused, because an account someone holds a password for belongs to
  whoever knows that password, and the bootstrap administrator is called `admin`

#### Scenario: Re-linking an account this flow created
- **WHEN** the name belongs to an account with no password of its own
- **THEN** it is adopted, because that account was provisioned by this flow in the first
  place

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
