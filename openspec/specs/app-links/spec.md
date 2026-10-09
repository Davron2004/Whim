# app-links Specification

## Purpose
TBD - created by archiving change store-launch-compliance. Update Purpose after archive.
## Requirements
### Requirement: App links have one grammar, built and parsed in one module
The launcher SHALL build an app's link as the release app-link base followed by the launcher id encoded as one URI path segment (`https://whim.<domain>/a/<encodeURIComponent(id)>`), and SHALL parse incoming URLs in the same module. The parser SHALL accept a URL only when its scheme is `https`, its host equals the release web host (case-insensitive), and its path is `/a/` followed by exactly one non-empty segment with at most one trailing slash. It SHALL ignore query and fragment, and return the decoded id. Building and then parsing SHALL return the original id for every launcher id shape: a fresh install id, a seeded example id, and a fork id.

#### Scenario: Round trip over real id shapes
- **WHEN** links are built for a fresh install id, a seeded example id, and a fork id containing `__`, and each is parsed
- **THEN** each parse returns exactly the id it was built from

#### Scenario: Foreign URLs are rejected
- **WHEN** the parser receives `http://whim.<domain>/a/x`, `https://evil.example/a/x`, `https://whim.<domain>/a/`, and `https://whim.<domain>/a/x/y`
- **THEN** it returns no id for any of them

### Requirement: An app link opens the app when it is on this phone
When a link parses to the id of an installed app, the launcher SHALL open that app exactly as a tap on its tile does: full-screen, in a fresh realm, with the opening busy state. This SHALL hold for a link that launched the process (the initial URL) and for a link that arrives while the process is running. A link to the app that is already open SHALL leave it as it is.

#### Scenario: Cold start from a link
- **WHEN** Whim is not running and the user taps an app link for an installed app
- **THEN** Whim starts, finishes loading the grid, and opens that app

#### Scenario: The same app is already open
- **WHEN** the linked app is already the running mini-app
- **THEN** nothing changes and the app keeps its current screen

### Requirement: A link to a pending build opens that build's screen
When a link's id has no installed app but matches a pending-build record, the launcher SHALL open the screen a tap on its ghost tile opens: the build-progress screen for a `building` record, which sends no new request, and the hydrated failure screen for a `failed` or `interrupted` record.

#### Scenario: A link to a build still running
- **WHEN** the link's id matches a `building` record
- **THEN** the build-progress screen for that build opens and no request is sent

### Requirement: A link to an app that isn't on this phone shows a friendly screen
When a link's id matches neither an installed app nor a pending build, the launcher SHALL show a full-screen state titled `This app lives on another phone`. Its body SHALL explain in plain words that apps made with Whim stay on the phone that made them, so the link only opens there, and its one action, `Back to your apps`, SHALL go Home. System back SHALL also go Home. The screen SHALL render inside the launcher's error boundary and SHALL send no request.

#### Scenario: A link from someone else's phone
- **WHEN** the user opens a link whose id isn't installed and has no pending build on this phone
- **THEN** the "lives on another phone" screen shows, and `Back to your apps` returns to the grid

### Requirement: An arriving link leaves the current screen through that screen's own safe exit
Before opening a link's target, the launcher SHALL leave whatever is showing the way that screen's own non-destructive exit does. A running mini-app exits and its realm is torn down. The build screen behaves as `Leave it running`, and the failure screen as its non-destructive Back. The compose, clarify, and plan steps go Home under their existing cancellation rules, the consent screen declines as `Not now`, any open sheet closes without acting, and Settings or History go Home. A link SHALL NOT cancel a running build, delete a pending record, or grant consent.

#### Scenario: A link during a build
- **WHEN** a build is streaming on the build screen and a link to another installed app arrives
- **THEN** the build keeps running behind a building ghost tile, and the linked app opens

#### Scenario: A link over an open report sheet
- **WHEN** the report sheet is open with a reason chosen and a link arrives
- **THEN** the sheet closes without posting, and the link's target opens

### Requirement: A link that arrives before the launcher is ready waits
A link that arrives before the launcher has finished its first-run and load work SHALL be held and resolved once the grid is ready. When several links arrive before then, only the last SHALL be resolved.

