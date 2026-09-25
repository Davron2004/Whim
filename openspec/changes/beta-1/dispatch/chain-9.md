# chain-9 dispatch block: release-upgrade-check (tasks 9.1–9.3)

Read: `specs/release-upgrade-check/spec.md` (whole), `design.md` §D15, `docs/release/mobile.md`, and the memory
facts below.

Facts the design didn't have (orchestrator, 2026-09-25):
- A TestFlight/Play artifact can't go on a simulator, and Android `install -r` needs the same signing key on
  both builds. So both sides of the check are builds from source (the previous release's commit and the
  candidate), made on this machine with the same keys. The script takes built artifacts: `--from <path to
  .apk|.app>` and `--to <path>`. `docs/release/mobile.md` documents how to build an artifact from a commit,
  including how to find 382511's commit (git tag, release notes or handoff docs — find it and name it).
- The previous build can't use the new server: without `x-whim-protocol` it gets 426 by design. So seeding a
  generated app runs against a local stub server from the *previous* build's commit (the dev server without an
  OpenRouter key uses the stub pipeline). Find how earlier acceptance runs pointed an app build at a local
  server, and reuse that.
- Android emulator: its NAT to the host is dead on this machine. `adb reverse tcp:<port> tcp:<port>` for the
  app's server URL is the thing to try. Boot recipe: `emulator @<avd> -no-snapshot -no-boot-anim -gpu
  swiftshader_indirect -no-window`, and a fresh device means `-wipe-data`.
- iOS: Xcode 27 has no Simulator.app; `simctl` works (create a fresh device, boot, install, launch). Maestro on
  iOS once crashed SpringBoard here. Support Maestro on iOS but make the failure mode explicit, and don't rely
  on it silently.
- Maestro sees inside the mini-app iframe on Android (text selectors work). `inputText` appends; `hideKeyboard`
  navigates back.

Decisions made for the implementer:
1. **9.1:** Maestro flows seed an example app with saved data and a generated app with two versions, and write
   a seed record (JSON: tile names, version count per app, the saved datum, consent state, device id as the app
   shows it) to the evidence folder.
2. **9.2:** `scripts/release/upgrade-check.sh --platform android|ios --from <artifact> --to <artifact>
   [--evidence <dir>]` runs: fresh device → install from → seed → install to over it → read the same record →
   diff. It exits non-zero on any difference, or if a step fails. Put the diff logic in a small Node-testable
   module with a test that a missing datum fails. The device steps themselves are the orchestrator's 10.5.
3. **9.3:** `docs/release/mobile.md` makes the check a required step before any beta build ships. Evidence goes
   to the releasing change's folder (`openspec/changes/<id>/upgrade-check/<platform>/`), and a line goes in its
   `progress.md`.
4. `scripts/release/*` isn't Class-2 (the protected-file system is retired), but `scripts/gate*.sh` and
   `package.json` stay untouched: no new npm script is needed.

Gate: `./scripts/gate.sh` to FAST GATE PASSED (lint covers the new files). End with HARNESS FEEDBACK
(docs/harness-feedback/README.md).
