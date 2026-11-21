# c6f23: chain-6 device findings F2, F3

## F2: `LayoutMetrics` warning bursts at sheet teardown (fixed; mechanism from source, no device)
- The exit lands early. `exitLanded`, the reaction in `SheetFrame` in `src/host/ui/Sheet.tsx`, hops `onSettled`
  to JS while the `smooth` spring on `grown` (owned by `Sheet`, outside the Modal) runs ~0.35 s more. Every frame
  of that tail, Plate, Face, LeadEmber, `useSheetLead` and the reaction measure `frame` and the page's ember.
- JS then unmounts the window in one commit: `exited()` → `leave` → `OverlayModal` returns null. Fabric commits
  HostRoot as deletions first (`safelyDetachRef` → `attach(null)` → `on.value = false`), then `completeRoot`
  (ReactFabric-prod.js:8843-8852). `completeRoot` sets the shadow tree's current revision on the JS thread at
  once. The `on = false` write is only queued: reanimated `mutables.native.ts:48-53` (scheduleOnUI), worklets
  `threads.native.ts:389-395` (microtask flush).
- A UI frame in between measures a place whose `on` is still true but whose node has left the revision:
  `UIManager.cpp:380-386` measures `getCurrentRevision()`, `LayoutableShadowNode.cpp:85-88` returns
  `EmptyLayoutMetrics`, `ReanimatedModuleProxy.cpp:1281-1286` returns null, `measure.native.ts:44-48` warns.
  One warning per measuring mapper gives the burst of ~5. It is a race, so intermittent, and it lands at the
  Modal teardown. "view with tag null" cannot happen, because `on` still turns false before the ref is cleared.
- Fix (`Sheet.tsx`): a sheet-level `ended` shared value. `exitEnded()` sets it on the UI thread before the
  `scheduleOnRN(settled)` hop, on all three ends (landing reaction, tapped-close `done`, drag-release `done`).
  - `placeInSheet(ended, …)` returns null without measuring once it is set. It replaces `placeIn` at every
    window measure: Plate, Face, LeadEmber, `useSheetLead` (via `SheetMorph.ended`) and `exitLanded` (null
    counts as landed).
  - `playEntrance` resets it. On ended frames the plate and face draw nothing; the real place is under them.
  - Not covered (not observed): `EXIT_CEILING_MS`/refusal unmount, `Sheet` unmounting mid-spring, TravelLayer/MiniAppView.
- Tests (launcher:test):
  - Double: `holdHops()` queues `scheduleOnRN`, as on a phone. Contract case in native-reanimated.suite.
  - sheet-morph-ui, new: from the frame the exit ends (hops held), 3 UI frames measure 0 window views (M5 X,
    M6 drag). Also new: a sheet closed into the capsule grows out of it again when reopened.
  - Changed: the "hides on the frame it is in place" test read the plate on the hide frame, which now draws
    nothing. It now checks every earlier drawn frame is > 0.5 pt from the place, and that the last two drawn
    frames, carried one frame further on the same decay, reach ≤ 0.51 pt.
- Red-checks (each applied, shown with `diff --stat`, reverted): pre-fix Sheet.tsx RED (69/33 window measures,
  want 0); Plate left on `placeIn` RED (9/9); entrance reset dropped RED in the reopen test (before it existed,
  all 20398 launcher checks passed); `LANDED` 0.7, one frame early, RED in the changed test; the double ignoring
  held hops RED.

## F3: scrim taps in the top ~150 px do nothing (no change; pre-existing; likely platform, unproven)
- Nothing of ours lies there: the scrim Pressable is an absolute fill, the TravelLayer overlay is
  `pointerEvents="none"`, Plate/Face are zero-size or `none` while open, nothing pads the top. On main 193e5f83
  `OverlayModal.tsx` is identical and the Sheet scrim/frame JSX differs only in the ref. RN
  `ReactModalHostView.kt` 0.85.3 → 0.88.1 changed only window create/destroy hooks; edge-to-edge and status-bar
  handling (lines 363-400) is unchanged. Likely: SystemUI's status-bar window takes touches in its band.

## DEVICE VERIFICATION (release build of this commit)
- Log: clear logcat, then `adb logcat -v time ReactNativeJS:W ReactNative:I '*:S'` to a file for all of the below.
  The whole run must have ZERO lines with `meaningless value of \`LayoutMetrics\``, `view with tag null` or
  `is not a function`. Expect one `Tearing down gesture handler` per sheet close.
