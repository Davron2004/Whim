## ADDED Requirements

### Requirement: A report can be started from a running mini-app, the done step, and history
The launcher SHALL offer a way to report an app from three places, each opening the same report sheet for that app:

- the orb menu inside a running mini-app, as a `Report this app` action counted like every other orb action;
- the done step, as a plain-text `Report this app` action below its two destinations, which stay exactly as they are;
- the history screen header, as a `Report` action that reports the version the user is currently on.

No history row SHALL gain an action for this. Opening the sheet SHALL send nothing.

#### Scenario: Reporting from inside an app
- **WHEN** the user taps the orb in a running mini-app and chooses `Report this app`
- **THEN** the report sheet opens over the app for that app, and the app keeps running underneath

#### Scenario: Reporting from the done step
- **WHEN** a build is delivered and the user taps `Report this app` on the done step
- **THEN** the report sheet opens for the delivered app, and `Open it` and `Back to your apps` are unchanged

#### Scenario: Reporting from history
- **WHEN** the user taps `Report` in an app's history header
- **THEN** the report sheet opens for the version the user is on, and no row's action set has changed

### Requirement: The report sheet collects a reason and an optional note
The report sheet SHALL offer four reasons as single-select pills mapping to the contract's `ReportReason`: offensive, harmful, doesn't work (`broken`), and something else (`other`). The send action SHALL stay disabled until a reason is chosen. The sheet SHALL offer an optional note whose input stops at 1000 characters. The app name sent SHALL be the app's display name cut to at most 200 characters.

#### Scenario: A reason is required
- **WHEN** the sheet opens and no reason is selected
- **THEN** the send action is disabled

#### Scenario: The note is bounded at input
- **WHEN** the user types or pastes more than 1000 characters into the note
- **THEN** the field holds exactly the first 1000 characters

### Requirement: The sheet previews exactly the body that Send transmits
The sheet SHALL render its "what gets sent" preview from the same `ReportRequest` value that the send action posts, so the two cannot differ. The preview SHALL list the reason, the note when present, the app name, the prompt that made the version being reported (full text, expandable), and the app's code (its size, with the full text expandable), and SHALL state that an anonymous ID for this phone travels with the report and that the report goes to AnyCognition, with a privacy policy link.

The prompt and the code SHALL each have an include switch, on by default. Switching one off SHALL remove that field from both the preview and the body. When the app has no stored source, the code row SHALL be absent and `source` SHALL be omitted.

#### Scenario: Preview and body agree
- **WHEN** the user chooses a reason, writes a note, and sends
- **THEN** the posted body's `reason`, `note`, `appName`, `prompt`, and `source` are exactly the values the preview showed

#### Scenario: Leaving the code out
- **WHEN** the user switches off the app's code and sends
- **THEN** the preview no longer lists the code and the posted body has no `source` key

#### Scenario: A legacy app without stored source
- **WHEN** the reported version has no stored source
- **THEN** the preview shows no code row and the body has no `source` key

### Requirement: Sending a report posts it and keeps the user in the app
The send action SHALL post the body to `POST /v1/report` on the effective server with the persisted `x-whim-device` header. Sending SHALL NOT require AI-data consent. While the request is in flight the send action SHALL read `One moment`. On `202` the sheet SHALL show a thank-you state whose one action closes the sheet and returns the user to the screen underneath. At no point SHALL reporting open the system browser or any other app.

#### Scenario: A successful report
- **WHEN** the server answers `202` with a `reportId`
- **THEN** the sheet shows the thank-you state, and closing it returns the user to the running app, the done step, or history, wherever they started

#### Scenario: Reporting without consent
- **WHEN** a user who never agreed to AI-data consent sends a report
- **THEN** the report is posted, and no consent screen appears

### Requirement: A report that doesn't go through keeps the draft and says why
When sending fails, the sheet SHALL keep the reason, note, and include switches as they were, and SHALL say why inline. A service refusal SHALL show the server's hint and follow `service-refusals`' `Retry-After` rule for the send action. A `payload_too_large` refusal SHALL leave the include switches available so the user can send a smaller report. Any other failure SHALL show one copy-table sentence. No status code, error identifier, or transport message SHALL be rendered.

#### Scenario: Too large
- **WHEN** the server refuses the report with `payload_too_large`
- **THEN** the sheet shows the hint, keeps the draft, and sending again with the code switched off posts a body without `source`

#### Scenario: Offline
- **WHEN** the report request fails at the network level
- **THEN** the sheet shows the copy-table sentence for a report that couldn't be sent, and the draft is intact

### Requirement: Closing the sheet sends nothing
System back, a tap on the scrim, and the cancel action SHALL each close the report sheet without sending and discard its draft. While the sheet is open over a running mini-app, system back SHALL close the sheet and SHALL NOT reach the app (see `mini-app-back-navigation`).

#### Scenario: Back closes an unsent sheet
- **WHEN** the sheet is open over a running app with a reason chosen and the user presses system back
- **THEN** the sheet closes, nothing is posted, and the app is still running at the same screen

### Requirement: Report content never reaches device logs
Log records about a report SHALL carry only the reason, the byte sizes of the included prompt and source, and the outcome (status class or refusal code). The note, prompt, source, and app name SHALL NOT appear in any record.

#### Scenario: A sent report leaves no content in the ring buffer
- **WHEN** a report with a note, prompt, and source is sent and the ring buffer is read
- **THEN** records show the reason, sizes, and outcome, and none contains the note, prompt, source, or app name
