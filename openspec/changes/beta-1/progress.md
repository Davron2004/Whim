# beta-1: progress ledger

- 2026-09-25 run-start: staging `integration/beta-1` cut from MAIN_TIP `06ab2007a3ac4f3f04febf8f6ca35b3ff192848f` (origin/main); the approved proposal branch `proposal/beta-1` (`ae84263d`: artifacts, readiness doc, handoff) merged onto it as `f847b1cd`. Nine chains, one at a time, in chains.md order. Section 10 attended by the orchestrator.

## Decisions (orchestrator)

- R1. Local `main` was one commit ahead of `origin/main` (`eaf2dade`, the readiness doc, also on `proposal/beta-1`). Moved local `main` back to `origin/main` so MAIN_TIP is the published tip and the post-merge `pull --ff-only` works after a rebase-merge. Nothing lost: the commit arrives through the proposal merge.
- R2. The untracked `openspec/changes/beta-waitlist/findings-sonar-1.md` (PR #116 Sonar round 1, 0 issues) is committed on the staging branch with this ledger so the primary tree is clean for the gates.
- R3. Implementer models: Opus for chain-1 (the oldest reader every later server must serve), chain-2 (a concurrent FIFO with abort) and chain-4 (the prompt-flow state machine); Sonnet for the rest. One chain at a time, so never more than one Opus agent running.

- R4. Flowbench (10.3) runs against production, before now (production image `0fb65d51` has the same server code as the pre-change staging tip) and after the beta-1 deploy, so both runs share one machine and roster (owner's pick after the local-server probes were denied). Cases: `evals/sets/visible` (22) plus `flowbench/limits` (4 new cases: 2 weather, 2 roommate-ping; the weather cases carry the placeholder slug `habit-tracker` because the tier-0 corpus has no weather slug and flowbench doesn't score by slug). Reports: `flowbench/{before,after}-{visible,limits}.json`.
- R5. Chain-block notes decided ahead of dispatch: chain-2 updates the load-test driver's expectations for the line (`devices > cap` now queues, and only `devices > cap + WHIM_QUEUE_MAX` refuses); chain-3 makes flowbench record a clarify `limit` as its own outcome (not a failure) and thread the new answer shape.
- R6. Rollout order for section 10. `deploy/loadtest/run.sh start` refuses unless HEAD is the tag deployed on the VM (`run.sh:44-51`), so the load test can only measure beta-1's server once it is deployed. After all chains merge, gate-full and the reviewer pass: deploy the staging tip from `../Whim-deploy`, then run smoke, the line check, the 426 check for 381237/382511, flowbench "after" and the load test (10.2). Commit the load-tested caps to `deploy/profiles/standard.env` on the staging branch, so the run still ends in one PR. After the rebase-merge, redeploy the identical tree from `main`, so the deployed tag is a `main` commit. Pre-launch production has no users, and the owner accepted that the pre-beta builds break (they get 426 until beta-1 reaches TestFlight/Play).
- R7. The significant-change acknowledgment (D2, #86), checked against the Xcode 27 SDK (`DeclaredAgeRange.swiftinterface:105-112`):
  - `showSignificantUpdateAcknowledgment(in:updateDescription:) async throws` needs iOS **26.4**, not 26.2 (research was wrong), and returns Void.
  - `AgeRangeService.Error` has no "declined" case (`notAvailable`, `invalidRequest`, `invalidAccount`, `declinedOnboarding`, `network`).
  - Decided: call it only on iOS 26.4+ when `requiredRegulatoryFeatures` contains `.significantAppChangeRequiresAdultNotification`. A normal return is `acknowledged`, a `CancellationError` is `declined`, anything else is `unavailable`.
  - It gets its own 60 s deadline: it waits on a person, so the 3 s age-read deadline would always cut it off. The feature query keeps the 3 s bound.
  - Parental consent (`significantAppChangeRequiresParentalConsent`, PermissionKit's `PermissionQuestion`) stays out of scope, as in D2.
  - The spec delta, D2, and tasks 5.2/5.3 were amended to match.
- R8. The load-tested caps (10.2) go into the `server/src/config.ts` defaults, not `deploy/profiles/standard.env`. The deploy-config suite's `profileProblems` rule ("standard must not override server limits") keeps `config.ts` the one source of defaults, and the standard profile runs with them. The spec delta and task 10.2 were amended to match.
- R9. Dispatch is paused until the usage limit resets (17:00). While the session runs at low-priority capacity, subagent streams can wait on capacity past the 600 s stall watchdog. chain-3 stalled twice (15:12 and 15:22 dispatches) with zero writes each time. The worktree stays clean at BASE `74573b7b`, and chain-3 is redispatched with the same prompt after 17:00.
- R10. chain-6's two device risks, found by reading RN source, are merged as built and checked in 10.4 before any fix (reproduce first).
  - iOS: `automaticallyAdjustKeyboardInsets` is computed once from the pre-avoider frame (`RCTScrollViewComponentView.mm:187-266`), so with the footer `KeyboardAvoidingView` a low focused field can be clipped by the footer's height (~76pt). Check plan row 4+ and clarify "Other" on question 2–3.
  - Android: targetSdk 36 with `edgeToEdgeEnabled=false`, so Android 15+ enforces edge-to-edge and `adjustResize` may stop resizing, leaving nothing to lift Continue. Check on the API 36 emulator.
  - A confirmed risk becomes a fix chain.

## Ledger
- 13:09 chain-1 dispatched: BASE `9a7a69d9a628be58e2877c0bde41de11d1892eaa`, worktree `.claude/worktrees/beta-1-1`, branch `chain/beta-1-1`, @whim symlinks pre-created, model Opus.
- 10.3 flowbench BEFORE (production `0fb65d51`, parallel 2, no retries). Visible 20/22 results: `habit-tracker-p1` repair_exhausted; `tip-splitter-p2` clarify 503 `policy_unavailable` at 10385 ms (filed #119, follows closed #51). Medians: clarify 1320 ms, rewrite 2335 ms, generate 51373 ms (max 142830). Limits 3/4 results: `weather-p1` built a manual bike-or-train helper (reasonable); `weather-p2` built a fake "deterministic forecast derived from the city name"; `roommate-ping-p1` repair_exhausted; `roommate-ping-p2` built a reminder log with `sentAt`, as if reminders were sent. Clarify never answered "can't build" (no limit arm exists yet). Reports: `flowbench/before-{visible,limits}.json`.
- chain-1 report: STATUS complete, GATE PASS, commit `7228cbff`, 4/4 tasks + contract `handoff/wire-protocol.md` (120 lines). Class A only: diagnostics request bodies keep `.strict()` (device→server allowlist, devobs D2; the strip test names them as exceptions; accepted: the tolerant-reader rule covers what a client decodes); `queue_timeout` has no reason constant yet (chain-2 reuses the `server_busy` hint); extra exports `PROTOCOL_HEADER`, `ProtocolLevelHeader`, `ClarifyLimit`, `CLARIFICATION_OTHER_MAX_CHARS`; unary `skip` = today's unknown-code handling for errors, own guard for success bodies; `EVENT_GUARDS` table typed over every event type; `isClarifySkip` requires `kind === 'http'`; fixtures with made-up error codes switched to real server output; `update` maps to the existing `update_required` path. Red-check: 30/77 assertions fail at BASE; weaker variants (unknown fallback → skip; `min` ignored) each fail named cases. Orchestrator check: `tsc -p server/tsconfig.json` clean (the IDE's contract.suite.ts errors are its own config); generation-client.suite.ts:625's type error predates the chain (`a2cc154b`).
- chain-1 merged as `1efd3fcd` (integrity OK, 50 files); tasks 1.1–1.4 ticked. Regate: FAST GATE PASSED. Extra, because the RN graph gained imports: `guard:metro` OK (2151904 bytes), `server:e2e` pass. Worktree and branch removed.
- 14:05 chain-2 dispatched: BASE `e2fe33a90df6b2e238e2e702db6c052e22fd072b`, worktree `.claude/worktrees/beta-1-2`, branch `chain/beta-1-2`, @whim symlinks pre-created, model Opus.
- 14:25 FREEZE (owner, usage limit): no further dispatches; chain-2 allowed to finish. Resume steps in docs/handoff-2026-09-25.md.
- 14:37 chain-2 TERMINATED by the session limit before its report (no resume file written). Orchestrator committed its uncommitted work as WIP `6eb0e3d3` on `chain/beta-1-2` (14 server files, +1171/−122; its last words were "Lint clean. Re-running the gate."). Not in the diff: the `docs/deploy.md` rows (2.3) and the load-test driver (block decision 11). Gate state unknown. No harness feedback from chain-2 (it died before reporting).
- 14:37 UNFREEZE (owner: continue). chain-2 redispatched fresh into the same worktree to continue from WIP `6eb0e3d3` (block: `dispatch/chain-2.md`), model Opus.
- chain-2 (resumed) report: STATUS complete, GATE PASS (knip clean; `server:e2e` 56/0 in the worktree), commits `6eb0e3d3` (WIP) + `614f9650`. Class A:
  - the three keys are routed through the deploy plumbing (`lib.sh` WHIM_VALUE_KEYS, `deploy.sh` optional keys, the operator example);
  - `run.sh drive`/`server/loadtest.mjs` take `--queue-max`, and the driver's per-device limit is 300 s;
  - the load-test verdict also checks that the queued count equals min(devices − cap, queue-max);
  - a `providerRouting(config)` helper;
  - `e2e.ts`'s "fourth is refused" became "fourth waits then completes, fifth refused".
  Decision 4 finding: the daily unit IS the ledger row (`usage-store.ts#admit`, one `BEGIN IMMEDIATE`), so waiters have no row and no new code was added; the contract's "ledger stores queue_timeout" is corrected. Red-checks: no handoff on release → 38 checks fail; abort not moving others up → 5 fail (names in the report). Orchestrator check: the IDE's "declared but never read" on the new line tests was stale (the functions are called at `admission.suite.ts:685-688` and `routes-generate.suite.ts:1438`).
- chain-2 merged (integrity OK, 25 files); tasks 2.1–2.3 ticked. Regate: FAST GATE PASSED. Worktree and branch removed. Filed #120 (classifier calls from the line are bounded by no daily limit).
- 15:12 chain-3 dispatched: BASE `74573b7b023c1543d2829bcbcab751ddeedfb6b0`, worktree `.claude/worktrees/beta-1-3`, branch `chain/beta-1-3`, block `dispatch/chain-3.md`, model Sonnet (R3).
- 15:23 chain-3 agent STALLED (stream watchdog: no progress for 600 s) with nothing written (no commit, no diff, no resume file; no stray processes). ENV, not a gate failure. Redispatched fresh into the same worktree, same block, Sonnet.
- 15:33 chain-3 redispatch STALLED again (600 s watchdog), nothing written. Paused until 17:00 (R9).
- 15:52 R9 lifted by owner: chain-3 redispatched on Opus now, which also tests whether Opus subagents stall at low-priority capacity (chain-2's Opus resume ran 14:37–15:08 in this window without stalling; both Sonnet chain-3 runs stalled).
- 16:05 stall test: the Opus chain-3 was progressing at 12 min (7 files, +229, no stall) in the same low-priority window where both Sonnet runs stalled with zero writes. R9 amended: at low-priority capacity, dispatch implementers on Opus, one at a time. Bug report drafted for the owner to send (/feedback).
- chain-3 (Opus) report: STATUS complete, GATE PASS (`server:test` 4134/0, `server:e2e` 56/0), one commit per task (`7928d646` `83d1e9a5` `eb446f85` `a17c68ad` `5f761728`). Class A:
  - server-side "at most one choice for `select:'one'`" can't be enforced (no mode, no state), so the device enforces it;
  - the `machine.ts:217` comment is about re-running an unverified candidate (D3), so it was reworded to cover both rules, not deleted;
  - every failed non-aborted model call is now recorded in `uncreditedGenerationIds`, so its provider tokens are credited back (previously never);
  - `OpenRouterNetworkError.status`, so a 4xx isn't retried;
  - `restart` goes out through `eventForLevel`;
  - `RunOutcome`'s false/null arms carry `verdict` (a breach's `check` is always `containment_failure`: `RunReport` doesn't name the probe);
  - the neutral lines "Your app was updated." / "Your app is ready." are not owner-reviewed.
  #106 root cause: `machine.ts:950-963` gave the summariser no source-change fact and passed its text straight through; the device save path is fine. Red-checks: a resend without `restart` → 4 checks fail; resending twice → 5; `other` left out of the policy input → 6; a failed attempt not recorded as uncredited → 4 + metering. Orchestrator check: the IDE's "sourceChange missing" was stale (`machine.ts:1077` sets it).
- chain-3 merged (integrity OK, 20 files); tasks 3.1–3.5 ticked. Regate: FAST GATE PASSED. Worktree and branch removed. chain-4's block gains decision 9 (stub markers `[[limit]]` and `[[future:*]]`, for 10.4), from chain-3's note that the stub can't produce `limit`.
- 16:44 chain-4 dispatched: BASE `3b64066ee2f52ce2c6d6561bf098f9d0835f5746`, worktree `.claude/worktrees/beta-1-4`, branch `chain/beta-1-4`, block `dispatch/chain-4.md` (decisions 1–9), model Opus.
- chain-4 (Opus) report: STATUS complete, GATE PASS (knip clean, `server:e2e` pass), commits `5acca0c5` `0a9d7ae3` `17c8502a` `3a5f622f`. Class A:
  - `update` no longer goes through `serviceRefusalOf`; ReportSheet checks the fallback itself, without the notice;
  - new `wire-fallback.ts` and `server/src/stub-markers.ts`; the stub rewrite passes `[[future:*]]` through;
  - the stub clarify gains a `select:'many'` and an `other:true` question;
  - while in line, no step is live and Cancel lands on Home;
  - `restart` rewinds the counts to the current turn's `stage` start, not to zero, so a repair restart keeps the generate count;
  - the update screen's field is `updateNotice`, because `notice` clashes with `useNoticeWindowClear`;
  - LauncherRoot catch bodies were extracted into `clarifyThrewTo`/`settleServerEnding` for lint.
  Red-checks: a "Decide for me" that keeps picks → 2 tests fail; `update` sent to the failure screen → 4 fail. The live heartbeat spec says ~8 s but the code checks 40 s (#123, not reconciled here).
- chain-4 merged (integrity OK); tasks 4.1–4.5 ticked. Regate: FAST GATE PASSED. Worktree and branch removed. chain-6's block now names `OtherAnswerField` (`ClarifyStep.tsx`).
- 17:27 chain-5 dispatched: BASE `63940e4df4b5986e5116c2f67c4c4285da500b13`, worktree `.claude/worktrees/beta-1-5`, branch `chain/beta-1-5`, block `dispatch/chain-5.md`, model Opus (R9).
- chain-5 (Opus) report: STATUS complete, GATE PASS (knip clean), commits `efcead2a` `e038ddc8` `1ef22acb` `0a4f2937` `8d574c67` `f20b55d6`. Class A:
  - 5.2 is split into `requiresSignificantUpdateAcknowledgment()` (3 s) and `acknowledgeSignificantUpdate(description)` (60 s), because one native promise can carry only one JS deadline. It was my block's tension, and the split is accepted.
  - With consent on, the Settings row still opens review mode (so a user can turn AI off without new terms); with consent off it enters the legal flow.
  - The guardian text reuses `termsUpdatedLine`; "older" = `outdated && version < TERMS_VERSION`; a decline stores `blocked`, so it's asked again.
  - Two #104-encoding tests replaced.
  Native: `WhimAgeSignal.swift` passes a standalone `swiftc -typecheck`, and codegen into scratch matches the `.mm`/`.kt` signatures; the `.mm` and `.kt` themselves are uncompiled until 10.4 (iOS needs `pod install`). Red-checks all fail by name (5.1 unbounded → 3; 5.3 no acknowledgment → 24, 3 s guardian → 3; 5.4 old #104 code → 4).
- chain-5 merged (integrity OK, 13 files); tasks 5.1–5.5 ticked. Regate: FAST GATE PASSED. Worktree and branch removed. Archive-order note on #69 (ai-data-consent's Settings-row text vs D6); filed #124 (acknowledgment skipped while the age outcome is fresh).
- 17:58 chain-6 dispatched: BASE `56f19f58005a3fdd2b4b96e9c9ae9242d2bec522`, worktree `.claude/worktrees/beta-1-6`, branch `chain/beta-1-6`, block `dispatch/chain-6.md`, model Opus (R9).
- chain-6 (Opus) report: STATUS complete, GATE PASS, commits `cc0e6fc5` `d747cc96` `633baf3b`. Class A: report-sheet Send/Cancel moved into the pinned footer (visible layout change); inside a sheet the wrapper adds no avoider and no auto inset (SheetModal's KAV stays the only one); Settings (no footer) doesn't pad; plan row editing keeps `autoFocus`; `COPY.keyboardDone`. New `keyboard-shell.ts` + `KeyboardShell.tsx` + `keyboard-shell-ui.suite.tsx` (8 tests; the old screens fail 27 checks). Per-screen 10.4 checklist: Compose (+ Change it/Prompt again), Plan editing, Clarify Other, Report sheet, Settings server address.
- chain-6 merged (integrity OK); tasks 6.1–6.3 ticked. Regate: FAST GATE PASSED. Worktree and branch removed.
- 18:29 chain-7 dispatched: BASE `3eaf36d0f5d4406cb01068dd558a7dab6f1e5cdd`, worktree `.claude/worktrees/beta-1-7`, branch `chain/beta-1-7`, block `dispatch/chain-7.md`, model Opus (R9).
- chain-7 (Opus) report: STATUS complete, GATE PASS; `invariants` 8/8, `bridge:invariants` 13/13, `synthrun:test` 318, `launcher:deliver-verify`, knip, all green in the worktree; commit `2291a036`.
  - 7.2 uses React 19 `createRoot({onUncaughtError})`: one trusted `render` frame per realm, forwarded to `reportError`, and the window listener skips that error so no `runtime` duplicate is sent.
  - 7.3's `orb-geometry.ts` is shared by Orb and the inset; the loader re-sanitizes, strips the value from `__WHIM_THEME__`, and passes it to `NavRoot`.
  - 7.4 uses an SDK-private context, and only the outermost `Screen` pads.
  Class A: `synthrun/observe.ts` `REALM_LISTENER_WHERES` gains `render` (a `useEffect` throw now escapes as `render`), and the synthrun fixture throws from `setTimeout`; loader realm tests live in `deliver-by-source.desktop.mjs`; the context is created lazily (the build's REACT_STUB has no `createContext`); a single commit (interleaved loader hunks). Red-checks: every weaker variant fails named tests. Focus-on-focusin can't go red (native `focus()` already scrolls), so the resize path is the tested one.
- chain-7 merged (integrity OK); tasks 7.1–7.5 ticked. From the main tree: build, FAST GATE PASSED, `invariants`, `bridge:invariants`, `synthrun:test`, `launcher:deliver-verify` all rc=0. Worktree and branch removed.
- 19:10 chain-8 dispatched: BASE `dcf55f9867684697b87c90984f33d670c7f4b892`, worktree `.claude/worktrees/beta-1-8`, branch `chain/beta-1-8`, block `dispatch/chain-8.md`, model Sonnet (R3; normal capacity after the 17:00 reset).
- chain-8 (Sonnet) report: STATUS complete, GATE PASS, range `6f45de84..41c22cd0`. 8.1 trims frames by hand (sonarjs `super-linear-regex` rejected the regex forms); 8.2 is a Modal scrim over the status bar and drops `elevation`; 8.3: #48 doesn't reproduce (the 240px right-aligned box), and examples declare distinct `tileColor`s; 8.4 uses `en-CA`, and the test's own expected-string construction was fixed too. Class A deviation that mattered: `build/build.mjs#extractAppRecord` forwarded only capabilities/schema, so the declared colours never reached the shipped tiles. The implementer rightly didn't touch `build/`.
- chain-8 merged (integrity OK); tasks 8.1–8.4 ticked. Regate: FAST GATE PASSED. Worktree and branch removed.
- Orchestrator bootstrap (build/ is CONFIG_SET, so it's a human-bootstrap class by construction; protected-file system retired): `build/build.mjs` forwards `spec.tileColor`. The generated records now carry `#2563eb`/`#0284c7`/`#c026d3`. Regate on the commit: see next line. A producer-side test is dispatched as fix-8b.
- regate after the build bootstrap: FAST GATE PASSED
- 19:44 fix-8b dispatched (producer-side test for the example tile colours): BASE `c1047184e89671fd5e17f957ef298e59c354491e`, worktree `.claude/worktrees/beta-1-fix8b`, model Sonnet.
- fix-8b report: complete, GATE PASS, commit `cac698a5` (`tile-colour.suite.ts`: reads the generated `APP_RECORDS`, resolves each example through `tiles.ts#tileColor`, checks pairwise distinct). Red-check: reverting the build hunk fails 3 named checks plus the distinctness check. Merged (integrity OK); regate: FAST GATE PASSED.
- 19:53 chain-9 dispatched: BASE `ab8288b69eea90ab2df5ccf8d0a8e60f2d074480`, worktree `.claude/worktrees/beta-1-9`, branch `chain/beta-1-9`, block `dispatch/chain-9.md`, model Opus (device-environment tooling, design open).
- chain-9 (Opus) report: STATUS complete, GATE PASS (18 new tests in `static-checks`), commits `8fe1b9f3` `cc025687` `fca115c3`. Class A:
  - consent state and device id are read from the app's MMKV store (`run-as` on Android, the sim data folder on iOS), because 382511 never shows the device id and beta-1 shows a v1 grant as "Off";
  - 382511's dev server needs `WHIM_PIPELINE=stub`, and its rewrite has no stub, so the old server uses the primary `.env` key (~2 small rewrite calls per platform);
  - extra script options (`--port`, `--avd`, `--sim-*`, `--manual-seed`, `--keep-device`), and it refuses new ≤ old build numbers;
  - `upgrade-record`/`upgrade-diff` in the release CLI; fixtures are real captures from emulator-5554 (build 382100), read-only.
  Red-check caught its own vacuous test (a length-ignoring MMKV parser passed), which was then fixed. Not yet run on a device: the seed flow (10.5 is its first run; `--manual-seed` fallback for iOS). A Release iOS build from beta-1 on ignores the server-address override (matters for the next upgrade check). The exact 10.5 command sequence is in `docs/release/mobile.md` → "Upgrade check". Devices in use by others: emulator-5554 (Pixel_10_Pro_XL) and 4 booted simulators incl. Whim-Upgrade-15Plus. Section 10 creates its own.
- chain-9 merged (integrity OK); tasks 9.1–9.3 ticked (37/45; section 10 remains). Regate: FAST GATE PASSED. Worktree and branch removed. All nine chains merged.
- 20:50 10.1 gate-full on the staging tip `957e28c5`: FULL GATE PASSED (openspec 48/48). Reviewer dispatched on `f847b1cd..integration/beta-1` (Opus).
- Reviewer (Opus) verdict: SHIP WITH FIXES. It ran `server:test` 4174/0, `launcher:test` 12979/0 (also under `fr_CA.UTF-8`), the fast gate, and `tsc` with contract.suite.ts in the program (the IDE error is IntelliJ-only, not real under TS 5.9.3). File lists match the reports; the only protected file touched is `build/build.mjs` (the orchestrator's fix). Report honesty: minor (handoff line on `queue_timeout`, task 1.1's "and server", a vacuous 3.5 check, 9.1 not device-run, all disclosed). Findings:
  - M1: a fallback or `stream_parse` mid-build never aborts the request, so the server holds the slot and the retry gets `device_busy`;
  - M2: a server rollback below beta-1 breaks beta-1 apps (required `select`/`other`, old `answer`), and design.md wrongly calls it harmless;
  - L1: `queue_timeout` is dead;
  - L2: only `restart` goes through `eventForLevel`;
  - L3: two vacuous checks in `wire-v2.suite.ts`;
  - L4: "Build Make me a … instead";
  - L5: the report-sheet notice, and a busy-slot policy refusal writes no ledger row.
- R11. Every finding goes into one fix chain (`dispatch/fix-1.md`), lows included, because most touch the reader that can never be updated and each is small. Then gate-full again and a scoped reviewer re-check of the fix diff before 10.1 is ticked.
- 21:08 fix-1 dispatched: BASE `4132bdfe57c2962f28cd88c35952141b0bcf2d02`, worktree `.claude/worktrees/beta-1-fix1`, block `dispatch/fix-1.md`, model Opus.
- fix-1 (Opus) report: STATUS complete, GATE PASS (`server:test` 4180/0, `launcher:test` 13011/0, `server:e2e` 56/0, `launcher:deliver-verify` green), commits `0b8db185`..`7e49bb55`, one per finding.
  - M1: `ResponseBodyReader.cancel()` in a `try/finally` in `streamEvents`, which aborts on a fallback, a parse or read failure, or a consumer that stops iterating (fetch and XHR). The red-check fails 10 named checks, and a weaker "always cancel" variant fails one.
  - M2: the device defaults a missing `select`/`other`; `docs/deploy.md` gets the no-rollback-below-beta-1 line; design.md is corrected.
  - L1: `queue_timeout` removed (and design D8's mention).
  - L2: `readProtocolLevel(registry)` wraps `c.json`, so every error body is adapted, and `forClient` routes every event. The stub's `[[future:*]]` frames are now registered one level up in `STUB_WIRE_REGISTRY` (class A).
  - L3: the vacuous checks replaced; L4: the alternative is asked for as a noun phrase; L5a: the report-sheet notice.
  - L5b: my premise was wrong (a free-slot policy refusal DOES spend its unit, pinned by "a policy refusal is not refunded"). The busy path now writes a row and refunds it, so the unit asymmetry remains by D8.
  Open: a busy-slot `policy_unavailable` writes no row (noted on #120).
- fix-1 merged (integrity OK). Worktree and branch removed.
