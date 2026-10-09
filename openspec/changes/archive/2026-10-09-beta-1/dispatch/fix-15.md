# fix-15: the Play lane uploads only the AAB

`fastlane android closed` failed for 397438 with "Cannot provide both apk(s) and aab": fastlane's `gradle` action
fills the lane context with every APK under `android/app/build/outputs/apk/`, including the offline APK the
release runbook builds for the upgrade check, and `upload_to_play_store` then refuses both. Add
`skip_upload_apk: true` to the `upload_to_play_store` call in `fastlane/Fastfile` (lane `closed`), with a one-line
comment saying why. Add a one-line note to `docs/release/mobile.md`'s Per-release section if it helps a reader.
No other change. Run `./scripts/gate.sh` to FAST GATE PASSED and commit.
