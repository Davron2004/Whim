# c6f25: chain-6 device findings F2 (round 3) and F5 (both fixed, proven on Whim_Verify)

## F2: `LayoutMetrics` warnings at sheet teardown
- Reproduction: base b4eb4d49 plus scratch logs, since removed, that named each `measured()` call that
  returned null (`$S/c6f25/logcat-i1.txt`).
  - Burst A, 08:13:39 (scrim close, Describe): `CEILING` fired 2.1 s after the close and the window went.
    Then 5 nulls in one UI frame (Plate, Face, LeadEmber/from, LeadEmber/to, exitLanded), all on the
    `frame`, `ended=false`. Exits take 1.1–1.6 s here, so a slow frame passes `EXIT_CEILING_MS` (2000).
  - Bursts B and C, 08:16:40 and 08:17:13 (Make it, X 0.3 s later): 3 nulls each (TravelHidden,
    TravelDeparting, Flying) on Make it's place, 80 ms after the close, window up (also on base: `logcat-old-f5.txt`).
- Mechanism: one race. A measured view leaves the committed tree before its `on` turns false on the UI.
  - Before, `usePlace` wrote `on` as a shared value, and a JS write only queues (reanimated
    mutables.native.ts:51, `scheduleOnUI`). React calls `attach(null)` in the commit that removes the view,
    and `completeRoot` makes the tree without the view current at once. UI frames before the queued
    write still measure the old node: UIManager.cpp:380-386, then LayoutableShadowNode.cpp:85-88 gives
    `EmptyLayoutMetrics`, ReanimatedModuleProxy.cpp:1281-1286 gives null, measure.native.ts:44-48 warns.
  - Burst A: OverlayModal.tsx:215. The ceiling calls `exited` directly, so the window goes with no
    `ended` set (round 1 covered only the exits that end on the UI thread).
  - Bursts B and C: TravelLayer.tsx:183 `land()` runs, then MakingSheet.tsx:107 drops the faded plan page in
    the same pass, while the travel's mappers still run.
- Fix (SheetAnchor.tsx): `on` is a fixed-type worklets `Synchronizable` (an atomic both threads read at
  once, SynchronizableFixed.cpp). `attach(null)` sets 0 synchronously, before `completeRoot`;
  `attach(view)` sets `-n`, and a `scheduleOnUI` after the ref's own write (useAnimatedRef.native.ts:35)
  turns it to `n` only if still `-n` (`viewOn`).
  - `measured` asks `getDirty() > 0`. This covers every place: the sheet window, travel, MiniAppView and
    anchors. Round 1's `ended` stays, to stop drawing on ended frames; its comment is updated.
- Tests: the double gets `holdWrites()` (JS writes to shared values, `scheduleOnUI` and a ref's UI-side
  view wait, in order), `createSynchronizable`, `measureWarnings.outOfTree`, and 2 contract cases.
  - sheet-morph-ui: (1) a place is never measured out of the tree, before its ref holds a view, or after
    a quick put-on/take-off; (2) Android M6/M5 by X, ceiling mid-exit: 3 later plate/face frames warn 0.
  - make-it-motion-ui: a close mid-travel after the plan faded; 3 Flying and `departing` frames warn 0.
- Red-checks (only SheetAnchor.tsx at HEAD, absent from `git diff --stat`; restored): ceiling `outOfTree: 3`
  (M6, M5), place `outOfTree: 1`, travel `outOfTree: 3`; weaker `viewOn` without the compare: `unattached: 1`.

## F5: stale "Continue" draft and a dead Make it
- Reproduction (`logcat-fix1.txt`, f5v-v4..v7, `f5v-v4.png`): Make it, then X 0.1 s later. `onBuildIt`
  ran and cleared the draft, but `closeSheet` ran 0.3 s later with `screen.kind=plan`. The close
  landed on the plan as drawn, before the Making screen was committed. `keepDraft(plan)` kept the very
  plan object `firstTake` had taken.
  - Result: "Continue "a todo list"", no toast. The next three Make its on the reopened plan did nothing
    (no `onBuildIt` past `firstTake`). The 0.3 s and 0.05 s variants and BACK and scrim did not race.
  - Pre-existing: the draft, `firstTake` and close code is identical on main 193e5f83.
