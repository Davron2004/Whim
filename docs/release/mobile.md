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
keytool -genkeypair -v -storetype PKCS12 -keystore ~/.config/whim/whim-upload.jks \
  -alias whim-upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=AnyCognition Inc., O=AnyCognition Inc."
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
fingerprint, not a secret). `parseFingerprintFile` expects 32 colon-separated hex bytes with no
label, which is what `-list -v` plus this `awk` gives — not the `sha256 Fingerprint=...`-prefixed
line `openssl x509 -fingerprint` prints:

```sh
keytool -list -v -keystore ~/.config/whim/whim-upload.jks -alias whim-upload | \
  awk '/SHA256:/{print $2}' > release/android-upload-cert.sha256
```

### bundletool

`fastlane android closed` verifies the AAB with `bundletool` before upload
(specs/store-release-pipeline/spec.md "Only a verified store AAB is uploaded"). Install it once:

```sh
brew install bundletool
```

### Source-map bucket

Both lanes upload the build's Hermes source map to the private bucket
`gs://<WHIM_GCP_PROJECT>-sourcemaps` (`gs://anycognition-whim-sourcemaps`; `deploy/provision.sh`
creates it) and stop if that fails. The machine running the lanes needs the Google Cloud CLI
(`gcloud`, the same one the deploy scripts use), signed in with an account that can write objects
there:

```sh
gcloud auth login
```

The project comes from `deploy/defaults.env`, then `~/.config/whim/deploy.env`, then the
environment, the same as the deploy scripts.

## The first manual Play upload

1. Build a signed AAB without uploading:
   ```sh
   fastlane android closed upload:false
   ```
   This runs the preflight, builds `android/app/build/outputs/bundle/release/app-release.aab`,
   verifies it and uploads its source map, printing the path.
2. In Play Console, under the alpha (closed testing) track, upload that AAB by hand and publish
   the release.
3. **Right after that upload**, get the Play signing certificate's SHA-256 from Play Console
   (**App integrity → App signing key certificate**) and commit it:
   ```sh
   echo "<the fingerprint Play shows>" > release/android-play-signing-cert.sha256
   git add release/android-play-signing-cert.sha256 && git commit -m "..."
   ```
   From here on, `fastlane android closed` (without `upload:false`) uploads through the API.

## Upgrade check (required before any beta build ships)

No beta build goes to TestFlight or the Play closed track until the upgrade check has passed on a
fresh emulator and on a newly created simulator (specs/release-upgrade-check). The check installs
the previous release, seeds it, installs the candidate over it, and fails unless every app tile,
version count, saved datum, the consent grant and the device id are unchanged. A failure blocks the
release.

**Evidence** goes to the releasing change's folder: pass
`--evidence openspec/changes/<id>/upgrade-check/<platform>` and commit `before.json` (the seed
record), `after.json` and `result.txt`. The raw captures under `raw/` stay local (the script writes
a `.gitignore` for them). Then add one line per platform to that change's `progress.md`, for
example `upgrade check android 382511 → <candidate build>: PASS (upgrade-check/android/result.txt)`.

Both sides are built from source on the same machine, because a store artifact can't go on a
simulator and Android only installs an upgrade signed with the same key. The previous release's
commit is its release tag: `git rev-parse 'release/1.0.0+382511^{commit}'` gives `a9b03c47`.

1. Check out the previous release next to the repo and build it with its own build number:
   ```sh
   git worktree add ~/.cache/whim-upgrade/382511 release/1.0.0+382511
   cd ~/.cache/whim-upgrade/382511 && npm ci && npm run build
   (cd android && ./gradlew :app:assembleOffline -PwhimBuildNumber=382511)
   cp android/app/build/outputs/apk/offline/app-offline.apk ~/.cache/whim-upgrade/from.apk
   mkdir -p vendor && ln -s <repo>/vendor/bundle vendor/bundle
   (cd ios && bundle exec pod install && xcodebuild -workspace Whim.xcworkspace -scheme Whim \
     -configuration Release -sdk iphonesimulator -derivedDataPath build/sim WHIM_BUILD_NUMBER=382511 build)
   ```
   A fresh worktree has no `vendor/bundle` (gems are never committed), so `bundle exec pod install`
   fails there until it borrows the repo's gems. The symlink is safe while both checkouts have the
   same `Gemfile.lock`; if they differ, run `bundle install` in the worktree instead.
   The simulator app is `ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app`. Android
   takes the `offline` build: it's debug-signed (so the upgrade installs) and debuggable (so the
   script can read the app's store with `run-as`).
2. Build the candidate the same way from its own checkout, with a higher build number
   (`node scripts/release/run.mjs build-number`). In this repo, restore `ios/Podfile.lock` after the
   build if `pod install` changed it.
3. Start the previous release's server in stub mode, from its checkout. The candidate's server
   answers 426 to a build that doesn't send `x-whim-protocol`. Up to 382511, the plan step
   (`/v1/rewrite`) has no stub, so the server needs the model key and roster from `.env`. Generation
   stays stubbed, and every generated app is named "Hello App":
   ```sh
   cd ~/.cache/whim-upgrade/382511
   WHIM_PIPELINE=stub WHIM_DATA_DIR="$(mktemp -d)" node --env-file=<repo>/.env server/dev.mjs
   ```
