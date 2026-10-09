## ADDED Requirements

### Requirement: Releasing is one attended lane per platform
Building, signing and uploading SHALL each be one fastlane lane per destination: `ios testflight` uploads to TestFlight, `android closed` uploads to the Play closed-testing track, and `ios metadata` and `android metadata` push listing content.
Every lane SHALL run the preflight first and stop at its first failure. The Fastfile SHALL refuse to load under a fastlane older than its pinned minimum version. No lane SHALL run from `scripts/gate.sh`, `scripts/gate-full.sh`, CI or any unattended harness run.

#### Scenario: A TestFlight upload
- **WHEN** an operator runs `fastlane ios testflight` on a clean tree with valid credentials and a real domain
- **THEN** the lane runs the preflight, archives the Release configuration, uploads the build to TestFlight, and prints the marketing version and build number it used

#### Scenario: A closed-testing upload
- **WHEN** an operator runs `fastlane android closed`
- **THEN** the lane runs the preflight, builds the release AAB with all three store ABIs, verifies it, and uploads it to the closed testing track as a draft release unless the operator passes `status:completed`

### Requirement: The preflight names every reason it refuses
Before any build, the preflight SHALL check every condition below and SHALL exit non-zero listing each one that fails, with the fix for each.
- the working tree is clean
- Node is major version 22, the JDK is 21 (Android), and Xcode is present (iOS)
- each required credential file under `~/.config/whim/` exists and isn't readable by group or others
- the upload-key Gradle properties are set (Android)
- `WHIM_DOMAIN` isn't `example.com`, unless the operator passed the explicit placeholder override
- the listing checks and the asset checks pass
- the run's build number is greater than the highest build number the store already has for the app

#### Scenario: Several problems at once
- **WHEN** the tree has uncommitted changes and `~/.config/whim/play-publisher.json` has mode 0644
- **THEN** the preflight exits non-zero and lists both problems, each with its fix, and no build starts

#### Scenario: The placeholder domain
- **WHEN** `WHIM_DOMAIN` is `example.com` and the operator didn't pass the override
- **THEN** the preflight refuses and says the build couldn't reach any server

### Requirement: Each lane uses one time-derived build number
Each build-and-upload lane SHALL use the build number the operator passes as `build:<n>`, or else compute it once at lane start as the whole minutes elapsed since 2026-01-01T00:00Z (UTC). It SHALL give that one number to both the build and the upload, and print it.
Passing the number printed by the first platform's lane to the second gives both platforms the same build number.

#### Scenario: Deriving the number
- **WHEN** a lane starts at 2026-09-14T12:00:30Z without `build:`
- **THEN** its build number is `369360`

#### Scenario: Matching numbers across platforms
- **WHEN** `fastlane ios testflight` prints build number `369360` and the operator then runs `fastlane android closed build:369360`
- **THEN** the iOS `CFBundleVersion` and the Android `versionCode` are both `369360`

#### Scenario: The store already has a higher build
- **WHEN** the computed number is `369360` and TestFlight's latest build for the app is `369400`
- **THEN** the preflight refuses and names both numbers

### Requirement: Only a verified store AAB is uploaded
The Android lane SHALL upload an AAB only when its signer certificate's SHA-256 matches `release/android-upload-cert.sha256`, its package name is `WHIM_APP_ID`, its version code is the run's build number, and its manifest doesn't declare the app debuggable. Otherwise it SHALL stop, naming the mismatch.

#### Scenario: Signed with the wrong key
- **WHEN** the AAB is signed with the debug key
- **THEN** the lane stops before upload, showing the expected and actual fingerprints

### Requirement: The iOS lane audits required-reason APIs before upload
After archiving, the iOS lane SHALL list the required-reason API categories referenced by the app's binaries and SHALL refuse to upload when a category isn't declared by any privacy manifest bundled in the app, naming the category and a referencing symbol.

#### Scenario: An undeclared category
- **WHEN** the archived binary references `statfs` and no bundled manifest declares the disk-space category
- **THEN** the lane stops before upload, naming the disk-space category and `statfs`

### Requirement: Credentials never enter the repository
The release tooling SHALL read credentials only from fixed paths outside the repository: the upload keystore `~/.config/whim/whim-upload.jks`, the App Store Connect API key description `~/.config/whim/asc-api-key.json` and the `.p8` it names, the Play service account `~/.config/whim/play-publisher.json`, the review contact `~/.config/whim/review-contact.json`, and the `WHIM_UPLOAD_*` values from `~/.gradle/gradle.properties` or the environment.
Only public certificate fingerprints SHALL be committed.

#### Scenario: The repository holds no secret
- **WHEN** the repository is searched after a successful release
- **THEN** it contains no keystore, `.p8`, service account JSON, password or reviewer contact, and the only signing material is the two fingerprint files

### Requirement: A successful upload is tagged
After a successful upload, the lane SHALL create a local annotated git tag `release/<marketing version>+<build number>` on the built commit, reusing the tag when the other platform's lane already created it for the same commit, and SHALL NOT push it.

#### Scenario: Both platforms with the same number
- **WHEN** the iOS and Android lanes both upload build `369360` of `1.0.0` from the same commit
- **THEN** exactly one local tag `release/1.0.0+369360` exists and points at that commit
