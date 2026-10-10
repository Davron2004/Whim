# Progress ledger: design-system-v1

Chains 1–14 and 23 were merged before this ledger existed; their record is the merge commits on
`integration/beta-2` and `docs/handoff-2026-10-09.md`. Staging branch: `integration/beta-2`
(`FIXLOOP_INTEGRATION_BRANCH`). Entries are appended as they happen.

## 2026-10-10, shift 1 (chains 15 and 16)

- run-resume: staging tip `a579f6f8`, in sync with origin, main tree clean.
- decision (orchestrator, owner away): chain-15 introduces the shared question component
  `CopyQuestionSheet` for "Copy the data, or start fresh?". It is shown only when
  `StoreAccess.canCopyData` is true; when false, "Make a copy" makes a fresh copy at once (a
  one-option question is not asked). design.md D8 ("no question") is superseded by the RESOLVED
  note in tasks.md and the delta spec's Forking requirement. Skipping the question for an app that
  never saved data needs `hasSavedData`, which is copy-app-data task 3.0, not chain-15.
- decision: a failed "Copy the data" in chain-15 surfaces one generic failure toast and creates
  nothing; the per-kind copy and the "Start fresh" offer stay with copy-app-data task 3.3.
- dispatched: chain-15 (home), BASE `a579f6f8`, worktree `.claude/worktrees/design-system-v1-chain-15`, branch `chain/design-system-v1-chain-15`, implementer on sonnet.
- report: chain-15 STATUS complete, fast gate PASS, commit `627a8bfb` (48 files). Class-A deviations
  logged: out-of-scope edits to `consent-flow.ts`, `flow-skeletons.tsx`, `launcher/index.ts`,
  `checks/test/repo/design-system.suite.ts` (stale exemption dropped), `scripts/release/upgrade-check/seed.yaml`
  (selectors accept the old and new menu word) and three test helpers; `fork-ui.suite.tsx` rewritten
  instead of deleted; a busy tile opens no menu.
- integrity: `fixloop.sh integrity chain/design-system-v1-chain-15` exit 0.
- merged: `71bd7a6d` (--no-ff). gate-full on `71bd7a6d`: FULL GATE PASSED (fast gate, knip, guard:metro,
  three Chromium suites, openspec validate, codex mirror). Tasks 15.1–15.6 ticked.
- deferred from chain-15, each with its owner: M18 delete reflow → task 22.3; the stuck/"honest light"
  ember on tiles → task 22.2; Stop leaving a "Stopped" tile → chain-17 (Stop lives on the Making page);
  the plan's proposed name on a tile being made → chain-16 (`attemptName` is the one place to read it);
  the composer's draft state is a prop nobody passes yet → chain-16 (task 16.1).
- reviewer on `a579f6f8..627a8bfb`: VERDICT findings, no report-mismatch, no check weakened. One medium
  (the Undo toast pauses under a screen reader while the purge timer keeps running, so Undo can be
  offered after the purge started) and lows (list-mode skeleton padding, live Settings button on the
  skeleton, skeleton count before the purge sweep, unfloored `gridLayout` with its guard tests deleted,
  dead `AppBusyOp 'delete'` and `COPY.customizePreviewLabel`, stale comments). → fix chain 15b.
- decision: the Undo window belongs to the toast. The purge completes when the Undo toast ends
  (timeout, swipe or replacement), so Undo works for as long as it is offered; under a screen reader
  that is longer than 10 s (the toast pauses there by system.md §7.1). The launch sweep stays the backstop.
- decision: a changing or change-failed app's menu has no Delete, as system.md §3.2 lists; the spec's
  "Delete on every installed app" is met once the change is stopped or discarded. No requirement changed.
- dispatched: chain-15b (reviewer fixes for home), BASE `dbfebc71`, worktree `.claude/worktrees/design-system-v1-chain-15b`, branch `chain/design-system-v1-chain-15b`, implementer on sonnet.
- report: chain-15b STATUS complete, 7/7 fixes, fast gate PASS, commit `071b2901`. Class-A: `ToastSpec.onEnd`
  added (shell-surfaces contract updated); `PurgeWindows` lost its timers (`finish(kind, id)` runs the purge,
  Home gained `onSettleDelete`/`onSettleDiscard`, `onUndo*` return boolean, "Too late to undo." toast);
  `HomeHeader.tsx` and `AppTile.tsx` touched outside the listed scope; a degenerate grid width gets a 64 pt cell.
