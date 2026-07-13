# Tasks: synthetic-run-harness

## 1. Candidate builder and page assembly

- [ ] 1.1 Create the library directory (top-level, `checks/`-style: no workspace entry) with the entry-point signature from the spec (candidate source + options → run report) as types first
- [ ] 1.2 Implement the single-candidate builder mirroring the production esbuild contract (IIFE, classic JSX, externals, `tsconfigRaw:'{}'`), consuming `runtime-artifacts.json` `parts` + `buildSrcdoc`/`buildOuterHtml` read-only (design D6)
- [ ] 1.3 Byte-equivalence tripwire test: builder output for a fixture app === production `build.mjs` output for the same fixture (red-check by perturbing a builder option)
- [ ] 1.4 Chromium session lifecycle: one `chromium.launch()` per session, fresh context+page per run, semaphore for concurrency, teardown on report completion (design D4)

## 2. Observation and watchdog

- [ ] 2.1 Trusted-vantage collectors: nonce-frame listener (`delivery`/`paint`/`error`/`probes`), `pageerror` + console capture, all keyed to the run's generation (design — spec §Observation is trusted-vantage only)
- [ ] 2.2 Watchdog: mount budget → `mount_timeout`; per-action quiet-window with hard cap (no diagnostic); total budget → kill + `run_truncated`; every timeout an explicit named outcome, no silent catch (design D2)
- [ ] 2.3 Source-map resolution: map `pageerror` stacks to original-source `line` when possible, omit otherwise (spec §Diagnostics)
- [ ] 2.4 Node tests: hostile fixtures throws-on-mount, never-resolving `delay` before render (mount_timeout), infinite fast `interval` that mounts fine (no diagnostic), forged-verdict frames (ignored) — red-check mount_timeout against a watchdog-free stub

## 3. Capability wiring

- [ ] 3.1 Wire the production bridge per the bridge-invariants recipe: `launchApp` + `createEngine(createNodeSqlExecutor(':memory:'))` + `Dispatcher.forRealm` + `page.exposeFunction('whimHostDispatch', …)` + `syscallSink:'exposed'` (design D3)
- [ ] 3.2 Host-side denial collection at the dispatch function; recording effectors for `cues.*`/`diag.*` (real gate, recorded invocation); pre-mount schema application with failure-as-diagnostic
- [ ] 3.3 Node tests: undeclared-capability denial carries the bridge's kind verbatim even when the app swallows the rejection; cross-candidate isolation (A writes, B sees empty); schema-application failure surfaces

## 4. Interaction sweep and screen coverage

- [ ] 4.1 Element enumeration via CDP (roles + accessible text) with `(kind, label, DOM path)` fingerprints; escalate to the human if any SDK component proves un-enumerable (design Risks — a `data-*` marker would be a separate SDK change)
- [ ] 4.2 Per-screen sweep driver: sorted-fingerprint action order, per-component action recipes (tap/type/toggle/segment/slider/modal inside-first), re-enumerate after each action, per-screen cap (design D1)
- [ ] 4.3 Nav-aware traversal: `__whimNavDepth` change → sweep the new screen; visited-screen set bounds cycles (requires `sdk-navigation` merged)
- [ ] 4.4 Cold-mount pass for declared-but-unvisited screens via `__whimControl.reinject({reset:true})`; emit `unreachable_screen` warnings (spec §Screen coverage)
- [ ] 4.5 Tests: state-minted element swept once and sweep terminates; determinism (two runs, same action sequence + diagnostics); unreachable-screen fixture renders `Orphan` and flags it

## 5. Diagnostics, report, and gate

- [ ] 5.1 Add the runtime-observed kinds to `DIAGNOSTIC_KINDS` in `checks/contract.ts` (additive; denial kinds reused verbatim, not duplicated); confirm checks suite green
- [ ] 5.2 Assemble the run report: diagnostics, verdict, per-stage timings, syscall/cue trace, screens visited/declared, budgets applied; hint mandatory on every diagnostic
- [ ] 5.3 End-to-end acceptance: one well-formed multi-screen fixture (from `sdk-navigation` 4.2) yields a clean report; one six-way-hostile fixture yields exactly the expected diagnostic set; wire both into a new `npm run` suite entry mirroring the existing suite pattern (script addition is Class-2 `package.json` — flag for human application)
- [ ] 5.4 Add the `synthetic-run` row to `docs/capabilities.md`; append the decision-log entry (harness placement, gate-never-faked, watchdog policy, measure-don't-budget)
- [ ] 5.5 Run `scripts/gate.sh`; resolve anything red
