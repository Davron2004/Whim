# Task 24.6: haptics on Davron's iPhone 15 Plus, guided session

Branch `device/24-6` (measurement-only, never merge). The build is `docs/design/system.md` §5 plus a
throwaway log line at each end of every haptic call. Time: about 15 minutes of tapping.

## Before Davron starts (PO)

1. Signing gap: this Mac has no Apple ID signed in under Xcode, and no development profile for
   `com.anycognition.whim`. Davron signs in once (Xcode > Settings > Accounts, the Apple ID that is on team
   2B7K4YLS34), then the PO runs
   `/Users/davrondjabborov/Work/other/Whim/.claude/worktrees/device-24-6/scripts/scratch/hx-install.sh`
   (builds signed, installs over the existing Whim 1.0.0 (397438) in place: data kept; it never uninstalls).
   The phone must be unlocked and on the cable. If the install says it would need to remove the app, stop.
2. The stub server must be running (`/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/haptics/stub.pid`).
   It listens on `http://10.0.0.253:8787` (this Mac's Wi-Fi address). The phone must be on the same Wi-Fi.
   Check in the phone's Safari: `http://10.0.0.253:8787/health` shows `{"ok":true,...}`.
3. Phone settings: Settings > Sounds & Haptics > System Haptics ON, ring/silent switch irrelevant, Low Power Mode
   OFF (it can silence haptics). Screen lock off for the session (Display & Brightness > Auto-Lock > Never).
4. Start the capture (next section), then Davron starts. At the start of each step below the PO runs
   `/Users/davrondjabborov/Work/other/Whim/.claude/worktrees/device-24-6/scripts/scratch/hx-mark.sh <LOG> <step number>`
   (optional but it makes the analysis per step; without marks the totals still work).

## Log capture (PO, background, before Davron starts)

One command. It relaunches Whim on the phone with its console attached, so the app restarts fresh, and it
appends to one file. Run it in the background, about 25 minutes, then stop it by its PID.

```sh
LOG=/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/haptics/session-iphone15plus.log; xcrun devicectl device process launch --device 00008120-000A3D4E0E92201E --terminate-existing --console com.anycognition.whim >> "$LOG" 2>&1
```

Stopping that command (kill its PID) also quits Whim on the phone: that is expected. Do not stop it until
Davron says the last step is done. Check after 10 seconds that `HXJ`/`HXN` lines appear once Davron taps anything
(`grep -c HX "$LOG"`); if the file has no `HX` lines after a first tap, the build is not the instrumented one.

## Analysis (PO, after)

```sh
/Users/davrondjabborov/.cache/whim-run/capped-run.sh -- node /Users/davrondjabborov/Work/other/Whim/.claude/worktrees/device-24-6/scripts/scratch/hx-analyze.mjs /Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/haptics/session-iphone15plus.log
```

Prints per-moment counts, JS-call to engine-call latency (median, p95, max), the cue rate cap, any haptic outside
§5, and (with marks) an OK/MISMATCH line per step. Latency measured is the JS call to the native engine call; the
touch itself has no timestamp in this log, and the Taptic Engine fires after the engine call.

## Setup (no haptic expected, not timed)

0. Whim Home > the gear (Settings) > Advanced > Server > "Your own server" > address `http://10.0.0.253:8787`.
   Go back to Home. Do not generate anything on Whim's real server. Do not delete or change Davron's own apps:
   everything below touches only apps made in this session ("Haptic Lab").

## Tap-through (felt it? Y/N + comment)

Steps 1 to 4 must give NO haptic. After each step write Y if you felt a haptic, N if not, plus a note.

| # | Do this | You should feel | Felt it? |
|---|---|---|---|
| 1 | On Home, scroll the grid up and down for 5 seconds | Nothing | |
| 2 | Tap an example app's tile to open it. Tap its buttons, type a number. Do not use the orb yet | Nothing | |
| 3 | Go Home (system swipe back or the orb, then Home) and tap the gear, then back | Nothing | |
| 4 | Tap the "Make an app…" bar. Type "a haptic test app". Do not send yet; then tap Send | Nothing while typing and on Send | |
| 5 | On the plan page, tap an answer chip (any question) | A light tick (selection) | |
| 6 | Tap a different chip | The same light tick | |
| 7 | Tap "Make it" | One medium thump (handoff) | |
| 8 | Wait on the Making page (about 10 seconds) until the app is ready | Nothing while waiting. On ready: a success buzz as the Ready page appears (#227) | |
| 9 | Open Haptic Lab (tap its tile). Tap "Tap" | One light tap | |
| 10 | Tap "Double" | Two light taps, a hair apart | |
| 11 | Tap "Heavy" | One heavy thump | |
| 12 | Tap "Burst of 20 at once" once | About 3 taps, then silence (the cap drops the rest) | |
| 13 | Tap "Steady 5 per second" and keep your finger on the phone for 4 seconds | A steady tap 5 times a second, all 20 felt | |
| 14 | Tap the orb (bottom corner) so the Whim sheet opens | Nothing (a tapped sheet is silent) | |
| 15 | Drag the Whim sheet down slowly past halfway, then release | One firm click when you cross the commit point (commit). Drag back up and down again: one click per crossing | |
| 16 | Close the sheet. Press the orb and drag it across the screen to the other bottom corner | One firm click when it lifts off (commit); if none, write N | |
| 17 | Leave the app. On Home, long-press the Haptic Lab tile | One medium thump as the menu opens (long-press) | |
| 18 | In the menu choose "Make a copy" (pick either data answer) | A success buzz when "Copy made" appears | |
| 19 | Gear > Advanced > turn "Send error details" OFF | One light tap (toggle off) | |
| 20 | Turn it ON again | One light tap (toggle on) | |
| 21 | Home: long-press the Haptic Lab copy > Delete | A warning buzz as it leaves. Then tap Undo: nothing | |
| 22 | Make an app again: type "break it [[fail]]", send, tap a chip on the plan page | The selection tick | |
| 23 | Tap "Make it" | One medium thump (handoff) | |
| 24 | Wait for it to fail | An error buzz as the failure page appears (#227). If silent, write N | |

Negative checks are steps 1 to 4 and 14; also, throughout, taps on plain buttons (Settings rows, Back, Open) must be silent.
Rate cap: step 12 sends 20 `cues.haptic('tap')` at once (expect about 3 played, 17 dropped, none queued afterwards) and
step 13 sends 5 a second for 4 seconds (expect 20 played, 0 dropped). The host's rule: a per-realm bucket of 3, refilled
at 10 per second (`HAPTIC_CUE_BURST`, `HAPTIC_CUES_PER_SECOND` in `src/host/cue-backend.ts`).

## Known gaps from reading the source (verify, do not assume)

- Since #227 (staging `43d117da`): success plays as the Ready page mounts (`ReadyPage.tsx`), failure plays once per live
  failure as the Failure page appears (`FailurePage.tsx`, `announce` token: reopening a failed attempt from its tile
  plays nothing), handoff plays on "Make it" / "Make the change" (`PlanPage.tsx`) and on "Try again" on the Failure
  page. Steps 8 and 24 now expect the haptic. The Whim sheet's Send plays nothing (it only opens the change's plan),
  which is why step 4 stays silent.
- `haptics.play` is also wired for: selection in Chip, toggles in GroupedList, long-press in AppTile, commit in Sheet
  and Orb, success on copy made and version restored, failure on copy and version-switch failing, warning on delete,
  discard and ConfirmSheet.
- PlanPage's own "Try again" (plan problem) still has no handoff haptic.
- The "Haptic Lab" app is the stub server's one app in this session (throwaway change on this branch). No app
  cue kind exists in the default install: no seeded app calls `cues.haptic`.