4. From the candidate's checkout, run the check for each platform:
   ```sh
   scripts/release/upgrade-check.sh --platform android --avd Whim_Verify \
     --from ~/.cache/whim-upgrade/from.apk --to android/app/build/outputs/apk/offline/app-offline.apk \
     --evidence openspec/changes/<id>/upgrade-check/android
   scripts/release/upgrade-check.sh --platform ios \
     --from ~/.cache/whim-upgrade/382511/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app \
     --to ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app \
     --evidence openspec/changes/<id>/upgrade-check/ios
   ```
   Android boots the AVD with `-wipe-data` on port 5580 (`--emulator-port`) and forwards the server
   port with `adb reverse`. iOS creates and deletes its own iPhone 15 Plus simulator (`--sim-type`).
   `--keep-device` leaves the device up for a look after a failure.

The seed flow (`scripts/release/upgrade-check/seed.yaml`) is written against 382511's screens. When
the check fails, the script names the step and keeps Maestro's log and screenshots under `raw/maestro`.
On iOS a pressable reads as one element whose label joins its texts, so the flows match a tile's name
inside that label and tap the tile menu's rows by position (the script measures the screen first).
The seed gets past 382511's undismissable compose keyboard (#50) by switching to the emoji keyboard,
after which a tap on the headline drops it. Maestro has crashed SpringBoard on this machine before;
if the seed step fails there, rerun with `--manual-seed`: the script waits while you seed by hand,
then reads and diffs as usual. From beta-1 on, a Release iOS build ignores the server-address
override (legal-surface-v2 D10), so the iOS seed for the release after beta-1 needs a
previous-release build that honours the override.

## Per-release commands

Run the [upgrade check](#upgrade-check-required-before-any-beta-build-ships) first.

```sh
fastlane ios testflight
# ⇒ preflight, archive, source-map upload, TestFlight upload, prints the build number it used
fastlane android closed build:<the number ios printed>
```

Passing the number the first platform's lane prints to the second gives both platforms the same
`CFBundleVersion`/`versionCode`
(specs/store-release-pipeline/spec.md "Each lane uses one time-derived build number"). Run
`fastlane ios testflight` first — recomputing the number twice a minute apart still gives each
platform a different one, so always hand off the printed value rather than running both lanes
bare.

After verifying the build and before the store upload, each lane uploads its composed Hermes
source map to `<platform>/<version>+<build>.map` in the source-map bucket
(specs/device-diagnostics "Release builds keep a source map for every shipped bundle"). Android
takes it from `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map`;
iOS passes `SOURCEMAP_FILE=ios/build/sourcemaps/main.jsbundle.map` to the archive's bundle phase.
Each lane deletes that file before building, so a map from an earlier build is never uploaded. If
the map is missing or the upload fails, the lane stops before the store upload, so no build ships
without its map. Fix the cause (usually `gcloud auth login`) and rerun the lane with the same
`build:<n>`; the retry overwrites the earlier map.

## Reading a device stack

A device record's `stack` names bytecode offsets in the release bundle
(`at fn (address at index.android.bundle:1:650735)`). To turn them into `src/` files and lines,
pipe the stack in with the record's platform, version and build:

```sh
node scripts/symbolicate.mjs android 1.0.0 369360 < stack.txt
```

Each bundle frame prints as `<source file>:<line>:<function>`. When the bucket has no map for that
platform, version and build, the script exits non-zero and names the missing
`<platform>/<version>+<build>.map`; it never uses another build's map. `--maps-dir <dir>` reads
from a local directory laid out like the bucket (`<dir>/android/1.0.0+369360.map`) instead.

Listing content, once `release/store/` has real copy and screenshots:

```sh
fastlane ios metadata      # deliver: no binary, no submission
fastlane ios privacy       # App Privacy upload — needs an interactive Apple ID session
fastlane android metadata  # supply: no binary
```

`fastlane ios metadata`'s summary table prints `review-contact.json`'s reviewer name, phone number
and email address to the terminal (deliver masks only `demo_password`; there's no option to hide
the rest — checked `deliver/lib/deliver/runner.rb` on the installed 2.237.0). Run it somewhere
that log isn't shared.

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

`WHIM_DOMAIN` lives in three places, all of which must agree:

- `release/whim-release.xcconfig` (native builds, the release CLI, the Fastfile's URL derivation)
- `src/host/launcher/release-config.ts` (the app's own runtime constant)
- `deploy/defaults.env` (`WHIM_API_HOST`/`WHIM_WEB_HOST`, derived from the same domain)

The domain-lockstep suite (`checks/test/release/domain-lockstep.suite.ts`) fails the gate if any
of them drift — edit all three in the same commit.

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
  then resume from `verify-aab` and upload the map yourself:
  ```sh
  fastlane run gradle project_dir:"$(pwd)/android" task:"bundle" build_type:"Release" \
    properties:'{"whimBuildNumber":"<n>","reactNativeArchitectures":"arm64-v8a"}'
  node scripts/release/run.mjs verify-aab android/app/build/outputs/bundle/release/app-release.aab --build <n>
  node scripts/release/run.mjs upload-source-map --platform android --build <n> \
    android/app/build/generated/sourcemaps/react/release/index.android.bundle.map
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
