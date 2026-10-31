## MODIFIED Requirements

### Requirement: An offline build type serves the Android dev loop
The Android build SHALL provide an `offline` build type that embeds the release JS bundle, signs with the debug key, is debuggable, and allows the dev cleartext hosts. `npm run android:release` SHALL build it and install it on exactly one device, the one named by `--device <serial>` or by `ANDROID_SERIAL`, and SHALL refuse before building or installing anything when neither is set or the named device is not attached. It SHALL never install on any other attached device or emulator.
The store upload SHALL never accept an `offline` artifact.

#### Scenario: The emulator reaches a LAN dev server
- **WHEN** `npm run android:release -- --device emulator-5560` installs the app on that emulator and the Settings server address is `http://10.0.2.2:8787`
- **THEN** requests to that server succeed without Metro

#### Scenario: No device named
- **WHEN** `npm run android:release` runs with no `--device` and no `ANDROID_SERIAL`
- **THEN** it exits non-zero naming both ways to pick a device, and nothing is built or installed

#### Scenario: Other attached devices are left alone
- **WHEN** two devices are attached and `npm run android:release -- --device <first>` runs
- **THEN** the app is installed on the first device only, and the second device's installed packages are unchanged

## ADDED Requirements

### Requirement: The Android dev loop script installs on one named device and never opens a packager window
The `npm run android` script SHALL install the debug build on exactly one device, the one named by `--device <serial>` or by `ANDROID_SERIAL`, and SHALL refuse with exit code 2 before building anything when neither is set or the named device is not attached. It SHALL never open a Metro terminal window and SHALL launch the app by its real application id.

#### Scenario: The dev script targets one device and launches the real app
- **WHEN** two devices are attached and `npm run android -- --device <first>` runs
- **THEN** the app is installed on the first device only, launched by its real application id, and no Metro terminal window opens

#### Scenario: The dev script with no device named
- **WHEN** `npm run android` runs with no `--device` and no `ANDROID_SERIAL`
- **THEN** it exits with code 2 naming both ways to pick a device and saying to start Metro first, and nothing is built

### Requirement: The release check refuses scripts that bypass the Android wrappers
The release check SHALL fail on any `package.json` script that runs `react-native run-android` or `run-ios` directly, and on an Android wrapper whose command lacks the no-packager flag or the application id.

#### Scenario: A script that bypasses the wrappers is refused
- **WHEN** `package.json` has a script such as `react-native run-ios` or a bare `react-native run-android`
- **THEN** the release check reports a finding naming that script
