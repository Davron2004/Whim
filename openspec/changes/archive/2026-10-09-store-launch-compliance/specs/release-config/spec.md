## ADDED Requirements

### Requirement: One domain constant derives every Whim URL
The launcher SHALL declare the Whim release domain exactly once, in one release-configuration module, and SHALL derive every Whim URL from it: the production server `https://api.whim.<domain>`, the web origin `https://whim.<domain>`, the privacy policy `<web origin>/privacy`, the support page `<web origin>/support`, and the app-link base `<web origin>/a/`. No other launcher source SHALL contain a literal of the release domain or of any derived URL.

Until the real domain is chosen the constant SHALL hold a reserved placeholder domain, so changing the domain is a one-line edit.

#### Scenario: Derived URLs follow the constant
- **WHEN** the domain constant is `example.com`
- **THEN** the server URL is `https://api.whim.example.com`, the privacy policy is `https://whim.example.com/privacy`, the support page is `https://whim.example.com/support`, and an app link starts with `https://whim.example.com/a/`

#### Scenario: A stray URL literal fails the suite
- **WHEN** a launcher source file other than the release-configuration module contains the release domain as a string literal
- **THEN** the launcher suite fails naming that file

### Requirement: The compiled-in server is used unless the user sets an override
The launcher SHALL send every request to the user's saved server address when one is set, and to the compiled-in production server otherwise. A blank or whitespace-only saved address SHALL count as no override. Clearing the override SHALL make the next request go to the compiled-in server, with no restart.

#### Scenario: A fresh install uses the production server
- **WHEN** no server address has ever been saved and the user, having agreed to AI-data consent, taps `Continue` on compose
- **THEN** the clarify request goes to the compiled-in production server

#### Scenario: Clearing the override restores the default
- **WHEN** a user with a saved address chooses to use the default server in Settings and then sends a request
- **THEN** the request goes to the compiled-in production server

### Requirement: The consent version is declared with the release configuration
The release-configuration module SHALL declare the current AI-data consent version as a positive integer. It SHALL be the only place that value is written. A change to what Whim sends, or to whom, SHALL bump it.

#### Scenario: One source for the consent version
- **WHEN** the launcher decides whether a stored consent grant is current
- **THEN** it compares against the version declared in the release-configuration module and no other value

### Requirement: Privacy policy and support open from Settings and the consent screen
The Settings screen SHALL carry privacy policy and support links, and the consent screen SHALL carry a privacy policy link. Each SHALL open its URL derived from the release domain in the system browser.

#### Scenario: Support from Settings
- **WHEN** the user taps the support link in Settings
- **THEN** the system browser opens the support URL derived from the release domain
