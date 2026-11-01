# Beta-2 release status

Updated 2026-10-31 (evening, EDT) by the beta-2 release orchestrator. Owner checklist:
`docs/release/beta-2-owner-steps.md`.

## Builds

Both store builds are **1.1.0 (437758)**, built from `e7aef331` (the tip of `release/beta-2` at build
time). Later commits on the branch touch only server tests, the deploy smoke, docs and the committed
Play signing fingerprint; none of them changes the app binary. Local tag `release/1.1.0+437758`
(not pushed; the integration orchestrator pushes it with the merge if wanted). Source maps:
`gs://anycognition-whim-sourcemaps/{ios,android}/1.1.0+437758.map`.

| | iOS | Android |
|---|---|---|
| Artifact | TestFlight build f3b51274-c973-45ae-a0b2-67dba3743e6a, VALID | `~/.cache/whim-upgrade/beta-2/app-release-437758.aab` (3 ABIs, verified, signed with the new upload key 92:D0:6D:…:76:82) |
| Where | Groups `Team` (internal, testing) and `Public beta` (external) | Not uploaded: Play refuses uploads until the new upload key is valid, **2026-11-02 23:59 UTC** |
| Review | Beta App Review submitted 2026-10-31 20:44 EDT, `WAITING_FOR_REVIEW` | — |
| Public entry | https://testflight.apple.com/join/tM69UkDf (serves 382511 until 437758 is approved) | Opt-in https://play.google.com/apps/testing/com.anycognition.whim, track "Closed testing - Alpha" (382511 live, 397438 draft) |

**Next agent step (from 2026-11-03 00:00 UTC):** upload the existing AAB to the alpha track and roll
it out (`fastlane android closed build:437758 status:completed` rebuilds from source; to ship the exact
AAB already built, use `fastlane supply --aab ~/.cache/whim-upgrade/beta-2/app-release-437758.aab
--track alpha --release_status completed --json_key ~/.config/whim/play-publisher.json
--package_name com.anycognition.whim --skip_upload_metadata --skip_upload_images
--skip_upload_screenshots`), discard the 397438 draft in the same edit, add release notes, then tag
nothing new (the tag already exists). Gcloud needs `CLOUDSDK_CORE_ACCOUNT=j.ruzimetova@gmail.com
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14`.

## Credentials recreated 2026-10-31 (all lost in the 2026-10-10 wipe)

- Android upload key `~/.config/whim/whim-upload.jks` (new; passwords in `~/.gradle/gradle.properties`),
  upload-key reset requested in Play Console, valid 2026-11-02 23:59 UTC.
- Play API key `~/.config/whim/play-publisher.json` (new key 38f3d409… on the existing service account).
- ASC API key 4V4UN8R5H9 (Admin, issuer 2ee935d2-880f-44b8-a3d2-222b4ee95e96),
  `~/.config/whim/asc-api-key.json`; `review-contact.json` from the TestFlight review contact.
- Owner must back these up (owner steps §1).

## Checks

- **Android release acceptance (#38), emulator API 37 / WebView 156:** PASS except the themed icon
  (monochrome layer present; this image's launcher renders no themed icons). Network deny zero run
  `NETDENY PASS expect=zero bundles=6 hits=0 tls=0`, negative control `expect=leak hits=6 tls=2`, DNS
  observed through a logging resolver (no `wnd-` query with the deny on; the query appears with it
  off). Storage and bridge probes PASS; seeded and storage apps work under the deny. API 29 not
  installed. Evidence: `~/.cache/whim-upgrade/accept-android/result.md`.
- **Upgrade check 397438 → 437758:** BLOCKED on both platforms at the seed step. `seed.yaml` was
  written against 382511's Settings screen (iOS: the Advanced row sits at the bottom edge and the tap
  never expands it; Android: the keyboard-drop tap target scrolls away). The candidate was not
  exercised. Evidence: `~/.cache/whim-upgrade/upgrade-check/result.md` and `blocked-run-1/`.
  **Risk:** the iOS build is already in Beta App Review. If the upgrade check then fails, remove
  437758 from `Public beta` (App Store Connect → TestFlight → Public beta → Builds) before testers get it.
- **Association files (#42):** the committed Play signing fingerprint was wrong. Play signs every
  delivered APK with `25:90:6F:…:53:F3` (Play API `generatedApks`, and Play Console's Digital Asset Links
  snippet); `E4:58:10:2B:…` is a previous app signing key. The published `assetlinks.json` therefore
  can't verify app links for any Play install. Fixed on this branch; **needs a `deploy/deploy.sh
  --site-only` (or the Cloud Run site deploy) from the merged checkout** by the integration
  orchestrator, then `curl https://whim.anycognition.ca/.well-known/assetlinks.json` must list
  `25:90:6F…` and `92:D0:6D…`. AASA is correct (`2B7K4YLS34.com.anycognition.whim`, `/a/*`). Device
  link checks are owner steps §5.

## Not done here (by design)

- `WHIM_MIN_BUILD_*` stays 0; raise to 437758 after testers have the build (integration orchestrator).
- No emails, invites or testers added. Play tester group: owner steps §2 (captcha).
- #39 and the owner device checklist need physical phones: owner steps §5.
