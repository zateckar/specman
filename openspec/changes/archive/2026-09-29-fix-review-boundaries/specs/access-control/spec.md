## MODIFIED Requirements

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
