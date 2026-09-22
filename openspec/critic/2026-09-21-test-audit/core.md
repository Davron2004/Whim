# Test audit: core slice

Slice: synthrun/test, the storage-engine, version-store, bridge and logging suites, src/sdk/test, and invariants/.
Classification is from `git diff --numstat main...HEAD` (PR #35). Every file in invariants/ is OLD.

My overall read is that this slice holds up much better than "half should go". The containment tests in
synthrun (relay provenance, whimHostDispatch confinement, the monotonic verdict fence, the pre-load frame,
the egress layers) are the best tests I read. They run against real Chromium, and most of them carry a
control that removes the guard and shows the probe landing. The dead weight sits in three places. The
first is the source-grep and constant-pin tests in logging, storage §F and SDK theme. The second is a
handful of "non-vacuity" tests that turn out to be vacuous. The third is about 2.9k lines of spike
artifacts in invariants/ that no runner touches.

## 1. Totals

| Bucket | Files | Test lines | Est. DELETE | Est. REWRITE/MERGE |
|---|---|---|---|---|
| NEW (isolation.ts, resilience.ts) | 2 | 1,144 | 21 | 12 |
| CHANGED (synthrun acceptance.ts, logging.suite.ts) | 2 | 2,088 | 117 | 97 |
| OLD test code (storage, vstore, bridge, sdk ×5, invariants runners + shim) | 11 | 3,798 | 279 | 273 |
| OLD spike artifacts in invariants/ (not run by anything) | ~25 | ~2,880 (+PNG, ~3.2 MB of HTML) | ~2,880 (OWNER-ONLY) | 0 |
| Runners (5 × run.mjs) | 5 | 193 | 0 | 0 |
| **Total test code** | 15 | **7,030** | **417** (~6%) | **382** (~5%) |

PR #35's own footprint in this slice: isolation.ts and resilience.ts are wholly new (4 findings, 33 lines),
acceptance.ts gained 8 lines of wiring, and logging.suite.ts gained one good test (report-note redaction)
plus a regex edit to a JSX source-grep. That edit is the textbook change-detector symptom: adding an
`onLeave` prop broke the test.

## 2. Per-file findings, worst first

### invariants/sandbox-isolation/bridge/runner.mjs (282 lines, OLD) — REWRITE (OWNER-ONLY)

- [VACUOUS] 4. forged sysret is inert (runner.mjs:L179-198) — REWRITE. The probe self-posts forged sysrets
  for ids 1-8, then awaits `call('storage.kv.set')`, then calls `get` and asserts `value === 'REAL'`. The
  forged messages are queued tasks. They get dispatched while only the `set` id is pending, so without the
  `ev.source` guard they would resolve `set`, whose result the test throws away. By the time `get` gets its id,
  every forgery has been consumed, so `get` always returns the host's answer. The test passes with the guard
  deleted. Rewrite: issue `const p = call('storage.kv.get', …)` first, then post forged sysrets for
  `id = 1..seq+8` (or read the id off the outgoing frame), then `await p` and assert `'REAL'`. Red-check it by
  removing the source check in syscall.js.
  > **Correction (2026-09-21, mutation run):** this VACUOUS claim is wrong. With the guard removed, the check
  > FAILS (`resolved value="ATTACKER"`), because `get` is registered in the microtask checkpoint before the
  > next forged frame is dispatched. The verdict is now KEEP-FIX: it's live but fragile, because it relies on
  > the fixture's syscall count staying under ~7. The suggested wide-id-range rewrite still makes it robust.
  > The same run showed that `INV-CUEGATE`'s `forged-sysret-inert` sub-assertion does NOT discriminate the
  > guard. See README "Forged sysret: settled by a mutation run".
- [DUPLICATE] 5. stale-generation frame dropped (L200-213) — DELETE. It calls the Node dispatcher through
  `page.evaluate(() => whimHostDispatch(...))` from the outer page. No sandbox is involved, so it is the same
  assertion as src/host/bridge/test/acceptance.ts:202-207 run through a browser.
- [TRUSTS SELF-REPORT] 6. sql-injector end-to-end (L215-224) — REWRITE. The pass condition is the hostile
  bundle's own rendered text (`/INJECTIONS LANDED: 0/`). That is the F4 anti-pattern (constraint #3), even
  if this fixture happens to be honest. Rewrite: after the run, read `host.realm.engine` from the shim.
  Tables `c1`/`kv` still exist, the row count equals the fixture's legitimate appends, and no adversarial
  string shows up as an identifier. Keep the text checks only as secondary signals.
- [TRUSTS SELF-REPORT] 2. undeclared-capability denial (L103-109) and 1. water-counter round-trip (L87-101)
  — KEEP-FIX. Both judge by fixture text. In #1 the `loaded` regex includes `saved`, so it adds nothing.
  Have the shim record sysrets and assert host-side: a `undeclared_capability` sysret for #2, and the kv
  value in `host.realm.engine` for #1.
- [NO CONTROL] 3. stub-authority (L111-151) — KEEP-FIX. A walk that matches property names against
  `/engine|native|sqlite|…/` has no negative control. An escalation stored under a neutral name
  (`_h`) passes. Add a control page that plants an engine-like object on the facade and assert the walk
  flags it.
- [HARNESS WEAKER THAN PROD] scenario() (L72) uses `page.exposeFunction('whimHostDispatch', …)`. The sandbox
  realm can call that binding directly and skip the relay's `ev.source` check (the hole the synthrun
  observer closed with `exposeBinding` plus a main-frame guard, synthrun/observe.ts:490-501). No gate
  check gives a false pass because of it, but stub-authority never looks at that name. KEEP-FIX: mirror
  synthrun's guard.
