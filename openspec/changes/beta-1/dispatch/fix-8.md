# fix-8: the upgrade-check Maestro flows work on iOS (10.5 blocked)

The iOS run of `scripts/release/upgrade-check.sh` (382511 → beta-1) failed at the first seed assertion:
`Assert that "Water Counter" is visible... FAILED`, although "Water Counter" is plainly on screen (evidence:
`openspec/changes/beta-1/upgrade-check/ios/raw/maestro/seed/.maestro/tests/2026-09-26_040210/*.png` and
`raw/maestro/seed.log`, both in the primary tree). Likely cause: on iOS a tile is one accessibility element with a
combined label, so Maestro's full-match text selector misses the name. chain-9 built and validated the read flows
on Android only (text nodes are separate there).

1. Reproduce: create a fresh simulator (`xcrun simctl create "Whim-fix8-<hhmm>" "iPhone 17"
   com.apple.CoreSimulator.SimRuntime.iOS-27-0`), boot it, install the 382511 app
   (`~/.cache/whim-upgrade/382511/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app`), launch, and dump
   `maestro --device <udid> hierarchy`. Do the same for the beta-1 app
   (`/Users/davrondjabborov/Work/other/Whim/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app`,
   build 386398), because the read flows run against the NEW app after the upgrade.
2. Make `scripts/release/upgrade-check/{seed,read-grid,read-history,read-water-counter}.yaml` work on both
   platforms: use selectors that match on iOS's combined labels and Android's text nodes (e.g. `text: ".*Water
   Counter.*"` regexes, or ids where they exist), and follow the flows through 382511's own quirks (#49/#50: on
   382511 the compose keyboard can't be dismissed on iOS and covers Continue; the flow tries tapping the headline).
   Keep them working on Android: chain-9's fixtures in `checks/test/release/fixtures/upgrade-check/` and the
   selector test in `checks/test/release/upgrade-check.suite.ts` must still pass. Extend that test if it pins
   selectors.
3. Run the iOS check end to end: the old 382511 server is running on `http://127.0.0.1:8790` (don't start or
   stop it), so `scripts/release/upgrade-check.sh --platform ios --from <382511 app> --to <386398 app>
   --evidence <scratch dir> --port 8790 --sim-type "iPhone 17" --sim-runtime
   com.apple.CoreSimulator.SimRuntime.iOS-27-0`. Iterate until it passes or you find a real upgrade defect (data
   lost, consent/device id changed: that is a FINDING to report, not to work around).
4. Delete every simulator you created when you're done (never touch any other simulator; several are booted for
   other sessions). Never touch Android emulators (another session is driving emulator-5560; emulator-5554 is
   another app's).
Also fix the `docs/release/mobile.md` upgrade-check recipe: a fresh worktree of an old release has no
`vendor/bundle`, so `bundle exec pod install` fails until you symlink the primary's `vendor/bundle` (same
Gemfile.lock). Add that step.
