# content-reporting Specification

## Purpose
TBD - created by archiving change store-launch-compliance. Update Purpose after archive.
## Requirements
### Requirement: The report sheet collects a reason and an optional note
The report sheet SHALL offer six reasons as single-select pills mapping to the contract's `ReportReason`, with common functional problems first: doesn't work (`broken`), wrong result (`wrong_result`), hard to use (`hard_to_use`), unsafe (`harmful`), offensive (`offensive`), and something else (`other`). The send action SHALL stay disabled until a reason is chosen. The sheet SHALL offer an optional note whose input stops at 1000 characters. The app name sent SHALL be the app's display name cut to at most 200 characters.

#### Scenario: A reason is required
- **WHEN** the sheet opens and no reason is selected
- **THEN** the send action is disabled

#### Scenario: The note is bounded at input
- **WHEN** the user types or pastes more than 1000 characters into the note
- **THEN** the field holds exactly the first 1000 characters

#### Scenario: The keyboard leaves the sheet usable
- **WHEN** the note keyboard reduces the available height
- **THEN** the sheet stops below the top safe area, its top stays in place while the user scrolls its contents, and the send and cancel actions remain reachable

### Requirement: The sheet previews exactly the body that Send transmits
The sheet SHALL hide the "what gets sent" heading and preview until a reason is selected. It SHALL then render the preview from the same `ReportRequest` value that the send action posts, so the two cannot differ. The preview SHALL list the reason, the note when present, the app name, the prompt that made the version being reported (full text, expandable), and the app's code (its size, with the full text expandable). It SHALL state that this phone's Whim ID goes with the report and that the report goes to AnyCognition, the company that makes Whim, and it SHALL carry a privacy policy link, because a report skips the consent screen and the sheet is its notice. No report string SHALL call the ID anonymous or promise that every report is read.

The active version's original source SHALL always be included when stored. The sheet SHALL explain in plain language that the code is included to investigate the report. The prompt for the active version SHALL have an include switch, on by default. Switching it off SHALL remove the prompt from both the preview and the body. When the app has no stored source, the sheet SHALL say so, the code row SHALL be absent, and `source` SHALL be omitted.

#### Scenario: Preview and body agree
- **WHEN** the user chooses a reason, writes a note, and sends
- **THEN** the posted body's `reason`, `note`, `appName`, `prompt`, and `source` are exactly the values the preview showed

#### Scenario: Code is part of a report
- **WHEN** the active version has stored original source and the user sends a report
- **THEN** the preview lists the code, the posted body includes that source, and no code opt-out is offered

#### Scenario: No reason chosen yet
- **WHEN** the report sheet opens without a chosen reason
- **THEN** neither the "what gets sent" heading nor its preview card is shown

#### Scenario: A legacy app without stored source
- **WHEN** the reported version has no stored source
- **THEN** the preview shows no code row and the body has no `source` key

#### Scenario: The sheet is the report's notice
- **WHEN** a reason is selected
- **THEN** the preview says this phone's Whim ID goes with the report to AnyCognition, shows a privacy policy link, and the thank-you state after sending says "Thanks. We'll look into it." with no promise that every report is read

### Requirement: Sending a report posts it and keeps the user in the app
The send action SHALL post the body to `POST /v1/report` on the effective server with the persisted `x-whim-device` header. Sending SHALL NOT require AI-data consent. While the request is in flight the send action SHALL read `Sending…` and ignore taps. On `202` the screen SHALL show a check, "Thanks. We'll look into it." and `Done`, which returns the user to where they started; the thank-you SHALL name no company when the user has set their own server. A send failure SHALL show as a notice at the end of the scrolling content, above the buttons. At no point SHALL reporting open the system browser or any other app.

#### Scenario: A successful report
- **WHEN** the server answers `202` with a `reportId`
- **THEN** the screen shows the thank-you state, and `Done` returns the user to the running app or History, wherever they started

#### Scenario: Reporting without consent
- **WHEN** a user who never agreed to AI-data consent sends a report
- **THEN** the report is posted, and no consent screen appears

#### Scenario: Own server, neutral thanks
- **WHEN** a report is sent to the user's own server
- **THEN** the thank-you copy mentions no company

### Requirement: A report that doesn't go through keeps the draft and says why
When sending fails, the sheet SHALL keep the reason, note, and prompt switch as they were, and SHALL say why inline. A service refusal SHALL show the server's hint and follow `service-refusals`' `Retry-After` rule for the send action, except that a `payload_too_large` refusal SHALL use report-specific copy that does not suggest excluding the code. The prompt switch remains available. Any other failure SHALL show one copy-table sentence. No status code, error identifier, or transport message SHALL be rendered.

#### Scenario: Too large
- **WHEN** the server refuses the report with `payload_too_large`
- **THEN** the sheet shows the report-specific size hint, keeps the draft, and the prompt can still be excluded for another attempt

#### Scenario: Offline
- **WHEN** the report request fails at the network level
- **THEN** the sheet shows the copy-table sentence for a report that couldn't be sent, and the draft is intact

### Requirement: Closing the sheet sends nothing
System back, a tap on the scrim, and the cancel action SHALL each leave the report without sending and discard its draft. Inside the Whim sheet, Back, Cancel and system back SHALL go to the sheet menu and Close SHALL go to the running app. System back SHALL NOT reach the app (see `mini-app-back-navigation`).

#### Scenario: Back closes an unsent sheet
- **WHEN** the Report screen is open inside the Whim sheet over a running app with a reason chosen and the user presses Back, Cancel or system back
- **THEN** the sheet menu shows, nothing is posted, the draft is dropped, and the app is still running at the same screen

#### Scenario: Close inside the Whim sheet goes to the app
- **WHEN** the Report screen is open inside the Whim sheet and the user taps Close
- **THEN** the sheet closes, nothing is posted, the draft is dropped, and the app is still running at the same screen

### Requirement: Report content never reaches device logs
Log records about a report SHALL carry only the reason, the byte sizes of the included prompt and source, and the outcome (status class or refusal code). The note, prompt, source, and app name SHALL NOT appear in any record.

#### Scenario: A sent report leaves no content in the ring buffer
- **WHEN** a report with a note, prompt, and source is sent and the ring buffer is read
- **THEN** records show the reason, sizes, and outcome, and none contains the note, prompt, source, or app name

### Requirement: A report can be started from a running app, History and Settings
The launcher SHALL offer a way to report an app from three places, each opening the same Report screen for that app:

- the Whim sheet over a running app, as `Report a problem`, pushed inside the sheet on its own small stack so the app keeps running underneath;
- the History header, as a `Report` text button that reports the version the user is on, pushed on the native stack;
- Settings, as a support entry that reports without a specific app, pushed on the native stack.

The Ready page SHALL NOT carry a report action. No history row SHALL gain an action for this. Opening the screen SHALL send nothing.

#### Scenario: Reporting from inside an app
- **WHEN** the user taps the orb in a running app and chooses `Report a problem`
- **THEN** the Report screen pushes inside the Whim sheet, and closing the sheet returns to the running app

#### Scenario: Reporting from history
- **WHEN** the user taps `Report` in History's header
- **THEN** the Report screen pushes on the native stack for the version the user is on, and back returns to History

