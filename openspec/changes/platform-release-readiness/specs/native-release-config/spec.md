## ADDED Requirements

### Requirement: One native release file declares identity, version and domain
The iOS project and the Android build SHALL read the app id, the Apple team id, the marketing version, the development build number and the release domain from one file, `release/whim-release.xcconfig`, under the keys `WHIM_APP_ID`, `WHIM_APPLE_TEAM_ID`, `WHIM_MARKETING_VERSION`, `WHIM_BUILD_NUMBER` and `WHIM_DOMAIN`.
No tracked text file under `ios/` or `android/` SHALL contain a literal of the app id, the team id or the release domain. `project.pbxproj`, `Info.plist` and `android/app/build.gradle` SHALL NOT contain a literal of the marketing version. The file SHALL hold only `KEY = VALUE` lines, `//` comment lines and blank lines, with no includes and no `$(...)` references, and the release checks SHALL reject any other line, naming its line number. The associated-domain host and the app-link filter host SHALL both be `whim.` followed by `WHIM_DOMAIN`.

#### Scenario: Changing the domain moves both native hosts
- **WHEN** `WHIM_DOMAIN` changes from `example.com` to `anycognition.dev` and no other file is edited
- **THEN** the iOS entitlement resolves to `applinks:whim.anycognition.dev` and the merged Android manifest's app-link filter host is `whim.anycognition.dev`

#### Scenario: A stray literal fails the checks
- **WHEN** `ios/Whim.xcodeproj/project.pbxproj` contains `com.anycognition.whim` as a literal
- **THEN** the release checks fail, naming that file and the literal

#### Scenario: A malformed line is rejected
- **WHEN** the native release file contains `#include "other.xcconfig"`
- **THEN** the release checks fail, naming the line number

### Requirement: The native release domain matches the launcher's release domain
The release checks SHALL fail when `WHIM_DOMAIN` in the native release file differs from the `WHIM_DOMAIN` constant in the launcher's release-configuration module, naming both values.

#### Scenario: Domains drift apart
- **WHEN** the launcher constant is `anycognition.dev` and the native release file still says `example.com`
- **THEN** the release checks fail and the message shows both values

### Requirement: Both apps ship under one identity
Every iOS build configuration and every Android build type SHALL use `WHIM_APP_ID` as the bundle id or application id, with the home-screen name `Whim`.
iOS SHALL sign automatically under `WHIM_APPLE_TEAM_ID`. The Android Kotlin namespace SHALL stay `com.whim`.

#### Scenario: Store artifacts carry the identity
- **WHEN** the iOS Release archive and the Android release AAB are built with `WHIM_APP_ID = com.anycognition.whim` and `WHIM_APPLE_TEAM_ID = 2B7K4YLS34`
- **THEN** the archive's bundle id is `com.anycognition.whim` with team `2B7K4YLS34`, and the AAB's package name is `com.anycognition.whim`

### Requirement: Version numbers come from the release file and the build invocation
Both platforms SHALL take the marketing version from `WHIM_MARKETING_VERSION` and the build number from a value supplied when the build is invoked, falling back to `WHIM_BUILD_NUMBER` when none is supplied.
On iOS the supplied value is the `WHIM_BUILD_NUMBER` build setting on the `xcodebuild` command line. On Android it is the Gradle property `whimBuildNumber`. The marketing version SHALL have the form `MAJOR.MINOR.PATCH`.

#### Scenario: A release run stamps both builds
- **WHEN** a release run builds with build number `369360` and `WHIM_MARKETING_VERSION = 1.0.0`
- **THEN** the iOS build has `CFBundleShortVersionString` `1.0.0` and `CFBundleVersion` `369360`, and the Android build has `versionName` `1.0.0` and `versionCode` `369360`

#### Scenario: A local build uses the development number
- **WHEN** a developer builds either app without supplying a build number
- **THEN** the build number is the file's `WHIM_BUILD_NUMBER`

### Requirement: The Android store build is upload-signed and not debuggable
The Android `release` build type SHALL sign with the upload key described by the `WHIM_UPLOAD_STORE_FILE`, `WHIM_UPLOAD_STORE_PASSWORD`, `WHIM_UPLOAD_KEY_ALIAS` and `WHIM_UPLOAD_KEY_PASSWORD` Gradle properties (or environment variables of the same names), and SHALL NOT be debuggable.
When any of the four is missing, every task that packages the `release` variant SHALL fail with a message naming each missing property and pointing to the mobile release runbook. Configuring or building any other variant SHALL still succeed. The store artifact SHALL be an Android App Bundle.

#### Scenario: No upload key configured
- **WHEN** none of the `WHIM_UPLOAD_*` properties is set and the developer runs `bundleRelease`
- **THEN** the build fails, naming all four properties, and `assembleDebug` and `assembleOffline` still succeed on the same machine

#### Scenario: A configured store build
- **WHEN** the four properties point at the upload keystore and `bundleRelease` runs
- **THEN** the AAB is signed by the upload certificate and its manifest doesn't declare the app debuggable

### Requirement: An offline build type serves the Android dev loop
The Android build SHALL provide an `offline` build type that embeds the release JS bundle, signs with the debug key, is debuggable, and allows the dev cleartext hosts. `npm run android:release` SHALL build and install it.
The store upload SHALL never accept an `offline` artifact.

#### Scenario: The emulator reaches a LAN dev server
- **WHEN** `npm run android:release` installs the app on the emulator and the Settings server address is `http://10.0.2.2:8787`
- **THEN** requests to that server succeed without Metro

### Requirement: Store builds carry no cleartext exception
The Android `release` build type SHALL permit no cleartext traffic to any host, and the dev cleartext hosts SHALL appear only in the `debug` and `offline` build types.
The iOS app SHALL keep App Transport Security's arbitrary loads disabled, with local networking as its only exception.

#### Scenario: A release build refuses http
- **WHEN** a release build of the Android app sends a request to `http://10.0.2.2:8787`
- **THEN** the platform blocks it as cleartext, and the same request from a `debug` or `offline` build succeeds

### Requirement: The iOS app declares its export, device and permission surface
The iOS app SHALL declare `ITSAppUsesNonExemptEncryption` as false, SHALL target iPhone only (`TARGETED_DEVICE_FAMILY = 1`), SHALL support portrait only, and SHALL carry no usage-description key with an empty string.
The Android main activity SHALL also be portrait.

#### Scenario: An empty usage string fails the checks
- **WHEN** `Info.plist` contains `NSLocationWhenInUseUsageDescription` with an empty value
- **THEN** the release checks fail, naming the key

#### Scenario: Upload skips the export question
- **WHEN** a build is uploaded to App Store Connect
- **THEN** App Store Connect doesn't ask the export-compliance question for it

### Requirement: The iOS privacy manifest covers linked native code and collected data
The app-level `PrivacyInfo.xcprivacy` SHALL declare an approved reason for every required-reason API category referenced by native code linked into the app that isn't already declared by a privacy manifest bundled with its pod.
It SHALL declare as collected exactly the data types the App Privacy answers list, each not linked to the user's identity, not used for tracking, and for app functionality. `NSPrivacyTracking` SHALL be false.

#### Scenario: SQLite's disk-space calls are declared
- **WHEN** the app links op-sqlite, whose bundled SQLite references `statfs`-family calls, and op-sqlite ships no privacy manifest
- **THEN** the app-level manifest declares the disk-space category with reason `E174.1`

#### Scenario: Manifest and App Privacy answers agree
- **WHEN** the App Privacy answers list other user content and device ID as collected
- **THEN** the manifest's collected data types are exactly other user content and device ID, and the release checks pass
