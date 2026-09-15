# Mobile release runbook

Every command below is attended — a human runs it from a machine holding the credentials.
Nothing in `scripts/gate.sh`, `scripts/gate-full.sh` or CI calls `fastlane`
(specs/store-release-pipeline/spec.md "Releasing is one attended lane per platform"). Lane
definitions live in `fastlane/Fastfile`; the checkable logic they call
(`node scripts/release/run.mjs <command>`) is documented in `handoff/release-cli.md` inside the
`platform-release-readiness` change folder — this doc is the human-facing half.

## One-time setup

### Directory and file modes

```sh
mkdir -p ~/.config/whim && chmod 700 ~/.config/whim
```

Every credential file under `~/.config/whim/` must be `chmod 600` (the preflight refuses a file
readable by group or other). After copying each file in below, run:

```sh
chmod 600 ~/.config/whim/asc-api-key.json ~/.config/whim/AuthKey_*.p8 \
  ~/.config/whim/play-publisher.json ~/.config/whim/review-contact.json \
  ~/.config/whim/whim-upload.jks
```

None of these files are committed — `.gitignore` excludes `*.jks`, `*.p8` and
`play-publisher*.json` (task 12.4), and `asc-api-key.json`/`review-contact.json` never belong in
the tree either.

### App Store Connect