- Spec: prompt-flow keeps a draft only for a close on Describe or Plan; flow-draft.ts: Make it spends it.
- Fix (LauncherRoot.tsx): `useFirstTake` adds `spent(page)`.
  - `keepDraft` keeps nothing for a spent plan. It keeps a spent Describe as a copy, so its Continue works
    again, and aborts the plan's clarify it sent.
  - `closeSheet` on a spent plan (not over a running app) is `onLeaveRunning`: the run is detached, so a
    delivery toasts on Home.
- Tests (prompt-flow-ui, new, both RED before the fix): Make it + close from one drawn plan (no draft,
  "ready" toast, next compose makes a 2nd run); Continue + close (words kept, clarify aborted, asks again).
- Red-checks: only the `keepDraft` skip (no `onLeaveRunning`) fails, with no toast. A Describe kept
  without the copy fails: Continue is dead and the plan never loads.

## DEVICE PROOF (release build of this commit, Whim_Verify)
- Build 17917f44 (bundle: no `c6f25` string, `viewOn` present). `$S/c6f25/logcat-proof.txt`: 56 sheet
  teardowns (Describe swipe 6, X 12+10, back 6, scrim 6, quick reopen, Make it+X 11), 3 app closes into
  the tile (CONTAINED=true ×3): 0 `LayoutMetrics`, 0 `view with tag null`, 0 `is not a function`, 0 FATAL.
- Ceiling path on device: fix + scratch logs, qemu under `taskpolicy -b`: 4 `CEILING` exits, 0 nulls
  (`logcat-fix1-throttled.txt`); whole fix1 run 36 teardowns, 0 nulls, 0 warnings.
- F5: 6× fresh Describe → Make it → X at 0.1 s (4) / 0.3 s (2): 6 POSTs (`server2.log`), capsule "Make
  an app…" each time, toast "Hello App is ready · Open" (`f5v-q1.png`, `f5v-q4.png`); each next Make it
  worked. Whether a given round raced is not visible without scratch logs; the rig test pins the race.
- Note: the first proof's 5 Make its hit the stub's daily limit (429); re-run on a fresh stub data dir.

## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: per-site device logs found the ceiling path that two source-derived rounds missed.
  F5 only reproduced at 0.1 s, not at the 0.3 s in the report.
- DRAWBACK: the double applied JS→UI writes at once and act() always commits between taps, so neither
  race was testable. Now `holdWrites` exists, and two handlers are called from one drawn page.
- ENV: slow emulator frames put exits near the 2 s ceiling; `taskpolicy -b` on qemu triggers it on demand.

## Review round 1 fixes
- MED: the double counts JS-thread Synchronizable reads (`getDirty`/`getBlocking`) in `jsThreadReads`; the
  sheet-morph-ui JS-thread test asserts 0 and is retitled. Red-check: deleting `measured()`'s
  `isRNRuntime()` guard gave `[null, 1]` vs `[null, 0]`, RED; restored, 489 checks pass.
- LOW: SheetAnchor comment now says the window shrinks from a frame to the gap between `getDirty()` and `measure()`.
- LOW: whim-sheet-ui test: Make it then close on the change's plan over the running app: one request, back
  on the same app, no draft (the next Change it opens an empty Describe, not the spent plan). Red-check:
  deleting keepDraft's `plan && spent` early return failed it; restored.
- LOW: the ceiling-case test saves and restores `Platform.OS`.

## HARNESS FEEDBACK (review fixer)
- CAUGHT-REAL-MISTAKE: a mechanism swap (shared value to Synchronizable) left a test passing that could no longer fail.
- NEUTRAL: `--only whim-sheet-ui` still ran the whole launcher run; titles confirmed in output.
