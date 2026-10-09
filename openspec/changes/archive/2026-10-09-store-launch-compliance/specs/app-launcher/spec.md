## MODIFIED Requirements

### Requirement: The Settings screen persists a server address for the prompt flow
The launcher SHALL let the user enter and persist a server address as an optional override of the compiled-in production server (see `release-config`), used by every request the launcher sends. The field SHALL live in the Settings screen's Advanced section. A blank address SHALL mean "no override" and SHALL never cause a crash. When an override is saved, a plain-text action SHALL offer to go back to the default server, and taking it SHALL clear the override. The field's placeholder SHALL name the default server's host so the user can see what "no override" means.

#### Scenario: Configured address is used
- **WHEN** a server address has been entered in Settings and the user submits a prompt
- **THEN** the clarify, rewrite, and generation requests target that address

#### Scenario: No override uses the default server
- **WHEN** no server address has been entered and the user submits a prompt with consent granted
- **THEN** the requests target the compiled-in production server, and no "set an address in Settings" message is shown

#### Scenario: Going back to the default
- **WHEN** an override is saved and the user takes the use-the-default action
- **THEN** the field is empty, and the next request targets the compiled-in production server

### Requirement: The home screen shows a quiet connectivity indicator
The home screen SHALL show a quiet status indicator reflecting the session's connectivity state (unknown, checking, online, offline) sourced from `server-connectivity`. The indicator SHALL NOT block or obscure the app grid, and MUST NOT appear while the state is unknown, which includes every moment before AI-data consent is granted.

#### Scenario: Offline indicator appears without blocking the grid
- **WHEN** the connectivity state is offline
- **THEN** the home screen shows a quiet offline indicator, and the app grid remains fully visible and usable

#### Scenario: No indicator before consent
- **WHEN** AI-data consent has not been granted
- **THEN** the home screen shows no connectivity indicator

## ADDED Requirements

### Requirement: Settings groups its controls into titled sections, with the server address under Advanced
The Settings screen SHALL present, in order: an AI features section (see `ai-data-consent`), the existing Highlighting section, an About section with the privacy policy and support links, and an Advanced section holding the server address. The Advanced section SHALL be collapsed by default behind one row, SHALL open with a tap, and SHALL render already open while an override is saved. Whether it is open SHALL NOT be persisted. Every string SHALL come from the copy table, and every style from the shell palette and SDK tokens.

#### Scenario: A store user never meets the server field
- **WHEN** a user with no override opens Settings
- **THEN** AI features, Highlighting, and About are visible, the Advanced section is collapsed, and no server address field is shown until they open it

#### Scenario: An override keeps Advanced open
- **WHEN** a user with a saved override opens Settings
- **THEN** the Advanced section is already open and shows the saved address