1. Sign in to App Store Connect as a user on team `2B7K4YLS34` (AnyCognition Inc.).
2. **Users and Access → Integrations → App Store Connect API**: create a key with the App
   Manager role. Download `AuthKey_<key id>.p8` **once** (Apple won't offer it again) to
   `~/.config/whim/AuthKey_<key id>.p8`.
3. Write `~/.config/whim/asc-api-key.json`:
   ```json
   { "key_id": "<key id>", "issuer_id": "<issuer id>", "key_filepath": "/Users/you/.config/whim/AuthKey_<key id>.p8" }
   ```
4. Write `~/.config/whim/review-contact.json` (fastlane's `app_review_information` shape):
   ```json
   { "first_name": "...", "last_name": "...", "phone_number": "+1...", "email_address": "...", "notes": "..." }
   ```
5. Confirm the app exists under bundle id `com.anycognition.whim`. If not, create it once, by
   hand, in App Store Connect.

### Google Play Console

The Play app lives in a **personal** developer account. Two consequences:

- Production access needs a closed test with **12+ opted-in testers held for 14 days**, tracked
  from Play Console, before Play allows a production release. Nothing here automates that wait.
- **The first AAB must be uploaded by hand** in Play Console — the Play Developer API refuses
  uploads to an app with no prior release. Automated uploads only start working after that.

1. Sign in to Play Console with the personal account. The app already exists
   (ID `4972827149871085117`), package `com.anycognition.whim`.
2. Confirm `play-publisher@anycognition-whim.iam.gserviceaccount.com` already holds app-level
   release permissions (it does — nothing to grant here).
3. Download that service account's JSON key to `~/.config/whim/play-publisher.json`.
4. Under **Testing → Closed testing**, create (or confirm) the alpha track and add at least 12
   testers who accept the opt-in link. The 14-day clock starts once they've joined and a release
   is live on the track.

### Android signing key

```sh
keytool -genkeypair -v -keystore ~/.config/whim/whim-upload.jks -alias whim-upload \
  -keyalg RSA -keysize 2048 -validity 10000
chmod 600 ~/.config/whim/whim-upload.jks
```

Add the four `WHIM_UPLOAD_*` values to `~/.gradle/gradle.properties` (or the environment):

```properties
WHIM_UPLOAD_STORE_FILE=/Users/you/.config/whim/whim-upload.jks
WHIM_UPLOAD_STORE_PASSWORD=...
WHIM_UPLOAD_KEY_ALIAS=whim-upload
WHIM_UPLOAD_KEY_PASSWORD=...
```

Compute the upload key's fingerprint and commit it (this one file IS committed — it's a public
fingerprint, not a secret):

```sh
keytool -exportcert -alias whim-upload -keystore ~/.config/whim/whim-upload.jks -rfc | \
  openssl x509 -noout -fingerprint -sha256 > release/android-upload-cert.sha256
```

### bundletool

`fastlane android closed` verifies the AAB with `bundletool` before upload
(specs/store-release-pipeline/spec.md "Only a verified store AAB is uploaded"). Install it once:

```sh
brew install bundletool
```

## The first manual Play upload

1. Build a signed AAB without uploading:
   ```sh
   fastlane android closed upload:false
   ```
   This runs the preflight, builds `android/app/build/outputs/bundle/release/app-release.aab`,
   and verifies it, printing the path.
2. In Play Console, under the alpha (closed testing) track, upload that AAB by hand and publish
   the release.
3. **Right after that upload**, get the Play signing certificate's SHA-256 from Play Console
   (**App integrity → App signing key certificate**) and commit it:
   ```sh
   echo "<the fingerprint Play shows>" > release/android-play-signing-cert.sha256
   git add release/android-play-signing-cert.sha256 && git commit -m "..."
   ```
   From here on, `fastlane android closed` (without `upload:false`) uploads through the API.

## Per-release commands

```sh
fastlane ios testflight
# ⇒ preflight, archive, upload, prints the build number it used
fastlane android closed build:<the number ios printed>
```

Passing the number the first platform's lane prints to the second gives both platforms the same
`CFBundleVersion`/`versionCode`
(specs/store-release-pipeline/spec.md "Each lane uses one time-derived build number"). Run
`fastlane ios testflight` first — recomputing the number twice a minute apart still gives each
platform a different one, so always hand off the printed value rather than running both lanes
bare.

Listing content, once `release/store/` has real copy and screenshots:

```sh
fastlane ios metadata      # deliver: no binary, no submission
fastlane ios privacy       # App Privacy upload — needs an interactive Apple ID session
fastlane android metadata  # supply: no binary
```

An internal smoke build that reaches no server yet:

```sh
fastlane ios testflight placeholder_domain:true
```

## Replacing the icon artwork

Replace `release/assets/icon-foreground.svg` (or `.png`) and/or `release/assets/brand.json`,
then:

```sh
node scripts/release/run.mjs generate-assets
node scripts/release/run.mjs check
```

Commit every file `generate-assets` writes (it's deterministic — rerunning without a source
change reproduces the same bytes).

## Changing the domain

`WHIM_DOMAIN` lives in exactly two places, both of which must agree:

- `release/whim-release.xcconfig` (native builds, the release CLI, the Fastfile's URL derivation)
- `src/host/launcher/release-config.ts` (the app's own runtime constant)

The domain-lockstep suite (`checks/test/release/domain-lockstep.suite.ts`) fails the gate if they
drift — edit both in the same commit.

## Association files (AASA / assetlinks)

These are **never hand-delivered to ops**. Once both `release/android-upload-cert.sha256` (set
up above) and `release/android-play-signing-cert.sha256` (committed after the first Play upload)
exist, the public-generation-server change's `deploy/deploy.sh --site-only` builds them straight
from `node scripts/release/run.mjs association-files` run against the same checkout and publishes
them at `/.well-known/`. See that change's `design.md` ("Association files are printed, not
committed" and its D22 amendment) for the deploy mechanics — this doc only tracks when the two
fingerprint files are ready to commit. Confirm with:

```sh
curl -sI https://whim.<domain>/.well-known/apple-app-site-association
curl -sI https://whim.<domain>/.well-known/assetlinks.json
```

## Troubleshooting

- **`npm run android:release` fails or the emulator won't pick up the offline APK.** It runs
  `react-native run-android --mode offline --active-arch-only`. If the install step alone fails,
  fall back to Gradle directly: `cd android && ./gradlew installOffline`.
- **A 32-bit Android native build fails during `fastlane android closed`.** Fall back to an
  arm64-only store build by running the Gradle step yourself with the narrower architecture list,
  then resume from `verify-aab`:
  ```sh
  bundle exec fastlane run gradle project_dir:"$(pwd)/android" task:"bundle" build_type:"Release" \
    properties:'{"whimBuildNumber":"<n>","reactNativeArchitectures":"arm64-v8a"}'
  node scripts/release/run.mjs verify-aab android/app/build/outputs/bundle/release/app-release.aab --build <n>
  ```
  This ships a store build that only 64-bit ARM devices can install (design D13) — use it only
  as a stopgap, and retry the three-ABI build for the next release.
- **A tester needs the app talking to a LAN dev server.** The store AAB and the TestFlight
  archive both forbid cleartext traffic, so neither can use an http Advanced Settings override
  (compliance D7) — only the `offline` APK (`npm run android:release`) can. iOS can still reach a
  LAN IP directly, since ATS exempts numeric hosts and local networking stays enabled.
- **fastlane reports a version below `2.237.0`.** `brew upgrade fastlane`; the Fastfile's
  `min_fastlane_version` refuses to load otherwise.
- **A lane crashes instead of naming a clean preflight finding.** Every lane calls the preflight
  before touching a build, but the store-latest lookups it needs (`latest_testflight_build_number`,
  `google_play_track_version_codes`) run just before that call and need the same credentials —
  they degrade to "0" on any error so the preflight, not a raw exception, reports the real
  problem next.

## What's attended vs. checked

The preflight (`node scripts/release/run.mjs preflight`) and the fast gate both run the same
`scripts/release/lib/` checks, but only the preflight also validates live credentials, the
working tree and the store's current build number — it runs once per release, by a human, never
from CI. Everything under `fastlane/` is the same: attended only. `fastlane ios privacy` and the
first Play upload additionally need an interactive session (an Apple ID sign-in, and a Play
Console visit) that no service-account key covers.
