## ADDED Requirements

### Requirement: Nothing is sent to the server before consent is granted
The launcher SHALL NOT send any request to the server (clarify, rewrite, generate, or a connectivity probe of any kind) unless a current AI-data consent grant exists. The one exception SHALL be a report the user sends by hand from the report sheet, which carries its own disclosure (see `content-reporting`).

Request options for clarify, rewrite, generate and connectivity probes SHALL come from one gate that yields nothing without a current grant, so a call site cannot build a request that skips it.

#### Scenario: A fresh install stays silent
- **WHEN** the launcher starts for the first time and the user browses the home grid, opens and uses the example apps, and visits Settings
- **THEN** no request of any kind has reached the server, and the connectivity state is unknown

#### Scenario: Revoking stops requests mid-session
- **WHEN** consent is turned off in Settings and the user then takes an action that would send a request
- **THEN** the consent screen opens and no request is sent

#### Scenario: A report is the only exception
- **WHEN** no consent grant exists and the user sends a report from the report sheet
- **THEN** exactly that report request is sent, and no clarify, rewrite, generate, or probe request accompanies it

### Requirement: The first action that would send data asks for consent at that moment
The launcher SHALL open the consent screen in place of the requested screen whenever the user takes a data-sending action without a current grant. The data-sending actions are: the home composer row, "Prompt again" from the tile long-press sheet, the orb's change action, history's "Change it from here", and Retry on a failed or interrupted build. After the user agrees, the action they started SHALL continue as if consent had already existed. Reattaching to a build that is already running sends nothing and SHALL NOT ask.

#### Scenario: Composer row on a fresh install
- **WHEN** a user with no grant taps `Describe an app…`
- **THEN** the consent screen opens, and the compose step is not shown

#### Scenario: Agreeing continues the started action
- **WHEN** the user agrees on a consent screen opened by "Prompt again" on an app
- **THEN** the compose step opens scoped to that app

#### Scenario: Agreeing continues a retry
- **WHEN** the user agrees on a consent screen opened by Retry on a failed build
- **THEN** the retry starts from that build's stored prompt, exactly as a Retry with consent would

### Requirement: The disclosure names what is sent, what is never sent, and who receives it
The consent screen SHALL state, in plain words from the copy table, before any choice is offered:

- what is sent: what the user asks for (their description, their answers to Whim's questions, and the plan they approve); when changing an existing app, that app's code, its current description, and the layout of its saved data; and an anonymous ID for this phone;
- what is never sent: anything saved inside the user's apps;
- who receives it: AnyCognition, the company that makes Whim, whose server passes the request to third-party AI model providers through OpenRouter to write the app;
- that the choice can be changed in Settings, and that installed apps keep working either way.

The screen SHALL carry a privacy policy link that opens the privacy policy URL from `release-config` in the system browser. All strings SHALL pass the product-verbs guard, and all styling SHALL come from the shell palette and SDK tokens.

#### Scenario: The disclosure is complete
- **WHEN** the consent screen renders
- **THEN** it names the sent items, the never-sent item, AnyCognition, the AI model providers reached through OpenRouter, and the Settings off-switch, and shows the privacy policy link

#### Scenario: The privacy link opens the configured policy
- **WHEN** the user taps the privacy policy link
- **THEN** the system browser opens the privacy policy URL derived from the release domain constant

### Requirement: Permission is explicit and declining keeps installed apps usable
The consent screen SHALL grant consent only through its explicit agree action (`Agree and continue`). Its decline action (`Not now`), system back, and any other exit SHALL grant nothing. Nothing on the screen SHALL be pre-selected or implied as agreement.

Declining SHALL return the user to the screen that opened the consent screen, or to Home when that screen was a running mini-app. After declining, every installed app SHALL still open, run, fork, and show its history, and the next data-sending action SHALL ask again.

#### Scenario: Back declines
- **WHEN** the user presses system back on the consent screen
- **THEN** no grant is stored and the user returns to the screen that opened it

#### Scenario: Apps keep working after declining
- **WHEN** the user declines and then opens an example app, forks it, and opens its history
- **THEN** all three work, and no request has been sent

### Requirement: Consent grants are versioned
A grant SHALL be persisted on the launcher's key-value store under `whim.ai-consent:v1` as `{ version, grantedAt }`, where `version` is the consent version that was current when the user agreed. A grant SHALL count as current only when its `version` equals the compiled consent version from `release-config`. A missing, unreadable, or malformed record SHALL count as no grant.

When the stored grant is outdated, the consent screen SHALL say, in one line above the disclosure, that what Whim sends has changed since the user last agreed.

#### Scenario: A policy change asks again
- **WHEN** a user agreed under consent version 1 and the app now ships consent version 2
- **THEN** their next data-sending action opens the consent screen with the "what Whim sends has changed" line, and no request is sent until they agree again

#### Scenario: A corrupted record fails closed
- **WHEN** the stored consent record is not valid JSON
- **THEN** the launcher treats consent as not granted

### Requirement: Settings shows consent and can review or turn it off
The Settings screen SHALL carry an AI features section that reads whether consent is on (with the date it was granted) or off. Tapping it SHALL open the consent screen in review mode, showing the same disclosure.

In review mode with consent on, the large button SHALL keep it on and a plain-text action SHALL turn it off. Turning it off SHALL delete the grant, return the connectivity state to unknown with no probe scheduled, and block every later request until the user agrees again. Turning it off SHALL NOT cancel a build that is already running, because its request was already sent, and SHALL NOT change any installed app. In review mode with consent off, the agree action SHALL grant consent and return to Settings.

#### Scenario: Turning consent off
- **WHEN** the user opens AI features in Settings and chooses to turn it off
- **THEN** the grant is deleted, Settings reads off, no connectivity probe is pending, and the next composer tap opens the consent screen

#### Scenario: A running build survives revocation
- **WHEN** a build was left running and the user turns consent off
- **THEN** that build continues and can still be delivered, and no new request is sent afterwards
