## MODIFIED Requirements

### Requirement: The Settings screen persists a server address for the prompt flow
In internal builds, the launcher SHALL let the user enter and persist a server address as an optional override of the compiled-in production server (see `release-config`), used by every request the launcher sends. Internal builds are dev builds and the local offline release build. Store builds SHALL NOT render or read the field, and SHALL ignore any override saved by an earlier build, so every request from a store build goes to the compiled-in production server that the privacy policy covers. In internal builds, the field SHALL live in the Settings screen's Advanced section. A blank address SHALL mean "no override" and SHALL never cause a crash. When an override is saved, a plain-text action SHALL offer to go back to the default server, and taking it SHALL clear the override. The field's placeholder SHALL name the default server's host so the user can see what "no override" means.

#### Scenario: Configured address is used
- **WHEN** in an internal build a server address has been entered in Settings and the user submits a prompt
- **THEN** the clarify, rewrite, and generation requests target that address

#### Scenario: No override uses the default server
- **WHEN** no server address has been entered and the user submits a prompt with consent granted
- **THEN** the requests target the compiled-in production server, and no "set an address in Settings" message is shown

#### Scenario: Going back to the default
- **WHEN** in an internal build an override is saved and the user takes the use-the-default action
- **THEN** the field is empty, and the next request targets the compiled-in production server

#### Scenario: A store build ignores a saved override
- **WHEN** a store build starts on a phone where an earlier internal build saved an override
- **THEN** Settings shows no server address field, and every request targets the compiled-in production server

### Requirement: Settings groups its controls into titled sections, with the server address under Advanced
The Settings screen SHALL present, in order:
- an AI features section, holding the consent row (see `ai-data-consent`) and the "Send error details" switch (see `privacy-settings`);
- the existing Highlighting section;
- an About section, with the privacy policy, terms of use and support links and the "This phone's ID" row (see `privacy-settings`);
- in internal builds only, an Advanced section holding the server address.

The Advanced section SHALL be collapsed by default behind one row, SHALL open with a tap, and SHALL render already open while an override is saved. Whether it is open SHALL NOT be persisted. Every string SHALL come from the copy table, and every style from the shell palette and SDK tokens.

#### Scenario: A store user never meets the server field
- **WHEN** a user of a store build opens Settings
- **THEN** AI features, Highlighting, and About are visible, and no Advanced section or server address field exists

#### Scenario: An override keeps Advanced open
- **WHEN** a user of an internal build with a saved override opens Settings
- **THEN** the Advanced section is already open and shows the saved address

#### Scenario: About carries the legal links and the ID
- **WHEN** the user opens Settings
- **THEN** the About section shows the privacy policy, terms of use and support links and this phone's ID
