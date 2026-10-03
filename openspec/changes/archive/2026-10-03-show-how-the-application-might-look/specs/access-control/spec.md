## MODIFIED Requirements

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

#### Scenario: The mock-up's own frame
- **WHEN** a mock-up is served to be shown inside its page
- **THEN** it says only Specman may frame it, and every other response still says nobody may.
  The rule is kept by leaving alone a response that has already said this site may frame it,
  and replacing anything else, not by a list of addresses
