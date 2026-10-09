## ADDED Requirements

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