- integrity: exit 0 (INTEGRITY OK).
- merged: chain-15b as `51b6d2e2`; ledger commit `bb5d760f`. gate-full on `bb5d760f` started.
- dispatched: chain-16 (making-describe-plan), BASE `bb5d760f`, worktree `.claude/worktrees/design-system-v1-chain-16`,
  branch `chain/design-system-v1-chain-16`, implementer on sonnet. It started before the gate-full verdict on its
  BASE: the merged tree equals 15b's fast-gated tip, so only the full-gate extras were outstanding.
- decision: the making sheet's draft lives in memory for the session (one for a new app, one per app being
  changed); persisting drafts across launches is not in v1's chain-16. Cleared when Make it starts the run.
- decision: chain-16 hosts the existing Making/Ready/Failure components inside the sheet unchanged; chain-17
  redesigns them. The plan's proposed name is stored on the pending record only if the wire already carries one.
- gate-full on `bb5d760f` (after chain-15b): FULL GATE PASSED.
- report: chain-16 STATUS complete, fast gate PASS, knip clean, commit `eee46534` (55 files). Class-A deviations
  logged: screen kinds renamed (`compose`→`describe`, `clarify` merged into `plan`, `build`→`making`, `done`→`ready`);
  a clarify/rewrite error stays on Plan with Try again; the sheet presents over Home only; out-of-scope edits
  (`ComposerBar`, `KeyboardShell`, `AgeScreen`, `refusal-landing`, `flow-chrome`, `flow-skeletons`, upgrade-check
  `seed.yaml`, `consent-coverage.suite.ts`); `ConsentScreen` kept for Settings' review mode.
- integrity: exit 0 (INTEGRITY OK). merged: `895ae528` (--no-ff).
- gate-full on `895ae528`: FAILED in `synthetic-run`, one assertion (`synthrun/test/isolation.ts:589`, the bare-browser
  egress control saw no UDP datagram within its 2 s poll). Chain-16 touches nothing the suite loads; the suite passed
  in the two earlier full gates and 391/391 on an immediate rerun. Timing flake under load → issue #172. Every other
  full-gate step passed in that run. The final gate-full of the shift runs after chain-16b.