#### Scenario: Link during first launch
- **WHEN** the process is started by a link while first-run seeding is still running
- **THEN** seeding completes, and the link then resolves as it would on a ready launcher

### Requirement: URLs that aren't app links are ignored
A URL delivered to the launcher that the parser rejects SHALL cause no navigation. It SHALL be recorded through the logging seam with only its scheme and host.

#### Scenario: An unrelated URL
- **WHEN** the launcher receives a URL for another host
- **THEN** the current screen is unchanged, and the log record names only the scheme and host

### Requirement: Every installed app can reveal its link from the home grid
The tile long-press action sheet of an installed app SHALL carry an `App link` action. It SHALL open a sheet naming the app and showing its link as selectable text that the system copy menu can copy, with one line saying the link opens the app on this phone. Ghost tiles SHALL NOT offer it.

#### Scenario: Revealing a link
- **WHEN** the user long-presses an installed app's tile and chooses `App link`
- **THEN** a sheet shows that app's link as selectable text, and parsing the shown text returns the app's id

#### Scenario: No link for a ghost
- **WHEN** the user long-presses a ghost tile
- **THEN** the offered actions include no `App link`

### Requirement: The iOS app delivers universal links to the launcher
The iOS app SHALL declare the associated domain `applinks:whim.<WHIM_DOMAIN>` through the `Whim` target's entitlements file, and SHALL forward both `application(_:continue:restorationHandler:)` and `application(_:open:options:)` to React Native's linking manager.
The launcher SHALL receive the full, unmodified `https` URL: through `Linking.getInitialURL()` when the link launched the app, and through the `url` event when the app was already running.

#### Scenario: Cold start from a universal link
- **WHEN** Whim isn't running and the user taps `https://whim.<domain>/a/app-abc` on an iPhone where the association file is served
- **THEN** Whim launches and `Linking.getInitialURL()` returns exactly that URL

#### Scenario: Warm link
- **WHEN** Whim is in the background and the user taps an app link
- **THEN** Whim comes forward and the launcher's `url` listener receives exactly that URL

### Requirement: The Android app verifies and delivers app links
The Android launcher activity SHALL declare, next to MAIN/LAUNCHER, an intent filter with `android:autoVerify="true"`, action `VIEW`, categories `DEFAULT` and `BROWSABLE`, scheme `https`, host `whim.<WHIM_DOMAIN>` and path prefix `/a/`, and SHALL keep `launchMode="singleTask"`.
A link that arrives while the app is running SHALL reach the existing launcher as a `url` event rather than starting a second activity.

#### Scenario: A warm link on Android
- **WHEN** the app is running and `adb shell am start -a android.intent.action.VIEW -d https://whim.<domain>/a/app-abc` is sent
- **THEN** the running launcher receives that URL as a `url` event and no second activity starts

#### Scenario: Verification once assetlinks is served
- **WHEN** `https://whim.<domain>/.well-known/assetlinks.json` is served with the release certificate fingerprints and verification is re-run
- **THEN** `adb shell pm get-app-links com.anycognition.whim` reports the host as verified

### Requirement: The release tooling prints the exact association files
The release tooling SHALL print the Apple app site association file and the Digital Asset Links file ops must serve, built from `WHIM_APPLE_TEAM_ID`, `WHIM_APP_ID` and the recorded certificate fingerprints, in the shapes store-launch-compliance design D17 fixes.
The AASA file SHALL be `{"applinks":{"details":[{"appIDs":["<team>.<app id>"],"components":[{"/":"/a/*"}]}]}}`. The assetlinks file SHALL list the Play App Signing fingerprint first and the upload key fingerprint second. When either fingerprint file is missing or malformed, the command SHALL fail and name it.

#### Scenario: Files for the real team
- **WHEN** the team id is `2B7K4YLS34`, the app id is `com.anycognition.whim`, and both fingerprint files hold colon-separated SHA-256 values
- **THEN** the AASA lists `2B7K4YLS34.com.anycognition.whim` with component `/a/*`, and the assetlinks file names package `com.anycognition.whim` with both fingerprints

#### Scenario: The Play signing fingerprint isn't recorded yet
- **WHEN** `release/android-play-signing-cert.sha256` doesn't exist
- **THEN** the command exits non-zero and names that file