- [TIMING] scenario() waits a fixed `settle ?? 900` ms (L76) before reading anything. A slow gate fails
  red rather than false-green, so it's a flake, not a hole. KEEP-FIX: wait on the shim's dispatch count
  or a DOM marker.
- INV-CUEGATE (L237-271) and the negative control (L226-235) — KEEP. The recording backend is the trusted
  observer, and the granted sub-run proves the gate is live.

### synthrun/test/acceptance.ts (1,535 lines, CHANGED) — KEEP-FIX (2 REWRITE, 3 DELETE)

- [VACUOUS] forged verdict: a raw unauthenticated probes frame is rejected (L576-598) — REWRITE
  (containment). The fixture forges `contained: true` on a harmless app whose genuine verdict is also `true`,
  so `obs.state.contained === true` holds whether the forgery was adopted or rejected. `rejectedForgeries > 0`
  and `eventKinds(obs).includes('rejected-forgery')` hold on every run, because probes.js's own T6b spoof
  produces one rejection per run (pinned at L1251: a clean candidate tallies `count === 1`). Only the
  `__FORGED_BY_TEST` payload check discriminates. Rewrite: forge `contained: false` (as the six-way fixture
  does), assert the verdict stays `true`, and assert `rejectedForgeries === <clean baseline> + 1` rather
  than `> 0`.
- [VACUOUS] determinism: two independent runs produce the same action sequence (L1143-1162) — REWRITE.
  It uses `FIXTURE_UNREACHABLE_SCREEN`, which has no interactive element, so both `actionsLog`s are empty
  (synthrun/sweep.ts:375-383 only logs swept elements) and `'' === ''`. Rewrite: run a fixture with several
  buttons and a nav edge (navigation-demo, or a Mint variant with three buttons), and assert the sequence is
  non-empty before comparing.
- [PLATFORM/META] red-check: a perturbed builder option is caught as drift (L81-112) — DELETE. It builds the
  fixture with its own inline esbuild config and `jsxFactory: 'React.createElementPerturbed'`, then asserts
  the bytes differ from production. That only proves esbuild honours `jsxFactory`. It never touches
  `buildCandidateFile`, and the equivalence test above already guards the empty case (`harness.js.length > 0`).
