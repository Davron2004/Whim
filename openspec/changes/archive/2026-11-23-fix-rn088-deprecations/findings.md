# Findings: fix-rn088-deprecations

- source: GitHub issues #281 and #310, owner asked to fix both (2026-11-23). Standalone run on integration/fix-rn088-deprecations cut from main @ 6341757f.

## gh-281: Deep import of react-native/Libraries/promiseRejectionTrackingOptions is deprecated in RN 0.88

- severity: low
- source: https://github.com/Davron2004/Whim/issues/281

Found during the React Native 0.88 upgrade (change `upgrade-to-latest-dependencies`, chain-5 resume).

**What:** RN 0.88.1 flags the deep import `react-native/Libraries/promiseRejectionTrackingOptions` (used in `__DEV__` by `src/host/platform/install-diagnostics.ts:40`) as deprecated. It works today; a future RN will remove it.

**Done looks like:** the unhandled-rejection diagnostics no longer deep-import RN internals (a public API, or an owned equivalent), with the existing diagnostics behavior unchanged and covered by a test.


## gh-310: iOS Done bar: move off the deprecated InputAccessoryView (dev warning toast; RN 0.88 host un-hide bug)

- severity: low
- source: https://github.com/Davron2004/Whim/issues/310

- **Labels:** `ai-proposed`
- **Body:** React Native 0.88 deprecates `InputAccessoryView` ("InputAccessoryView is deprecated and will be removed in a future release."), and the iOS keyboard Done bar in `src/host/launcher/KeyboardShell.tsx` (`DoneBar`) is built on it. Two costs today: every multiline field (the Whim menu's "What should change?", Describe, Plan) logs that warning in debug builds and raises the dev LogBox toast; and RN 0.88 Fabric un-hides the in-tree host view on its first layout, which painted a white box over the Whim-menu field and swallowed its taps (wbp-d3, worked around in the `webview-bridge-provenance` PR with `opacity: 0` on the host). Done looks like: the Done bar moves off `InputAccessoryView` to `react-native-keyboard-controller`'s `KeyboardToolbar` (already a dependency) or an equivalent keyboard-tracked view, keeping its look (`surface` strip, `separator` hairline, Done in `text`, scheme-aware), the `opacity: 0` workaround is deleted, and a debug launch + opening the Whim menu shows no LogBox toast, checked on an iOS simulator in light and dark.

Found during the `fix-wbp-issues` batch (2026-11-23); see `openspec/changes/fix-wbp-issues/findings.md` round 2.


