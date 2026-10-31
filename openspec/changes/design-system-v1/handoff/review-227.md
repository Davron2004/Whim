# Review: #227 haptics (`f7cef4f8..4c3523e1`)

Reviewer: Opus, effort high, 2026-10-30. Saved by the integration orchestrator (the reviewer has no write tool).

VERDICT: findings (2 HIGH / 1 MEDIUM / 4 LOW). Report honest; diff is additions only (no assertion removed); the single-run red-check accepted (each test failed with its own message).

## HIGH
1. `src/host/launcher/WhimSheet.tsx:142-146` plays `handoff` on a non-§5 moment. Whim sheet Send → `onWhimSend` → `onDescribeContinue(describeStep(...))` (LauncherRoot.tsx:3417-3433): the same step as Describe's Continue (grows into the plan page; Continue plays nothing). "Make the change" is the PLAN page's button (`COPY.planBuildEdit`), which already passes `haptic="handoff"` (PlanPage.tsx:614); #227 confused it with Send. As built, one change buzzes handoff twice, and Send buzzes even when `onWhimSend` returns early (legal flow, no client options, app unreachable). Done: the WhimSheet haptic removed; the suite asserts Whim sheet Send plays nothing and PlanPage with `editing` ("Make the change") plays `handoff` exactly once on press; each red-checked.
2. `src/host/launcher/FailurePage.tsx:92-95` replays `failure` when a failed attempt is reopened: failed/interrupted ghost tap → `onOpenPending` → `failureFromRecord` (LauncherRoot.tsx:3172-3211) remounts FailurePage; also the app-link path via `onOpenPending` (~:3323). system.md:383 calls this a tile tap opening the Failure page; spec :502 and §5 forbid a haptic on a tapped sheet. The moment is the frame where the failure replaces a live run's page: screens built by `failure()` (~:1898) and the settle paths (~:2393), not `failureFromRecord`. Done: FailurePage takes an explicit prop (e.g. `announce`/`live`) set only on live transitions and left unset by `failureFromRecord`; a shell-level LauncherRoot test: a run that fails with the sheet open plays `failure` once; tapping its ghost afterwards plays nothing; both red-checked.

## MEDIUM
3. `src/host/launcher/test/haptic-moments-ui.suite.tsx:37-62`: re-render checks use `tree.update` with the same type and key, catching only an effect without `[]`, not shell remounts. MakingSheet `Pages` (MakingSheet.tsx:80-87) remounts a page when `pageKeyOf` or node type changes; the failure key `run:${journalId ?? recordId ?? pendingId ?? 'failed'}` can change while on the failure screen → replay. MakingPage is never rendered, so a future `failure` play there would pass. Done: Ready and Failure asserted through LauncherRoot: one live run → Making → Ready/Failure gives exactly one native call, none on later screen updates, and reopen silent (finding 2).

## LOW
4. `ReadyPage.tsx:137-140`: no reopen problem (only reachable via `readyStep` on a live making screen, LauncherRoot.tsx:3066). Open: M10 (system.md:501) puts the visual moment at the ember's landing (`travel.landed`), a `morph` after mount. ORCHESTRATOR DEFAULT: keep on mount (the issue's done condition: "the frame its page appears"); flagged to the PO as an owner call.
5. Failure page Try again via Button `haptic` matches Make it (prepare on touch-down, play on press): correct.
6. PlanPage's Try again (PlanPage.tsx:608) only re-runs the plan request (`resumePlan`, LauncherRoot.tsx:3153) = Continue, not a hand-off; silent is right. Done: system.md §5 reads "Try again (Failure page)".
7. handoff/227-haptics.md WhimSheet bullet: rewrite once finding 1 lands.