- [RED-GREEN-ARTIFACT/DUPLICATE] red-check: withTotalBudget with no signal is unaffected (L989-1003) —
  DELETE. `truncated === true` without a signal is already L950-964. `aborted === undefined` pins the
  return shape of the day the parameter was added.
- [DUPLICATE] red-check: a trivially harmless candidate is clean too (L1372-1380) — DELETE. The clean-report
  test (L1217-1252) asserts `ok === true` and zero diagnostics on a richer candidate in the same session.
- [TIMING] fixed sleeps before positive assertions — KEEP-FIX (swap each for the file's own
  `waitUntil`). runtime_throw `wait(200)` (L489); legal interval `wait(250)` then `contained === true`
  (L567-569); confinement 4.2a `wait(200)` then `rejectedForgeries === before + 1` (L631-632); malformed
  verdict `wait(200)` ×2 (L871, L882); capability wiring `waitForTimeout(500)` then "a denial was recorded"
  / "A's write landed" (L335, L363). The probes frame lands ~20 ms after paint when the machine is idle. With four
  contexts on a loaded gate that margin is a race. Same lesson as node-suite-fixed-tick-budget-flake.
- [TIMING] awaitQuiet rides out the hard cap (L1032-1042) — KEEP-FIX. `elapsed < 400` against a 150 ms cap
  is a wall-clock upper bound, and a regression that ignores the cap hangs the whole suite on a bare
  `await`. Race it against a timeout and drop the tight upper bound.
- [CHANGE-DETECTOR] clean report (L1250-1251) — KEEP-FIX. `forgeries.count === 1` pins probes.js's T6b
  implementation detail. Keep `rejected === (count > 0)` and drop the exact count.
- [WEAK] date string type_mismatch (L1515) — KEEP-FIX. `hint.includes('at')` matches "date", "format",
  "that". Assert the quoted field name.
- [PATTERN] The file's own `ok()` (L49-56) doesn't delegate to `node:assert`, against CLAUDE.md's test
  rule, so 39 tests carry `eslint-disable sonarjs/assertions-in-tests`. Same in isolation.ts (19) and
  resilience.ts (6). Switching to checks/test/harness.ts removes all 64 disables.
- Everything else in this file is KEEP, notably the relay re-mint confinement (L660-715), the
  whimHostDispatch confinement (L730-777), the monotonic fence with the malformed frame interposed
  (L795-851, which is exactly the discriminating test against a cell-keyed fence), and the pre-load frame
  (L906-947).

### src/host/logging/test/logging.suite.ts (553 lines, CHANGED) — DELETE (4 tests), REWRITE (2)

- [SOURCE-GREP/CHANGE-DETECTOR] the launcher wraps its screen switch in the boundary (L528-552) — REWRITE.
  It regex-matches `LauncherRoot.tsx` JSX attribute order (`/<ScreenBoundary\s+screen=…\s+FallbackComponent=…\s+onLeave=…>/`).
  This PR had to edit the regex because a prop was added, which is proof it catches edits, not bugs. It also
  sits in the logging suite while testing launcher wiring. Rewrite in a launcher suite: render the shell
  with the launcher test renderer (the launcher runner already aliases react-native), make the active screen
  throw, assert `ScreenErrorFallback` renders inside the shell chrome and its leave action returns home, and
  assert `DevLogTools` renders nothing when `devLogOverlayEnabled` is false.
