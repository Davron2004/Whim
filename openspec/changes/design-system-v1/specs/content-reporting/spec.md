## REMOVED Requirements

### Requirement: A report can be started from a running mini-app, the done step, and history

**Reason**: Report moves off the Ready page and gains a Settings entry; it becomes a pushed screen.
**Migration**: See "A report can be started from a running app, History and Settings".

## ADDED Requirements

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

## MODIFIED Requirements

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
