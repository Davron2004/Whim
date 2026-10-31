# lows-s4: the shift's final LOW batch (branch chain/design-system-v1-lows-s4, BASE c9bd8da2)

Red-check = the fix or guard weakened, targeted `--only` run fails, restored.

1. (236) app-launcher delta, haptics requirement: iOS native-switch exception moved out of the nested parenthesis into
   its own sentence (SHALL stays on line 1) + `#### Scenario: A native switch on iOS plays no Whim haptic`.
2. (239-240) `LauncherRoot.tsx` `orbOver`: `stuck` = stalled AND not queued (as HomeScreen). Test in
   `changing-in-use-ui.suite.tsx` (real shell: stall -> orb ember `stuck`; queued event -> `working`; a further
   minute of silence while queued -> still `working`; sampler ticks driven by capturing the 1 s `setInterval`).
   Red: fix reverted -> `got 'stuck', want 'working'`.
3. (239-240) handoff `239-240.md` #240 lines edited in place (no `GRID.stateLines`, no cap); the M2 fix-pass text kept.
4. (239-240) `home-grid-ui.suite.tsx` queued-change test also asserts the tile plate's `TilePlate.props.stuck`
   (false while queued, true once out of the queue). Red: HomeScreen queue check removed -> `light: got true, want false`.
5. (237-241) `consent-gate-ui.suite.tsx`: new test through the real shell (consent withheld): change sent from the
   running app's Whim sheet -> app gone once the first-run sheet is up, still gone after agreeing and while it is made,
   Failure page's Close lands on Home. Red: `under` kept across the consent screen -> "agreeing does not bring the app
   back" fails. (Keeping `under` alone, without the effect change, did NOT fail: the screen replacement is what
   removes the app; the red-check needed both edits.)
6. (237-241) `system.md` See why row: carried across a History round trip; a fresh open of the app from Home starts clean.
7. (237-241, optional, done) toast per-frame no-overlap test now runs with Reduce Motion off and on (passes as is).
8. (234-235) `system.md` rule 6: "...letting go before it dismisses only if the release itself passes."
9. (234-235) `shell-surfaces-ui.suite.tsx` sheet commit-haptic table: brisk peek to 90 pt (no tick, springs back) and
   brisk drag to 110 pt (arms, closes) on the 400 pt card. Red: `ARM_FLOOR` 0.5 -> 0.4 fails the 90 row; -> 0.6 fails the 110 row.
10. (harness) `only-filter.mjs`: `filterSource` returns `unmatched`; `requireMatched` fails when ANY pattern matched no suite
    (`no suite matched --only <typo> (the other patterns did)`). Tests in `only-filter.suite.ts` (unit + spawned bridge
    `--only §G4,no-such-suite`). Red: guard weakened to `kept.length > 0` -> bridge run exits 0, test fails.
11. (harness) `only-filter.suite.ts`: the real bridge acceptance entry filtered to one test, its `passed++` removed:
    armed `--only` run exits 1 "executed 0 tests" (control with the counter: exit 0). Red: `onlyRanNothing` line removed
    from bridge `acceptance.ts` -> exit 0, test fails.
12. (harness) `CLAUDE.md:52`: "matches a suite name, or a test title written in the entry file itself" (one line).

Exit codes (capped-run.sh): launcher:test 0 (19830 checks, 0 failed) · checks:test 0 (PASS 457, FAIL 0) · typecheck 0
(its first run caught the stale `only-filter.d.mts`, fixed) · targeted `--only` runs green 0, red runs 1.
eslint --max-warnings 0 on the 7 touched code files 0 (first pass caught a nested-functions error and a shadowed `run`, fixed);
openspec 1.4.1 --strict valid, 1.14.1 valid (long-requirement warnings pre-exist).