- [SOURCE-GREP] the dev-log wire types cross the device seam type-only (L479-507) — REWRITE. The invariant
  is real (zod must never reach Metro, and guard:metro only checks the bundle builds and exceeds 500 KB).
  The check, though, only polices four `DevLog*` names, only single-quoted one-line imports, and pins
  `seen.length >= 3`. Rewrite: every import from `'@whim/contract'` anywhere under `src/` must be
  `import type`, parsed with the TS AST (as isolation.ts's launch scan does) rather than a regex.
  observability-ui.suite.ts:291 has a narrower copy that can go.
- [SOURCE-GREP/CHANGE-DETECTOR] the channel registry is the only place a channel name is written
  (L182-203) — DELETE. `CHANNELS.gen === 'whim:gen'` is a constant equal to its literal. The scan for
  repeated literals inside the seam's own modules guards DRY, not behaviour.
- [SOURCE-GREP] no `obs-v1-interim` marker survives (L448-455) — DELETE. It locks a finished migration. A
  newcomer can't tell what it protects.
- [SOURCE-GREP] the three retired prefixes survive at no call site (L465-477) — DELETE. Same migration lock.
- [SOURCE-GREP/DUPLICATE] the silent-catch tripwire still has both selectors (L509-526) — DELETE. It
  string-matches protected config (`.eslintrc.js`), and gate.sh's CONFIG_SET tripwire (scripts/gate.sh:23-38)
  already refuses to run on any diff to that file.
- [SOURCE-GREP] the seam is the only diagnostic console caller in src/host (L457-463) — KEEP-FIX. This one
  locks a real privacy invariant: a raw `console.log(prompt)` skips redaction. It belongs in ESLint
  (`no-console` on src/host with the probe/test overrides), which only the owner can add.
- [TAUTOLOGY] every sensitive field name is redacted (L205-225) — KEEP-FIX. It loops over
  `SENSITIVE_FIELD_NAMES` from the implementation, so deleting `prompt` or `apiKey` from that list still
  passes. Assert against a list written in the test (`prompt`, `deviceId`, `apiKey`, `token`, `note`, …).
- [RED-GREEN-ARTIFACT] levels are ordered (L129-136) — KEEP-FIX. Drop the `LEVELS` / `LEVEL_ORDER` literal
  pins. The filtering half below them is the test.
- [TIMING] the flush interval bounds delivery (L329-345) — KEEP-FIX. A 5 ms interval, then a fixed 40 ms sleep
  and `sent.length === 1`. Poll with a bound instead.
- The new report-note redaction test (L229-236) — KEEP.

### src/host/storage-engine/test/acceptance.ts (984 lines, OLD) — DELETE (8 tests), REWRITE (1)

- [SOURCE-GREP] §F (D3) the burned-ID regex has a single source of truth (L796-819) — REWRITE (injection
  invariant). It greps engine.ts for the regex literal, the import and a `.test(` call, which is refactor-brittle.
  Worse, it stands in for a behavioural test that doesn't exist: nothing in this suite opens an artifact with
  a malicious collection, field or tombstone id. §C only attacks display names and values. Rewrite: open
  artifacts whose `id`, a field `id`, or a `tombstones` entry is `c1"; DROP TABLE kv;--`, and assert
  `invalid_artifact` with `rec.log.length === mark` (no SQL ran).
- [SOURCE-GREP] §F (D7) op-sqlite binding: no executeSync ternary (L821-836) and device-acceptance no
  ternary (L838-844) — DELETE. They lock the removal of dead code.
- [CHANGE-DETECTOR] §F (D7) assertExecuteSyncAvailable throws iff… (L846-880) — DELETE. A three-line guard
  against an op-sqlite downgrade (the test's own comment says the pinned v16 always has `executeSync`),
  asserted by exact message text. A missing `executeSync` fails loudly with a TypeError anyway.
- [PLATFORM/TAUTOLOGY] §A isolation: two apps… separate files (L100-112) — DELETE. The test picks two file
  paths and shows SQLite keeps them apart. The appId-to-file mapping lives in op-sqlite.ts, and the fork
  appId rule is covered in launcher (generation-request.suite.ts, store-access).
- [PLATFORM/VACUOUS] §A ephemeral mode (L187-199) — DELETE. "`:memory:` created no file" is SQLite, and
  "none of the ephemeral writes are present in a persistent store" reads a different, never-written file.
  The real check is on device (storage-engine/device-acceptance.ts:209-216).
- [CHANGE-DETECTOR] §A the verb surface accepts no app/store-addressing parameter (L114-121) — DELETE. It
  pins `Object.keys(store.kv)` and never tests addressing. The comment admits TypeScript enforces the claim.
- [DUPLICATE] §D list() primary-key integrity (L704-730) — DELETE. §A verbs round-trip (L128-138) already
  asserts `list() == [{ id, … }]` with the id from `append()`.
- [RED-GREEN-ARTIFACT] §G burnedIdFloor importable with no native binding (L898-904) — DELETE.
  `typeof burnedIdFloor === 'function'`. The suite bundling at all proves the import path.
- [DUPLICATE] §C (c) adversarial where values are bound (L610-615) — MERGE into §C (a) (L586-598), which
  already runs `list({ where: { body: evil } })` and checks the log.
- [DUPLICATE] §D validateArtifact rejects field "id" (L667-684) and collection "id" (L732-749) — MERGE into
  one `store.open()` table test with L686-702. The engine boundary is what matters.
- Keep §B (additive DDL, rename, tombstone, rollback, abandonment), §C, §E, and §G peek tests.

### synthrun/test/isolation.ts (798 lines, NEW) — KEEP-FIX (1 REWRITE, 2 DELETE)

- [NO RED DIRECTION] egress: probeEgressBlocked passes on a live session (L717-728) — REWRITE. This
  function is the server's boot self-test (server/src/lifecycle.ts:151). Only its pass direction is tested,
  so a probe hard-coded to `blocked: true` passes. Rewrite: build the same probe against a session or context
  with interception removed (it may need a seam that accepts a context factory) and assert `blocked === false`
  with `canaryConnections > 0`.
- [PLATFORM] builder: an unused import of a repo file is erased (L428-435) — DELETE. It asserts esbuild's
  TS import elision. If esbuild stopped eliding, the resolve plugin would refuse the import, which is safer,
  and this test would still go red.
- [DUPLICATE] egress control: a default-options browser reaches the canary (L636-648) — DELETE. The bare
  control (L585-596) already reaches the HTTP, WS and UDP canaries with no network layer, and the sandbox
  flag doesn't matter to this.
- [CHANGE-DETECTOR] sandbox: no code path launches Chromium with the sandbox disabled (L476-488) — KEEP-FIX.
  The AST scan is a sound static lock on a standing invariant. Keep "exactly one sanctioned launch", but drop
  the file-location pin `sanctioned[0].startsWith('synthrun/session.ts')` (L487) so moving the launch
  doesn't break it.
- The rest is KEEP: the per-layer egress tests each have a control, the hostile candidate has an unguarded
  control, and service-worker refusal and the builder's re-export refusal each have a leak control.

### invariants/sandbox-isolation/run-against-build.mjs (306 lines, OLD) — KEEP-FIX (1 REWRITE, OWNER-ONLY)

- [VACUOUS] 5. same-realm re-injection, T7 finding (L205-222) — REWRITE. Both waits end in
  `.catch(() => {})`, and the only assertion is `contained === 'true'`. If the re-injection never happens,
  the gen-1 verdict satisfies it, and `anyPoison` goes to `notes` without being checked. Either assert that
  gen 2 was reached, `anyPoison === 'true'` and `contained === 'true'` for the gen-2 verdict, or drop it to a
  logged note. The product never re-injects same-realm (CLAUDE.md: "never re-inject").
- [TRUSTS SELF-REPORT] 4. reset re-injection (L180-203) — KEEP-FIX. `cleanRealm` ORs the trusted
  `anyPoison === 'false'` with a regex over the victim bundle's own rendered text (L200). Use only the
  probes line.
- [TIMING] A1 ev.source guard (L143-178) — KEEP-FIX. The positive control (the legit re-inject bumps the
  generation) is read after a fixed `waitForTimeout(400)` (L168). Use `waitForFunction(gen > before)`.
- Every other check is KEEP. b-tip, b-evil/F4, INV-TIMER (with its no-reset control), c-blob and the broken-CSP
  negative control all hold up. One gap worth the owner's time: the only negative control weakens the CSP.
  Nothing re-runs the suite with `allow-same-origin` added or neutralize.js skipped to show the other two
  legs are observed. probes.js's in-realm `negCtl` covers part of that.

### src/sdk/test/theme.acceptance.ts (265 lines, OLD) — DELETE (pins), MERGE

- [CHANGE-DETECTOR] literal design pins (L146-193, L218-221) — DELETE. SHELL/STATUS hex values, RADIUS,
  SPACING, MOTION, `TYPE_SCALE.quote`, `metaPlain` transform and spacing are constants equal to literals
  copied from the design doc. They catch only a deliberate edit.
- [RED-GREEN-ARTIFACT] `'orbWheel' in MOTION === false` (L190) — DELETE. It locks a deletion.
- [CHANGE-DETECTOR] DEFAULT_THEME.colors ← SHELL/STATUS mapping (L91-99) — DELETE.
- [DUPLICATE] the two appColor sweeps (L44-64, L66-87) — MERGE into one. The second one's reserved set even
  drifted (it drops `STATUS_COLORS.done`).
- Keep appColor determinism and reserved-hue avoidance, sanitizeTheme (untrusted input), the hex-shape loop,
  the microcopy-roles-distinct rule, and the font-file-on-disk check (L231-263), which catches a real silent
  Android bug.

### src/host/version-store/test/acceptance.ts (827 lines, OLD) — KEEP-FIX (3 DELETE, merges)

- [INTERNALS] §lineage-stamp: snapshot() records the creating lineage in the commit trailer (L311-325) —
  DELETE. It reads raw git commits via isomorphic-git and checks `message.includes('main')`, which pins the
  D1 storage choice. The behaviour is covered by §lineage-correctness (L342-393).
- [DUPLICATE] §ST-6b rollback to g1 then roll forward (L184-196) — DELETE. Same as §3.4 (L138-150).
- [VACUOUS] §2.3 constructor refuses a data handle (L93-102) — ~~DELETE~~ **REWRITE (overturned 2026-09-21, see verification.md)**. `catch { threw = true }` accepts any
  throw, including a failed dynamic import. What it tests is a name blacklist
  (`['dataStore','data','database','db']`, engine.ts:120) that TypeScript already enforces.
- [DUPLICATE] §4.2 auto-compaction fires (L507-512) — MERGE into §5 KV auto-compaction (L563-576), which
  asserts before/after and `looseObjectCount === 0`.
- [DUPLICATE] §6.1 extra schema artifact (L580-589) — MERGE into §6.2 (L591-600). The store has no
  per-file special-casing to catch.
- [DUPLICATE] unborn-HEAD for timeline (L266-276) and history (L688-701), and §C8 history/active untagged
  (L767-815) — MERGE each pair into one parametrized test.
- [META] §assertNoGitLeak HEX40 (L738-762) — MERGE. assertNoGitLeak is a test oracle (only the suite and
  device-acceptance call it). Keep its two "still throws" negative controls beside §3.7 and drop the
  false-positive half, which fails loudly on its own.

### src/host/bridge/test/acceptance.ts (421 lines, OLD) — KEEP-FIX (4 DELETE)

- [TAUTOLOGY] §D the SyscallFrame surface carries no app addressing field (L253-257) — DELETE. It builds a
  frame with the test's own `frame()` helper and asserts that helper's keys.
- [DUPLICATE] §E a second capability is one row — diag.echo (L272-279) — DELETE. Dispatch through the same
  pipe is §G4 and gating is §B/§G2. Cues made the "second row" proof real.
- [DUPLICATE] §G8 gate ORDER (L400-405) — DELETE. Same assertion as §B gate ORDER (L177-182).
- [CHANGE-DETECTOR/DUPLICATE] §G1 cue rows are exactly two (L326-334) — DELETE. An exact method list, plus
  the duplicate-registration throw already in §A.
- [CHANGE-DETECTOR] §A exact seven storage verbs (L127-130) — KEEP-FIX. Drop the list and keep the
  append-only throw.
- [TIMING] §C late result after realm reset (L219) — KEEP-FIX. A 50-macrotask poll for `release`. Resolve a
  latch from inside the handler.
- Keep §B, §C dedup, stale-gen and malformed envelopes, §D cross-app, §E launch conflict, §F, and §G2-G7.

### src/sdk/test/smoke.acceptance.ts (14 lines, OLD) — DELETE

- [RED-GREEN-ARTIFACT] `defineApp(spec) !== spec` (L11-13). Identity isn't part of the contract (a copy
  would be fine), and every other SDK suite already imports `../index`.

### src/sdk/test/navigation.acceptance.tsx (194 lines, OLD) — KEEP-FIX

- [VACUOUS] L41-42: `Object.hasOwn(publicSdk, 'NavRootProps')` is always false because types are erased,
  and `typeof publicSdkMustNotAcceptHostRootProps === 'function'` is always true. The `@ts-expect-error`
  (L34) does the real work under tsc, since src/sdk/test is type-checked. Delete the two runtime lines and
  keep L40.

### src/sdk/test/list.acceptance.tsx (34 lines, OLD) — KEEP-FIX

- [VACUOUS] It asserts only that no duplicate-key warning fired. A `List` that renders nothing passes too.
  Also assert the four children rendered.

### invariants/ spike artifacts (OLD, OWNER-ONLY): none is exercised by any runner

The `invariants:spike2` script was retired 2026-06-18, and `build/assemble.mjs` plus `src/runtime/web/*` are
the production copies.

- `reference/bundle.js`, `reference/sdk.js`, `reference/runner.js`, `reference/neutralize.js`,
  `reference/probes.js`: Spike-1 sources, productionized into src/runtime/web. Dead. DELETE (git history keeps them).
- `reference/demo.html` (749 lines): a Spike-1 desktop demo page. Dead. DELETE.
- `reference/spike1-android-result.png`: a historical screenshot (26/26, predates T1-T7). Belongs in docs,
  if anywhere. DELETE from invariants/.
- `sandbox-isolation-probe.html` (169 lines): a manual Spike-1 page with no gate, and its message listener
  has no source check (critic G9). DELETE, or move to docs as history.
- `spike2-bundle-contract/pages/*.html` (5 pages, ~3.2 MB with React inlined): superseded by
  run-against-build.mjs. DELETE.
- `spike2-bundle-contract/runner.mjs`, `package.json`, `package-lock.json`: an orphaned standalone runner
  (and an untracked playwright copy in its node_modules). DELETE.
- `spike2-bundle-contract/reference/{probes.js, neutralize.js}`: ancestors of src/runtime/web. Dead. DELETE.
- `spike2-bundle-contract/reference/fixtures/*.app.tsx` (4): superseded by fixtures/adversarial/*. DELETE.
- `spike2-bundle-contract/README.md`: describes the archived suite. Delete it with the folder.

### Non-test files in the slice (one line each)

- synthrun/test/run.mjs: fine. Its header still says "Not yet wired to an `npm run` script", which is stale
  (`synthrun:test` exists).
- storage-engine, version-store, bridge and sdk run.mjs: fine.
- invariants/sandbox-isolation/bridge/host-shim.ts: fine. It is the real gate/dispatcher over node:sqlite.
- invariants/sandbox-isolation/README.md: mostly accurate. It says "→ 7 checks" but run-against-build now
  records 9, and its `reference/` section documents files nothing uses.
- invariants/sandbox-isolation/.build-pages/ and bridge/.build-pages/: generated and gitignored. Fine.

## Keep (no findings)

- synthrun/test/resilience.ts. Abort at every wait, crash replacement, failed relaunch. Latched races, and
  every await is bounded by `within`.
- src/sdk/test/chart-geometry.acceptance.ts. Pure geometry with independent expected values, including
  known real weekdays and a TZ-immunity sweep that discriminates against a Date-based implementation.

## 3. Patterns

1. **Fixed sleeps before positive assertions (TIMING), about 14 sites.** synthrun acceptance has 7, and the rest
   are logging flush-interval, the bridge §C tick loop and the invariants runners' `settle`/`waitForTimeout`.
   Example: acceptance.ts:567-569 waits 250 ms and then asserts `contained === true`, with a genuine frame
   that arrives ~20 ms after paint on an idle box. Every one of these files already has a `waitUntil`/latch
   helper, so the fix is mechanical.
2. **Constants asserted equal to their literals, and exact surface lists (RED-GREEN-ARTIFACT /
   CHANGE-DETECTOR), about 10 tests.** theme hex/RADIUS/SPACING/MOTION pins, `CHANNELS.gen === 'whim:gen'`,
   `LEVELS`, the storage `Object.keys(store.kv)`, the bridge seven-verbs and two-cue lists, smoke's
   `defineApp` identity, `typeof burnedIdFloor === 'function'`, `aborted === undefined`.
3. **Source-grep that locks a patch (SOURCE-GREP), 8 tests.** Two lock a real invariant and should be
   rewritten or moved to lint (console-only-through-seam, type-only contract imports). Six lock a
   migration or dead-code removal and should go (the op-sqlite ternary ×2, the burned-ID literal, the interim
   marker, retired prefixes, eslintrc selectors). logging.suite.ts:528-552 is the example: it matches JSX
   attribute order and had to be edited in this PR when a prop was added.
4. **"Non-vacuity" tests that are themselves vacuous, 6 tests.** The forged-verdict test forges the same value
   as the genuine verdict (acceptance.ts:576-598). Determinism compares two empty sequences (L1143-1162). The
   bridge-runner forged sysrets are consumed before the asserted call (runner.mjs:179-198; REFUTED by a mutation run, see the correction above). The T7 check
   passes if re-injection never happens. probeEgressBlocked is never shown to fail. The perturbed-builder
   red-check is really a test of esbuild. These are the most dangerous findings in the slice, because each one
   looks like a proof.
5. **DUPLICATE, 8 tests.** vstore §ST-6b = §3.4; storage §D list = §A verbs; bridge §G8 = §B order; bridge
   §G1/§E-diag; the synthrun harmless red-check = the clean report; the isolation default-options control =
   the bare control; the bridge-runner stale-gen = bridge acceptance §C.

Cross-cutting: the synthrun, storage, vstore and bridge acceptance suites use hand-rolled `ok()` helpers
that don't delegate to `node:assert` (CLAUDE.md "Test assertions"). synthrun pays for it with 64
`eslint-disable sonarjs/assertions-in-tests` lines.

## 4. Incidental (production, one line each)

- storage-engine: a corrupt `_meta` row makes `open()` fall back to `emptyApplied()` (§E(b) asserts this).
  On a database whose tables already exist, the planned `CREATE TABLE "c1"` has no `IF NOT EXISTS`
  (see `isHostAuthored`), so open() likely fails with a raw SQLite error rather than a structured one. The
  burned-ID floor is lost either way. Only the empty-table case is tested.
- bridge: `diag.echo` (a latency-probe capability) is registered in the production default registry
  (rows.ts:148-160), so any generated app that declares `diag` gets a host echo. Harmless, but it ships a
  probe capability.
- synthrun/test/run.mjs header comment is stale (see above).