- reviewer on `bb5d760f..eee46534`: VERDICT report-mismatch (undeclared dropped assertions; code otherwise verified:
  nothing is sent before both legal acts, both recorded with versions, approval gate, abort on close, runs never
  cross, draft rules). Mediums: Android back inside the sheet never reaches the page handlers on a device (the
  Modal's `onRequestClose` closes the sheet), a restored change-mode draft keeps a stale `editing` snapshot, a
  possible iOS double-Modal overlap between the first-run sheet and the making sheet (needs a simulator), and a
  spec contradiction (next line). → fix chain 16b for everything but the contradiction.
- OPEN, owner ruling needed (issue #173): task 16.2 and system.md §9 "First run" put terms acceptance and AI-data
  consent on one sheet with the full disclosure collapsed under "Full details". Live `terms-acceptance` ("own step",
  "SHALL say nothing about data") and `ai-data-consent` (every disclosure section "before any choice is offered",
  nothing about the terms) say otherwise, and this change has no delta for either. No requirement was changed.
  Task 16.2 stays unticked until the ruling.
- decision: Android back inside the making sheet steps back before it closes: on Plan it cancels an open row edit,
  else returns to Describe (text and answers kept); on Describe it closes the sheet and keeps the draft. This follows
  the delta spec's "Back on Plan SHALL return to Describe" and replaces the dispatch note that back always closes.
- deferred: the making sheet presents over Home even when started from History or a running app. Chain-19 (the
  Whim sheet grows into the change's plan) and chain-20 (History's "Change it") own those entry points.
- side findings filed: #167 stale demo flows, #170 no producer for the plan's proposed name, #171 stub rewrite
  restates clarify questions, #172 synthrun UDP canary flake.
- ruling received (product-owner session, provisional until the owner confirms on #173): option A, keep the one
  sheet. Recorded as design.md D19. MODIFIED deltas written for `terms-acceptance` (one requirement renamed) and
  `ai-data-consent`; `openspec validate design-system-v1 --strict` passes. Kept as requirements: two separate
  affirmative acts, neither pre-selected, each recorded with its own version; nothing sent before every due act is
  recorded; exits record nothing; the age gate blocks; the full disclosure is on the sheet and may start collapsed.
  Tightened: the first layer names every data category sent, the recipients and the purpose, in every legal
  language. Chain-16b implements the deltas; 16.2 is ticked when it merges.
- dispatched: chain-16b (reviewer fixes A1–A6 and first-run deltas B1–B7), BASE `5ccb0ea5`, worktree `.claude/worktrees/design-system-v1-chain-16b`, branch `chain/design-system-v1-chain-16b`, implementer on sonnet. #173 commented: option A applied provisionally, B named as the alternative, left open.
- report: chain-16b STATUS complete, 13/13 (A1–A6, B1–B7), fast gate PASS, knip clean, commit `31e9c74a`. Class-A:
  `Sheet` gained `useSheetBack` and `onClosed` (1 s fallback), `FirstRunSheet` gained `consentDue`, `DescribePage.onClose`
  removed, new legal key `firstRunContinue` (en, fr); only `firstRun*` strings changed, no `consent*` key, no version bump.
- integrity: exit 0. merged: `44532e5c` (--no-ff). gate-full on `44532e5c`: FULL GATE PASSED.
- reviewer on `5ccb0ea5..31e9c74a`: VERDICT findings, no report-mismatch, spec conforms. Left for the next shift
  (no new worktrees this shift, by the product-owner session's instruction): #174 (the first-layer coverage test
  passes by key presence) and #175 (label flip while the first-run sheet closes, Make it swallowed after a null
  client-options result, render-phase write in `useSheetHandOver`, the 1 s fallback, dead `useSystemBack` on
  Making/Ready/Failure, stale-record Describe after the app was deleted, two test-hygiene lows).
- tasks 16.1–16.6 ticked (16.2 under the provisional ruling D19; #173 stays open for the owner).

### Shift 1 closing summary

Chains run: 15, 15b (reviewer fixes), 16, 16b (reviewer fixes + first-run deltas). Redispatches: none.
Deviations: all class A; no class B or C. Reviewer verdicts: 15 findings, 16 report-mismatch (undeclared dropped
assertions, restored in 16b), 16b findings. Full gates: `71bd7a6d` pass, `bb5d760f` pass, `895ae528` fail on the
synthrun UDP canary flake only (#172), `44532e5c` pass. Not done from the chain blocks and where it went: see the
"deferred" lines above. Nothing on a device was verified this shift.

## Shift 2 (2026-10-10)

- side branches landed first: `chain/copy-app-data-4` merged as `0ccd05d2` (integrity 0; reviewer: findings, three
  lows, no test removed; gate-full PASS), then `harness/removal-ratchet` as `d25e330d` (decision #78). From
  `d25e330d` on, a commit that removes an assertion or a test needs a `Check-removal: <reason>` trailer on a commit
  touching that file, and the orchestrator reviews each at merge.
- triage of the two device passes on `895ae528` plus #174 and #175: `visual-fixes.md` in this folder (classification,
  the decisions taken for the owner, and the fix chains 16c–16g in two waves).
- gate-full on `4ad56468` (ratchet landed, plan committed): FULL GATE PASSED; pushed. #165, #155, #159, #169 closed.
  `fix/synthrun-reach` has no ready file yet: left alone.
- dispatched, wave 1, BASE `4ad56468`, worktrees `.claude/worktrees/design-system-v1-chain-16{c,e,g}` and
  `.claude/worktrees/ios-ui-driver`: chain-16c (overlays on iOS; implementer on opus, iOS simulator), chain-16e
  (Home and tiles; sonnet, emulator-5560), chain-16g (first-run copy and Plan rows; sonnet, no device),
  `chain/ios-ui-driver` (the XCUITest driver as `scripts/ios-ui-driver/`; sonnet, no device).
- report: chain-16e STATUS complete, fast gate PASS, knip clean, commit `57e7fc2a` (9 files). Proven on emulator-5560
  (light, dark, 100/140/200%): first row clear of the fade (26 dp under the title), ember composer mark, plates on
  one line, whole halo, chips at 200%. AND-M9 reported as no defect (Undo 40 x 22 dp plus `hitSlop` = 64 x 46).
- integrity: exit 0; removal ratchet PASS (additions only). reviewer on `4ad56468..57e7fc2a`: VERDICT findings, report
  matches the diff, nothing removed. Mediums, all carried into chain-16f: Undo is 46 dp tall against Android's 48
  (`LAYOUT.touchTarget`), two of the four "plates line up" assertions pass on the old code, and the grid label's
  side padding became 8 from 135% text where `system.md` §3.2 says 4.
- decision: the grid label keeps 4 pt side padding at every text size (`system.md` §3.2, `handoff/shell-surfaces.md`);
  16f reverts 16e's 8 pt variant.
- merged: `f824c725` (--no-ff). regate (fast): PASS.
- report: chain-16g STATUS complete, fast gate PASS, knip clean, commit `c49599a1` (6 files). integrity exit 0; removal
  ratchet PASS; with the reviewer.
- reviewer on `4ad56468..c49599a1` (16g): VERDICT findings, report matches, nothing removed. Medium: the new
  `firstRunLead` ("Whim has to send some things to our server.") no longer said what the `ai-data-consent` delta
  defines the lead as saying. Lows: coverage patterns that pass a half-dropped sentence, the first `testID` in
  product code, a "picked looks different" test that compared node counts, one stale contract line.
- decision: a legal first layer follows the spec, the spec text does not move. The lead again says that what you ask
  for goes to our server and that AI companies write the code; the row's AI sentence says what they receive
  ("The AI companies get what you ask for, your answers and the plan.", matching the manifest, where AI providers
  get request material only). No `consent*` string and no legal version changed.
- chain-16g fix round (fresh implementer, same branch): commit `107b29e6`, fast gate PASS, knip clean; the follow-up
  diff read by the orchestrator. integrity exit 0; removal ratchet PASS. merged: `4692bcca` (--no-ff). regate (fast): PASS.
- follow-ups from 16g, not done: `expanded` belongs in `GroupedRow` (the sheet has a local `DetailsRow`); `WhimProse`
  sets no `maxFontSizeMultiplier`; `system.md` §6 Checkbox says a `tint` fill where `OptionMark` and the terms row use `ink`.
- report: chain-16c STATUS complete, fast gate PASS, knip clean, commit `e495f3f3` (8 files, new
  `src/host/ui/OverlayModal.tsx`). On an iOS 27 simulator: B2 reproduced at BASE (Customize tile 2/2, Change it 1/1),
  B1 did not (3/3 fresh installs opened Describe: 16b's hand-over works on a device). Measured: a `Modal` mounted
  while another is still up is refused by UIKit, gets no `onShow`, and its full-window host view takes every touch;
  `onDismiss` arrives about 17 ms after the hide. Fix: `Sheet` and `ContextMenu` reach `Modal` only through
  `OverlayModal`, one turn queue per presenting surface; a menu row's action runs once the menu has gone;
  `useSheetHandOver` removed. Proven on the final commit, 3 runs each from a fresh launch with a touch afterwards:
  Agree, Not now then composer, Customize tile, Change it, History, Make a copy, Share link, a quick sequence.
  #175 a, b, c, d, f, g done.
- integrity: exit 0; removal ratchet PASS. reviewer on `4ad56468..e495f3f3`: VERDICT findings, report matches. Mediums,
  carried into chain-16f: an overlay that is up, no longer wanted, and whose exit animation was cancelled holds the
  queue for every other overlay; an overlay unmounted while up passes the turn at once on iOS (unmeasured). Lows: a
  chosen menu row lost if the menu's owner unmounts, the 1 s show watchdog ignores a backgrounded app, the dismissal
  bound no longer pinned by a number in the test, stale contract lines, unused `onClosed` props (16d).
- merged: `1f800bbb` (--no-ff). regate (fast): PASS.
- `chain/ios-ui-driver`: the first implementer stalled for 80 minutes on an approval prompt (one Bash call chaining a
  heredoc, `rm -rf` and a background job) that the orchestrator can neither answer nor cancel; its worktree
  `.claude/worktrees/ios-ui-driver` is left untouched and unmerged. Redispatched fresh as `chain/ios-ui-driver-2`
  (BASE `ebc76c96`): commit `310a3036`, 5 source files under `scripts/ios-ui-driver/`, fast gate PASS, built with
  `build-for-testing`, not run against a simulator. integrity exit 0; `driver.sh` read by the orchestrator.
  merged: `476a1a30` (--no-ff).
- decision: wave 2 is three chains, 16d, 16f and 16h (`visual-fixes.md` updated), so the reviewers' mediums on 16c and
  16e land before the device re-check.
- dispatched, wave 2, BASE `735c8531`, worktrees `.claude/worktrees/design-system-v1-chain-16{d,f,h}`: chain-16d (sheet
  layout and keyboard; sonnet, iOS simulator, first user of `scripts/ios-ui-driver`), chain-16f (menu placement, overlay
  queue hardening, 16e review fixes; sonnet, emulator-5560), chain-16h (offline edge; sonnet, no device). #157 commented.
- gate-full on `735c8531` (wave 1 and the driver merged): FULL GATE PASSED.
- report: chain-16h STATUS complete, fast gate PASS, knip clean, commit `46964314` (7 files). integrity exit 0; removal
  ratchet PASS. reviewer on `735c8531..46964314`: VERDICT findings. HIGH (conformance): the live `server-connectivity`
  spec says no probe is scheduled after the first success ("even if the server later becomes unreachable again") and
  "no additional lifecycle wiring"; the chain adds a 30 s Home re-check and an `AppState` hook with no delta. Cost as
  built: about 120 `GET /health` per phone per hour on Home, which also keeps Cloud Run from scaling to zero while a
  phone has Home open. Medium: the foreground-return probe has no minimum gap.
- HELD, ruling asked of the product-owner session (options A keep the spec, B merge with a delta, C request evidence
  only and no poll, D a network-status dependency later): chain-16h is NOT merged; branch `chain/design-system-v1-chain-16h`
  and its worktree are kept. `system.md` §9 ("following connectivity live") and the live spec disagree, and every fix
  changes a requirement. Until a ruling arrives AND-M2 stays open.
- ruling received (product-owner session) on chain-16h: option C, request evidence only, no steady poll; a MODIFIED delta
  for `server-connectivity`; recorded as design.md D20 by the rework. Option D (OS network status) filed as #182.
  chain-16h rework dispatched (fresh implementer, same branch and worktree).
- report: chain-16d STATUS complete, fast gate PASS, knip clean, commit `4f193232` (10 files). On an iOS 27 simulator
  with `scripts/ios-ui-driver` from the repo (its first real run: build, start, verbs, shot, stop all worked; `type`
  with no focused field hangs it): iOS-B3 did NOT reproduce as unreachable on BASE (at AX5 `tapText` and a plain drag
  both scroll the first-run sheet, the terms row is reachable, Agree enables, Describe opens); a footer rule was added
  anyway (a pinned footer taller than 30% of the window joins the scroll). iOS-M1 reproduced and fixed (`Sheet` keys its
  frame by `fontScale`). Continue rides the keyboard, one header row, sheet top fade, Report keyboard gap, close glyph
  scaling: seen fixed on the simulator. Android focus-after-`onShow`: by reasoning, not device-proven.
- integrity: exit 0; removal ratchet PASS. reviewer on `735c8531..4f193232`: VERDICT findings. Mediums, for fix chain 16i:
  the `fontScale` key remounts a nested raw `Modal` (`ReportSheet` on the Ready page uses `SheetModal`), the unmount-while-up
  hazard; `KeyboardShell`'s `header` slot and header hairline are dead in production; the hairline test now renders a
  screen-host shell, so sheet-host coverage is gone. Low: `Sheet.onClosed` has no production caller.
- merged: `c225b462` (--no-ff). regate (fast): PASS.
- report: chain-16f STATUS complete, fast gate PASS, knip clean, commit `735c79f8` (11 files). integrity exit 0; removal
  ratchet PASS; with the reviewer. Proven on emulator-5560: the menu sits 8 dp under its cell at 1.0/1.4/2.0 in both
  themes (cause: `measureInWindow` starts below the status bar on Android), Undo fires 12 dp above its text.
- reviewer on `735c8531..735c79f8` (16f): VERDICT findings, report matches, all low or low/medium: a menu closed in the
  commit it was granted its turn waits for the 2 s ceiling with an invisible scrim up; a comment that still says Android
  is never timed; `resetOverlayHolds` exported for the rig and applied by patching `TestRenderer.create`; a constant
  compared with a literal in `terms-flow-ui`; one near-tautological assertion dropped from "plates line up" (the test has
  5 assertion calls, was 4). A menu that flips above at 200% reaches 5 dp into the "Your apps" title: `placeMenu` clamps
  to the safe area only, and §7.1 speaks of the row's names, so it is left as it is.
- merged: `7cc09cac` (--no-ff). regate (fast): PASS.
- chain-16h rework: commit `8a3ddf5a` (30 s poll removed; request evidence plus one confirming probe; foreground re-check
  at most once per 10 s; delta `specs/server-connectivity/spec.md`; design.md D20; `system.md` §9 one clause). Fake-clock
  probe count for an idle hour on Home: 1 (the startup probe); the 30 s variant gave 124. reviewer on
  `735c8531..8a3ddf5a`: VERDICT findings. Medium: a probe that settles after the app was backgrounded leaves a failure
  count that lets a later single failed probe turn the notice on. Lows: an in-flight probe is shared with a request
  failure where the delta says "started after"; a loop built while inactive sends its startup probe; two code rules
  missing from the delta. One more round (16h-r2) with these, after staging was merged into the branch (16f and 16h both
  added an `AppState` stub to the test rig).
- dispatched: chain-16h-r2 (same branch and worktree, no device) and chain-16i (BASE the staging tip; reviewer mediums
  on 16d plus two device side findings; sonnet, iOS simulator).
- chain-16h-r2: commit `49da4f44` (one `AppState` stub in the rig, the staging one; a probe that settles in the
  background is no evidence and a return starts from zero; no startup probe while inactive; delta wording and two rules
  added; `system.md` §9 clause made exact). fast gate PASS on the merged tree, `openspec validate --strict` PASS,
  integrity exit 0, removal ratchet PASS; the round's product diff read by the orchestrator.
  merged: `99c59ae7` (--no-ff). regate (fast): PASS. Not device-proven yet: the Android verifier checks it.
- report: chain-16i STATUS complete, fast gate PASS, knip clean, commit `3292d769` (16 files): `SheetModal` presents
  through `OverlayModal`; `KeyboardShell`'s header slot and header hairline deleted; on iOS the footer follows the
  system keyboard frame (the first keyboard of a process reports no "Done" bar, and the library's end report then
  undid a plain frame listener: seen on the simulator); `GroupedRow` stacks a trailing value from 135% text and has
  `chevron.expanded` (the first-run `DetailsRow` is gone, #180's first half); a menu or sheet withdrawn before its
  entrance ends its turn at once; `Sheet.onClosed` removed; the rig resets overlay holds in its render helpers.
- integrity: exit 0; removal ratchet PASS with no count drop. `Check-removal` review (orchestrator): accepted. The
  removed assertions are the header halves of the footer-hairline test (the header slot no longer exists) and the
  once-only checks on `Sheet.onClosed` (the prop no longer exists; `onGone` once-ness is tested by the queue probes).
  reviewer on `4f84f89f..3292d769`: VERDICT findings, all low (the orb menu is still a raw Modal, now recoverable in
  about 1.25 s, #179; the text-size test does not count `onClose` calls; one test's subject moved from `Sheet` to a probe).
- merged: `02822fc3` (--no-ff). The full gate on the commit after it is the regate.
- gate-full on `f72bebce` (chains 16c–16i merged): FULL GATE PASSED; pushed.
- device re-check on `f72bebce`, two fresh verifiers that fixed nothing (findings files copied to
  `~/Work/other/Whim-evidence/visual-2026-10-10/shift2/findings/`, screenshots beside them):
  - Android (emulator-5560): 14 of 16 checklist items fixed, among them menu placement, every menu action, the first-run
    sheet and its hand-over, Continue above the keyboard, back inside the sheet, the Plan page, Settings at 140% and
    200%, and the offline notice under D20 (69 s offline and idle: no notice; a failed Continue: notice; back online:
    cleared in under 30 s; reopened offline: notice 6 s later; cold start offline: notice). NOT fixed: the Describe
    keyboard does not come up by itself on first open. Not checked: plate alignment (no tile without a state line
    without a generation run; chain 16e saw it on a throwaway build).
  - iOS (iPhone 17 simulator, iOS 27): B1 fixed (Agree opens Describe, 4 of 4 fresh installs, touches alive), B2 fixed
    (Customize tile and Change it 3 of 3, History, Make a copy, Share link once each, a quick sequence 3 of 3). B3
    partly: at the largest text size the scroll area is 513 pt and the terms row is reachable through accessibility
    scrolling, but about 25 synthetic drags never moved the first-run sheet while the same drags scroll Settings,
    Customize tile and Plan. New: Home does not re-lay out on a live text-size change; a French first-run row title is
    clipped at the largest size. Everything else on the list fixed, including the first keyboard of a process, the
    Report keyboard gap and the screens the first pass could not reach.
- dispatched, last fix round, BASE `f72bebce`: chain-16j (first-run sheet scroll under a drag, live text size on Home,
  the clipped row title; implementer on opus, iOS simulator) and chain-16k (Android Describe keyboard on open; sonnet,
  emulator-5560).
