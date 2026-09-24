# app-update-gate Specification

## Purpose
TBD - created by archiving change request-envelope. Update Purpose after archive.
## Requirements
### Requirement: The server refuses builds below a per-platform minimum
The server SHALL read a minimum supported build for iOS and for Android from operator
configuration, each defaulting to `0`. For every `/v1` request, after the device gate and the
envelope check and before any route admission, the server SHALL refuse a request whose build is
below its platform's minimum with the refusal code `update_required`, status `426`. A legacy
request with no envelope SHALL count as build `0` on both platforms. `GET /healthz` SHALL report
both minimums.

#### Scenario: An old build is turned away
- **WHEN** the Android minimum is 382000 and an Android build 381500 sends a clarify request
- **THEN** the server answers `426` with `update_required` and runs no admission

#### Scenario: The other platform is unaffected
- **WHEN** the Android minimum is 382000 and an iOS build 381500 sends the same request
- **THEN** the request is served

#### Scenario: Minimums off by default
- **WHEN** neither minimum is configured
- **THEN** every build, including a legacy client, is served, and `/healthz` reports both as `0`

### Requirement: The app shows an update screen that blocks AI features, not the app
The app SHALL show a full-screen update prompt when a `/v1` call is refused `update_required`, or
when the launch-time check finds the installed build below its platform's minimum on `/healthz`. The
screen SHALL offer "Update Whim", which opens the app's own store listing, and "Not now", which
returns home with installed apps still usable. The store link SHALL open the store app
(`itms-apps://` or `market://`) and SHALL fall back to the `https://` listing when that fails. The
store identifiers SHALL live in the release configuration. The screen SHALL be a launcher screen
kind with a declared exit.

#### Scenario: A refusal opens the screen
- **WHEN** a user starts a build and the server answers `update_required`
- **THEN** the update screen shows, and the prompt they typed is not lost

#### Scenario: Launch check catches it first
- **WHEN** the app launches below the minimum for its platform and the launch-time check reads the minimum
- **THEN** the update screen replaces home or compose, keeping any typed prompt, without waiting for the user to
  send a request
- **AND** a request sent before the check lands is refused `update_required` and shows the same screen

#### Scenario: Not now keeps the phone's apps
- **WHEN** the user taps "Not now"
- **THEN** home shows, installed apps open and run, and the next AI action shows the screen again

#### Scenario: The store can't open
- **WHEN** the `market://` link can't open
- **THEN** the `https://` Play listing opens instead

### Requirement: Raising a minimum is a documented operator step
`docs/deploy.md` SHALL describe how to raise and lower each minimum: check which build the stores currently serve, set the value, deploy, and confirm on `/healthz`. It SHALL also give the rollback, which is setting the value back and redeploying.

#### Scenario: The runbook names the check
- **WHEN** the operator follows the runbook to raise the iOS minimum
- **THEN** it has them confirm the store's current iOS build before setting the value, and confirm
  the live value on `/healthz` after the deploy