- F2, 32 sheet closes, reopening after each: Describe 8 swipe-down, 8 X, 4 Android back, 4 scrim tap (below
  y≈220 px, see F3); Plan 4 X; Making-into-tile 4 X. On 4 of these (2 Describe X, 2 Making X), reopen at once:
  tap the capsule or tile again as soon as the sheet is seen gone.
  Look: it shrinks into the capsule or tile with no pop and no blank frame on landing. On the 1–3 frames
  before the window goes, the plate and face draw nothing and the real capsule or tile shows under them.
  A quick reopen grows from the capsule or tile with the plate visible.
- TravelLayer: 3 times, tap Make it, then X within ~300 ms (while the ember is still in flight). The
  ember snaps onto the Making page's 128 as X is tapped, then the sheet goes into its tile.
- MiniAppView: 5 app closes into the tile (orb → Back to your apps, or Android back at the app's root).
  The bg lands on the tile and Home takes touches at once, with no warning lines.
- F3 proof: with Describe up, `adb shell input motionevent DOWN 672 75`, then
  `adb shell dumpsys input | grep -A15 TouchStatesByDisplay`, then `adb shell input motionevent UP 672 75`: the
  touched window should be StatusBar (systemui). At y=220 it should be Whim's dialog.
  `adb shell dumpsys window | grep -i -A3 statusBars` should give ≈150 px. If y=75 lands in Whim's window, F3
  is ours: report it back.

## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: red-checking a weaker variant (no entrance reset) passed all 20398 launcher checks,
  which showed a reopen test was missing.
- DRAWBACK: the synchronous `scheduleOnRN` double hid every case of UI frames running before JS hears; `holdHops`
  now models it.
- NEUTRAL: no device this round. F2 is derived from source; F3 is unproven until the recipe runs.

## Round 2 (review 1's findings)
- Review MED 1 (MiniAppView `closeLanded` hops `closed` while `grown` runs): no change, because the premise
  is false. After landing, the reaction at MiniAppView.tsx:413-414 measures only `frame` (the stage root,
  MiniAppView.tsx:243) and the tile. `onClosed` (`setStageMorph(null)` + `goHome`) removes neither of them.
  - Both `renderMiniApp` branches render `<MiniAppStage>` at the same place (LauncherRoot.tsx:3895-3933).
    `ScreenBoundary` only resets keys.
  - Home is `stackFor(HOME)` = `[home]` both under the app and after `goHome`. App cells are keyed by app id
    and never fold into `older`. `refresh()` is synchronous, but it keeps the key.
  - Probe in app-morph-ui (deleted): the host instances of the stage and of the Timer tile are identical
    before and after the launch ends. Only MiniAppView's own subtree goes, and the close measures nothing
    in it. On a phone the mapper runs until its queued `stopMapper` arrives, and it measures live views.
    No warning is possible, so there is no failing test to write.
- Review MED 2 (TravelLayer measured in a torn-down window): no change, because the premise is false.
  - Both travel targets land on `useSheetLeaving()`, which is `!visible` from the close's first render:
    MakingPage.tsx:256-262 and ReadyPage.tsx:141-146 (`finish` → `travel.land()`). That sets
    `progress = 1` and `setFlight(null)`, which unmounts `Flying` and makes `useTravelSource`'s `mine`
    false. The exit then runs its frames before the window goes.
  - A target mounted while leaving flies and lands in the same flush.
  - Probe in make-it-motion (deleted): Make it, 76 ms, X. 6 travel measures, all inside the press, while
    the window is fully up. 0 over the 40 exit frames.
  - Existing locks: make-it-motion "closing the sheet mid-travel ends the moment at once", and ready-motion
    "Ready: closing the sheet mid-travel …" (`flying === null` on the press).
- Review LOW 3: fixed. The old `g1²/g2` carry-on is biased: the tail ratio drifts 0.800 → 0.797 because
  `smooth` is critically damped. That bias is why it needed +0.01.
  - Now `carriedOn` in sheet-morph-ui fits (α+βn)·qⁿ exactly from 4 drawn frames: q² = (db−c²)/(ca−b²),
    next = 2qd − q²c.
  - It is checked on the last drawn frame (≤ 1e-9), then required ≤ 0.5 + 1e-9 on the hidden frame
    (+2 checks, 477 → 479).
  - Red-check: `LANDED` 0.63 (one frame early in both cases), `diff --stat` Sheet.tsx 1 line. RED on M5 and
    M6. The carried-on values matched the real gaps of the early frame to 3e-12. Restored.

## HARNESS FEEDBACK (round 2)
- CAUGHT-REAL-MISTAKE: two reviewer MEDs ("same race as F2") would have added guard code. A 20-line identity
  and measure-count probe falsified both before any fix was written.
- DRAWBACK: the brief required tests that "FAIL on current code" for findings whose premise was not yet
  verified, so a false premise left nothing honest to write.
- NEUTRAL: the double's JS→UI writes are still synchronous; the probes relied on host identity, not timing.
