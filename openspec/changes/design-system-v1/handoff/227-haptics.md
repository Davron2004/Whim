# 227 haptics (builder handoff)

STATUS: complete (builder scope; gate not run by me).
Commits: f6a9a230 fix(launcher): play the §5 ready, failed and handoff haptics (#227); a second commit
fixes the test's FailureKind ("generic" is not a kind; typecheck caught it) and adds this file.

## Call sites
- src/host/launcher/ReadyPage.tsx:139 `haptics.play('success')` in a mount effect. The Ready page
  mounts as the delivery lands (its own header: "the page mounts as the delivery lands"), so mount is
  the frame the ready state appears. Reduce Motion is read only by the motion, not here.
- (Superseded by the fix pass: failure plays only for a live failure.)
  src/host/launcher/FailurePage.tsx:94 `haptics.play('failure')` in a mount effect. FailurePage is the
  only page for a failed run (MakingPage hands over to it; renderRunPage in LauncherRoot is the one
  mount point, also used when a failed attempt is reopened), so one owner, no double play from
  MakingPage. A retry goes Failure -> Making -> Failure: a new failed run is a new mount, plays again.
- src/host/launcher/FailurePage.tsx:116 `haptic="handoff"` on the retry action's Button ("Try again"
  and "Try again as it is"): same Button path as "Make it" (prepare on touch-down, play on press).
- Whim sheet Send plays nothing (fix pass): Send only opens the change's Describe/Plan, the same
  step as Describe's Continue. The change's hand-off is "Make the change" on its plan page, which
  already passes haptic="handoff" (PlanPage.tsx:614).

## Tests (src/host/launcher/test/haptic-moments-ui.suite.tsx, wired in acceptance.ts)
- haptics: the Ready page plays success once as it appears, with motion / under Reduce Motion, and a re-render does not replay it
- haptics: the Failure page plays failure once as it appears, with motion / under Reduce Motion, and a re-render does not replay it
- haptics: Try again on the Failure page plays handoff once, on the press
- haptics: the Whim sheet's send plays handoff once, on the press
Expected native calls come from the real moment map (`haptics.play`), not literals.

## Red-checks (done by me)
All four calls removed together in one run (they are independent, each test names its site):
EXIT=1; Ready tests (both modes) failed "got [], want notification:success,CONFIRM"; Failure tests (both
modes) failed "got [], want notification:error,REJECT"; Try again and Whim send each failed
"got [1, []], want [1, ['impact:medium,1,CONFIRM']]". Restored (git checkout) afterwards. Not run as
four separate runs. The "re-render does not replay" assertions are only discriminating against a
replaying implementation (e.g. effect without []), not tested by deletion.

## Suites run
- npm run launcher:test: EXIT=0 (19629+ checks) with the final code; also EXIT=0 before the test type fix.
- npm run typecheck: OK. eslint on the four touched files: clean.

## Unsettled / not done
- Tests render ReadyPage/FailurePage/WhimSheet directly, not through the real shell; the shell mount
  point (renderRunPage) is unchanged and assumed to mount each page once per appearance.
- PlanPage's own "Try again" (plan problem, PlanPage:608) has no handoff haptic; the issue named only
  the Failure page and the Whim sheet, so I left it. system.md §5 lists "Try again" generally.
- Reopening a failed attempt from its ghost tile mounts FailurePage and plays failure again (fixed in
  the fix pass below).

## Fix pass (review-227.md)
Commits: a4fa2d93 (code, tests, system.md, review-227.md), then this section.
- HIGH 1: WhimSheet.tsx back to BASE (no Send haptic). Tests: "the Whim sheet's send hands nothing to
  Whim yet, so it plays nothing"; "Make the change on a change's plan plays handoff once" (PlanPage).
- HIGH 2 + MEDIUM 3: FailurePage.tsx:37-50 `FailureAnnouncement` token + `announceFailure()`; :81 prop
  `announce`; :108-113 plays once per token (WeakSet), never without one, so neither a re-render nor a
  page-key remount of the same failure replays. LauncherRoot.tsx:292 screen field; set at :1928
  (`failure()`, so also `genericAttemptFailure`), :2416 (`showStreamFailure`), :2521 (a refused Retry
  replacing its Making page: a live run's page, so it announces; class A call, flag if wrong); passed
  at :3667. `failureFromRecord` (ghost tap, app link, See why) leaves it unset.
- Shell tests (LauncherRoot): "a run that fails with the sheet open plays failure once; its tile and an
  app link reopening it play nothing"; "a run that delivers with the sheet open plays success once on
  its Ready page, and nothing more through Done". Component: the same failure mounted again, and a
  page with no announcement, play nothing.
- LOW 4: success stays on ReadyPage mount. LOW 6: system.md §5 "Try again (Failure page)". LOW 7: done.
- No shell test drives an actual page-key change on the failure screen (no driver found); the
  component second-mount test covers the replay it would cause.
Suites (session scratchpad verdicts/227-fix-<n>.log): fix-1 EXIT=0 (19638 checks); typecheck OK;
eslint on touched files clean.
Red-checks: fix-2 EXIT=1 (Send haptic re-added; PlanPage haptic dropped; failureFromRecord announces;
Ready play dropped): 10 failures, each its own haptics assertion. fix-3 EXIT=1 (FailurePage plays on
every mount = builder original): second-mount, no-announcement, tile and app-link assertions failed.
fix-4 EXIT=1 (showStreamFailure without announce): "plays failure once" got []. Restored after each.
