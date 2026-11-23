# Dispositions: fix-wbp-issues

Nested /fix-loop on `integration/webview-bridge-provenance` (PR #309). Findings are worked in four lanes, one
worktree each, because findings in a lane share files: lane `static` (gh-299), lane `launcher-ui`
(gh-300, gh-301, gh-302, gh-308), lane `dev-ui` (gh-303, gh-304, gh-305), lane `ios-pods` (gh-306, gh-307).
UI findings get a device screenshot pass (Android emulator + iOS simulator) on the integrated tip after merge.

Line shape: - <UTC time> <finding-id|lane> <event> — <detail>

## Ledger
- 2026-11-23T16:09:17Z batch run-start — nested on integration/webview-bridge-provenance @ 566aab12; planners dispatched for all four lanes
- 2026-11-23T16:10:43Z gh-306,gh-307 stale-ok — evidence present at HEAD (fixloop.sh stale rc=0)
- 2026-11-23T16:10:56Z ios-pods worktree-created — fix/ios-pods, BASE a9acfa84, .claude/worktrees/ios-pods
- 2026-11-23T16:11:46Z gh-299 stale-ok — evidence present at HEAD; planner's shorthand-property side finding folded into the lane
- 2026-11-23T16:11:49Z static worktree-created — fix/static, BASE 8ecdfef7, .claude/worktrees/static
- 2026-11-23T16:14:43Z gh-300,gh-301,gh-302,gh-308 stale-ok — evidence present at HEAD; gh-300 and gh-308 design/copy calls taken by the orchestrator (recorded in plan.md)
- 2026-11-23T16:14:45Z launcher-ui worktree-created — fix/launcher-ui, BASE 04116e59, .claude/worktrees/launcher-ui
- 2026-11-23T16:18:39Z gh-303,gh-304,gh-305 stale-ok — first run exited 7 falsely (LauncherRoot.tsx line present); root cause a SIGPIPE race in fixloop.sh stale, fixed in 6c5757c0 with a red-first preflight case; rerun rc=0
- 2026-11-23T16:18:40Z dev-ui worktree-created — fix/dev-ui, BASE 2901d84e, .claude/worktrees/dev-ui
- 2026-11-23T16:18:52Z gh-306,gh-307 fix-reported — fix/ios-pods fcfae36a (gh-307), 80acffea (gh-306); structural-no-test; worker gate PASS
- 2026-11-23T16:19:10Z gh-306,gh-307 integrity-0 — 4 files, all in allowlist; removal ratchet PASS
- 2026-11-23T16:19:38Z gh-306,gh-307 verify-reject — reviewer APPROVE with 4 low doc defects (Ruby PATH, run-from-root, Gemfile ruby floor 2.6 vs 4, run-on paragraph); sent back as revision 1
- 2026-11-23T16:19:59Z gh-299 fix-reported — fix/static 954a20ed; behavioral; worker gate PASS; checks:test 568/0
- 2026-11-23T16:20:49Z gh-299 integrity-0 — 5 files in allowlist; ratchet PASS
- 2026-11-23T16:20:49Z gh-299 redcheck-red — prod files reverted: PASS 562 · FAIL 6 (non-vacuous); reviewer dispatched
- 2026-11-23T16:25:24Z gh-299 verify-reject — revision 1: param/class-field location false positives, chain-wide hint, alias hint, static-checks spec list
- 2026-11-23T16:30:14Z gh-303,gh-304,gh-305 fix-reported — fix/dev-ui ded36767/e88f0f7b/8cd049e8; worker gate PASS; launcher:test 20641/0
- 2026-11-23T16:32:49Z gh-303,gh-304,gh-305 integrity-0 — 12 files in allowlist; ratchet PASS
- 2026-11-23T16:32:49Z gh-303 redcheck-red — dev-log-view.ts reverted: UTC test fails
- 2026-11-23T16:32:49Z gh-304 redcheck-red — HomeHeader.tsx reverted: deferred-navigation test fails (gh-305 structural-no-test, not red-checked)
- 2026-11-23T16:32:49Z gh-306,gh-307 fix-reported — revision commits c246bf73 (Gemfile ruby floor, mobile.md steps) and e37c7cc1 (markdown nits); integrity-0; orchestrator read the revision diff: reviewer defects 1-4 addressed → verify-ok
- 2026-11-23T16:33:19Z gh-299 fix-reported — revision 1 00eb5cdd (taint-source hints, root-member hint, param/class-field exemptions, spec list); integrity-0 (allowlist + static-checks spec.md); ratchet PASS
- 2026-11-23T16:38:09Z gh-303,gh-304 verify-reject — revision 1: cancelled long-press still navigates (slide-off/terminate); pill covers toast trailing end
- 2026-11-23T16:38:09Z gh-299 verify-ok — reviewer APPROVE revision 1; revision 2 requested for two folded-in items (paren skip on bare path; destructuring-pattern defaults/computed keys never visited)
- 2026-11-23T16:38:09Z gh-301,gh-302,gh-308 fix-reported — fix/launcher-ui 12d4d972+c93b56ca (gh-301), 926382af (gh-302), f1cbe6e0 (gh-308); worker gate PASS
- 2026-11-23T16:38:09Z gh-300 escalated — class-B: no existing-token mapping makes Android on/off read by knob colour within the 3:1 rule; options put to the owner (custom iOS-shaped Android switch recommended); owner asked for screenshots, answer pending
- 2026-11-23T16:41:41Z gh-300 owner-decision — keep the native switch on both platforms, recolour only so ON is obvious; colour on the knob allowed (beyond black/white), worker's call; no custom switch
- 2026-11-23T16:44:14Z gh-303,gh-304 fix-reported — revision 1 9a2f0ae9 (lift-only open, disarm on slide-off) + 8dda91c7 (pill above a single-line toast); integrity-0; orchestrator read the revision diff → verify-ok (gh-305 unchanged, approved in review 1)
- 2026-11-23T16:44:26Z gh-299 fix-reported — revision 2 12429c37 (paren/!/as skip on the bare path; destructuring defaults and computed keys visited); integrity-0; ratchet PASS; reverting the two prod files fails the 2 new tests; orchestrator read the diff → verify-ok
- 2026-11-23T16:49:11Z gh-306,gh-307 gatefull-pass — FULL GATE PASSED on fix/ios-pods (started before the docs-only whitespace commit e37c7cc1 landed; the post-merge regate covers it)
- 2026-11-23T16:55:08Z gh-306,gh-307 merged — f2599b1b
- 2026-11-23T16:55:08Z gh-306,gh-307 regate-pass — FAST GATE PASSED on the run-branch tip
- 2026-11-23T16:55:08Z gh-300 fix-reported — fix/launcher-ui 6bd88fe2: new role switch-on #208E4E; Android on = green knob on ink track, off = ink knob on border track; iOS on track switch-on; switchShortfalls unchanged and green; integrity-0 (+ tokens.ts); redcheck-red (GroupedList.tsx reverted: 5 hue checks fail)
- 2026-11-23T16:58:00Z gh-300 verify-ok — reviewer APPROVE (RN ReactSwitch applies colours as opaque MULTIPLY filters, so ratios hold on device; switch-on vs positive justified); nits: mockup OFF knob (sent back), plan.md gh-300 section superseded by the owner decision; note: a disabled Android switch would look enabled (no disabled switch rows today)
- 2026-11-23T17:12:05Z gh-299 gatefull-pass — FULL GATE PASSED on fix/static 12429c37
- 2026-11-23T17:17:19Z gh-299 merged — 4c878a39
- 2026-11-23T17:17:19Z gh-299 regate-pass — FAST GATE PASSED
- 2026-11-23T17:34:12Z gh-303,gh-304,gh-305 gatefull-pass — FULL GATE PASSED on fix/dev-ui 8dda91c7
- 2026-11-23T17:39:38Z gh-303,gh-304,gh-305 merged — 91747095 (device check pending for placement, first tap, strip, toast)
- 2026-11-23T17:39:38Z gh-303,gh-304,gh-305 regate-pass — FAST GATE PASSED
- 2026-11-23T17:55:23Z gh-300,gh-301,gh-302,gh-308 gatefull-pass — FULL GATE PASSED on fix/launcher-ui af7dc0d8 (incl. mockup nit af7dc0d8)
- 2026-11-23T18:01:13Z gh-300,gh-301,gh-302,gh-308 merged — db44ffbc (device check pending)
- 2026-11-23T18:01:13Z gh-300,gh-301,gh-302,gh-308 regate-pass — FAST GATE PASSED
- 2026-11-23T18:25:54Z device-check — Android + iOS passes over d2e0ff80: gh-300 (both schemes, both platforms), gh-301, gh-302, gh-303, gh-304 (opens on lift; slide-off doesn't open; first tap works on Android), gh-306/gh-307 (Bundler path verbatim in a fresh worktree, tree clean) PASS; gh-305 FAIL (toast still shown) → wbp-d2; new findings wbp-d1, wbp-d3..d6 filed in findings.md round 2
- 2026-11-23T18:26:07Z wbp-d1,wbp-d6 worktree-created — fix/bridge-race, BASE c112783f
- 2026-11-23T18:26:07Z wbp-d2..d5 worktree-created — fix/polish, BASE c112783f
- 2026-11-23T18:56:23Z wbp-d1,wbp-d6 fix-reported — fix/bridge-race f0577bb3 (launch before first load end waits for the token; absent token still fails closed), b60a6c72 (chips above the status lines); reproduced 3/3 on iOS sim before, 3/3 CONTAINED after; product path not exposed (cold-start tile tap OK before and after)
- 2026-11-23T18:56:23Z wbp-d1,wbp-d6 integrity-0 — 8 files incl. the change's spec delta + handoff/host-auth.md; ratchet PASS; redcheck-red (useMiniAppHost.ts + runtime-message-auth.ts reverted); security reviewer dispatched
- 2026-11-23T18:59:54Z wbp-d1,wbp-d6 verify-ok — security reviewer APPROVE (waiter bound to the channel instance, token before launch, fail-closed kept, product path never waits); 4 low hardening items sent to a fresh worker
- 2026-11-23T19:10:15Z wbp-d2,wbp-d3,wbp-d4,wbp-d5 fix-reported+verify-ok — fix/polish 494abe94/24cf5229/1df64570/f4e16d1e; integrity-0; ratchet PASS; redcheck-red d3 (KeyboardShell.tsx) and d4 (GroupedList.tsx+tokens.ts); d2 device-only (control run without the filter brought the toast back); d5 not reproduced (screenshots predated consent), regression pin added; reviewer APPROVE (Reanimated 4.8 ReducedMotionConfig System = startup value re-applied; IAV style hits only the in-tree host). Follow-up filed: #310 (move the Done bar off InputAccessoryView)
- 2026-11-23T19:10:31Z wbp-d7,wbp-d8 worktree-created — fix/round3, BASE 55565ea0
- 2026-11-23T19:16:08Z wbp-d1 fix-reported — hardening 508c4742 (waiting launch resets paint/nav state like bind; unmount/WebView-swap tests; handoff + spec scenario tidied); integrity-0; orchestrator read the prod diff → verify-ok
- 2026-11-23T19:27:00Z wbp-d2..d5 gatefull-pass — FULL GATE PASSED on fix/polish f4e16d1e
- 2026-11-23T19:32:22Z wbp-d2..d5 merged — 170a240d
- 2026-11-23T19:32:22Z wbp-d2..d5 regate-pass — FAST GATE PASSED
- 2026-11-23T19:33:27Z wbp-d7,wbp-d8 fix-reported — fix/round3 7729a3a3 (AI-features content inset 16 pt like its siblings; the reported overlap did not reproduce in en/fr at default/L/XXXL text — the 8 pt inset put the switch's touch target into the header), dcdd7cbf (Logs panel sets its own status bar style); integrity-0; ratchet PASS; redcheck-red d7 (ConsentScreen.tsx); d8 device-only (__DEV__ false in suites); orchestrator read the diff → verify-ok
- 2026-11-23T20:05:02Z wbp-d1,wbp-d6 gatefull-pass — FULL GATE PASSED on fix/bridge-race 508c4742
- 2026-11-23T20:05:02Z wbp-d7,wbp-d8 gatefull-pass — FULL GATE PASSED on fix/round3 dcdd7cbf
- 2026-11-23T20:10:21Z wbp-d1,wbp-d6 merged — ae396ad1
- 2026-11-23T20:10:21Z wbp-d1,wbp-d6 regate-pass — FAST GATE PASSED
- 2026-11-23T20:15:44Z wbp-d7,wbp-d8 merged — 811b3f9d
- 2026-11-23T20:15:44Z wbp-d7,wbp-d8 regate-pass — FAST GATE PASSED
