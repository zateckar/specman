# Deployment

## Purpose

How Specman is run somewhere other than a developer's machine: what the image has to carry,
what must survive a restart, and who may reach the port. Without this written down, the two
things that lose a company's design documents — an unmounted data directory and a port
published wider than the gateway in front of it — are both one line of configuration made by
someone who had no way of knowing.

See `README.md`, *Running it somewhere else*, and `PLAN.md`, *Known limits*.

## Source

- `src/routes/health/+server.ts`

## Requirements

### Requirement: The server says whether it can serve
`GET /health` SHALL report the server's readiness without requiring a session and without
calling the gateway, answering only while the database can be both read and written.

#### Scenario: A probe while the server is healthy
- **WHEN** the request arrives with no session
- **THEN** it is answered 200, because a probe that needs credentials cannot be used by the
  thing that restarts the container

#### Scenario: The storage goes away underneath a running server
- **WHEN** the directory holding the database becomes missing or read-only
- **THEN** the probe fails, because the open database answers queries long after its volume
  has gone and the server would otherwise go on serving pages that store nothing

#### Scenario: Something tries to use the gateway diagnostics as a probe
- **WHEN** `/health/llm` is requested without administrator rights
- **THEN** it is refused, because each call spends quota the whole company shares and a probe
  runs for ever

### Requirement: Everything that must survive a restart is in one place
All persistent state SHALL live under a single directory, and the deployment SHALL mount
storage there.

#### Scenario: The container is replaced
- **WHEN** a new image is deployed over a running installation
- **THEN** every application, its history and its accounts are still there, because the
  database and every application's repository are under the same mounted path

#### Scenario: Nothing is mounted
- **WHEN** the path is left as image storage
- **THEN** the design documents are lost on the first restart, silently — which is why the
  published compose file mounts it and says why

### Requirement: The image carries what the application shells out to
The published image SHALL contain a working `git` binary.

#### Scenario: Creating the first application
- **WHEN** a user creates an application in a freshly deployed container
- **THEN** its repository is initialised, because the image was not built on the assumption
  that a Node runtime is the whole runtime

### Requirement: An image is published only if the documentation agrees with the code
The build SHALL run the tests and the documentation check before publishing, and SHALL NOT
publish from a proposal.

#### Scenario: A change whose specification was not updated
- **WHEN** it is pushed
- **THEN** no image is published, because the documentation check is the same command that
  runs the unit tests and it gates the build

#### Scenario: A pull request
- **WHEN** it is opened
- **THEN** the image is built but not pushed, so the build is proved without publishing from
  a branch nobody has reviewed

### Requirement: The port is published where only the proxy can reach it
The deployment SHALL restrict who can reach the application's port.

#### Scenario: Header sign-in behind a gateway
- **WHEN** the application accepts an identity asserted by the proxy
- **THEN** its port is published to the loopback interface only, because anyone who can reach
  it directly can otherwise assert any identity with one request

#### Scenario: An operator who has not thought about it
- **WHEN** they run the published compose file unchanged
- **THEN** they get the restricted binding by default, rather than a setting they have to
  know to add
