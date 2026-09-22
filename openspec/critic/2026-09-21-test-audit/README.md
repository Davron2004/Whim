# Test audit, 2026-09-21

This is a quality audit of every test in the repo, not only the ones PR #35 adds. It asks one
question per test: what realistic bug would make this fail? Tests with no good answer are marked for
deletion. Tests that protect something real, but badly, get a concrete rewrite.

- **Baseline:** `integration/store-launch` at `a5b3cd9` (PR #35, "Prepare Whim store launch and public
  generation server"), compared with `main` at `3a66cca`. Each file is classified NEW, CHANGED or OLD
  relative to the PR.
- **Method:** five read-only audits, one per slice, all using the shared [rubric](rubric.md): 12
  failure-mode tags and five verdicts (DELETE, REWRITE, MERGE, KEEP-FIX, KEEP). After that, the
  orchestrator checked the claims listed under [Verification status](#verification-status) by hand.
  The audits ran nothing. Afterwards, four mutation runs (each reverted) and a round of reading
  re-checked the DELETE verdicts; see [verification.md](verification.md).
- **Supersedes** the per-file verdicts in `docs/pr35-test-exploration.md`, which marked nearly every
  suite "Keep". That file is still useful as a reading-order guide.
- **Line numbers** are as of `a5b3cd9`. Re-check them if the branch moves.

## Files in this folder

| File | Scope |
|---|---|
| [rubric.md](rubric.md) | The standard every slice was judged by. Reuse it for future audits. |
| [server-behavior.md](server-behavior.md) | `server/test`: routes, streams, wire, contract, admission, policy, prompts, e2e |
| [server-ops.md](server-ops.md) | `server/test`: machine, ledger, resolver, openrouter, deploy-config, prod-build, loadtest, web-site, config, admin, reports, logging, metering |
| [launcher.md](launcher.md) | All 77 test files under `src/host/launcher` |
| [tooling.md](tooling.md) | `checks/test` incl. release suites, `evals/test`, `scripts/test`, `scripts/netdeny/test`, `.claude`/`.codex` hook tests |
| [core.md](core.md) | `synthrun/test`, storage-engine, version-store, bridge, host logging, `src/sdk/test`, `invariants/` |
| [verification.md](verification.md) | **Read before deleting anything.** The DELETE verdicts re-checked: 4 mutation runs, 8 overturned verdicts, 2 conditional deletes, and how far to trust the unchecked rest |

Each slice report has a totals table, per-file sections ranked worst first, with a `file:line`,
the quoted assertion, a verdict and a rewrite for each finding, then patterns, a Keep list and an
Incidental list.

## Headline numbers

| Slice | Test lines | DELETE | REWRITE / MERGE |
|---|---:|---:|---:|
| Server behavior | 8,612 | ~1,220 (14%) | ~290 |
| Server ops | 7,993 | ~630 (8%) | ~470 |
| Launcher | 14,488 | ~1,420 (10%) | ~1,980 |
| Tooling | 8,850 | ~900 (10%) | ~1,150 |
| Core (test code) | 7,030 | ~417 (6%) | ~382 |
| **Test code total** | **~47,000** | **~4,500 (10%)** | **~4,300 (9%)** |
| `invariants/` spike leftovers (owner-only) | ~2,880 + ~3.2 MB HTML | all | 0 |

By lines, this is not the "half" that was suspected. About 10% should be deleted outright and about
9% rewritten, and most rewrites shrink: 30 launcher source greps become a few rendered tests, and 45
release mutation tests become tables. Counting tests instead of lines, the waste is closer to what
was suspected. In the launcher, about 230 of ~830 `h.test` calls are source greps, tautologies,
change detectors or duplicates. The waste is small, numerous tests, while the big behavioral suites
are mostly sound.

What held up well: the new server route suites (routes-generate, routes-unary, disconnect), the money
tests (ledger, resolver, machine credit and deadline handling, SIGTERM drain), the synthrun
containment suites, and the release lints that the release CLI actually runs.

## Patterns across the repo

These are the red-before-green rule's leftovers, most common first. Counts come from the slice
reports.

1. **Source greps of code** (~175 tests: ~140 launcher, ~26 tooling, 8 core, plus server). A test
   reads a `.tsx`/`.ts`/Swift/Kotlin/shell file as text and regex-matches it. Most lock one past patch,
   not a standing rule, and break on any rename. The launcher ones rest on a premise that's now false:
   ~18 suite headers say "Node can't render RN, so grep the source", but PR #35 added
   `test/react-screen.ts` + `test/native-host.tsx`, and `test/run.mjs:30-34` aliases `react-native`
   to them. The suite renders real screens and the whole `LauncherRoot` today. About 10 greps lock a
   real rule and should move to lint or `checks/` (e.g. host code logs only through the seam; device
   imports of `@whim/contract` stay type-only; no emoji in theme).
2. **Red-checks committed as permanent tests** (~65 in server-ops alone, more elsewhere). The
   one-time proof that a test can fail was kept in the gate: planted weakenings, rewritten scripts,
   poisoned bundles. `deploy-config.suite.ts:1224-1247` rewrites `deploy/lib.sh` to `sleep 5` and
   asserts the mutant is slow, a real 5 s sleep on every gate run. Its `plant()` helper throws when the
   target text is reformatted, which crashes the whole server suite. Keep one negative control per
   checker; the rest belong in the fix loop.
3. **Constants and schemas restated** (~55 zod restatements in server-behavior, 25 config defaults, 13
   constant-table checks in tooling, ~45 copy/style/count pins in the launcher). Tests assert a
   constant equals its literal, or that zod accepts what the type already says. Example:
   `AI_CONSENT_VERSION === 1` fails on the very bump the consent spec requires.
4. **Helpers extracted only to be tested** (~15 in the launcher, plus `reconcile.ts`,
   `InMemoryUsageStore`, `checkIosSceneLifecycleWiring`, `hasNonGrantingExit` on the product side). A
   one-line ternary is pulled out of a component so a red-then-green test can exist. The regression
   that matters lives in the caller, which the test never reaches. Some of these helpers are now dead
   production code kept alive only by their tests.
5. **Tautologies and tests of test doubles** (~14 tooling, ~9 groups server-behavior, several
   launcher). The fake decides the verdict under test (`policy.suite.ts:294-314`), the fixture has the
   implementation's shape (which hid the eval bug below), or the expected values are computed with the
   implementation's own logic (`screen-exits` `frameEdgesFor`).
6. **Tests that can't fail** (6 "non-vacuity" checks in core, 6 tests in server-ops, plus the
   hand-written-array and same-value checks elsewhere). The non-vacuity ones are the most dangerous,
   because each one looks like proof that something is covered. See the forged-verdict entry under
   Verification status.
7. **Duplicates across sibling files** (~25 launcher, ~14 server-behavior, 12 tooling, ~12 server-ops,
   8 core). For example, the device-header gate is tested 4 times, cancel-stops-events 3 times, and
   the Retry-After table exists in three places.
8. **Fixed sleeps and wall-clock windows** (~14 core, 7 server-behavior, 7 server-ops). Two can hang
   with exit 13: `policy.suite.ts:113` (only pending timer is an unref'd `AbortSignal.timeout`) and
   `launcher/test/history-wait.suite.ts:64` (`within()` unrefs its timer).
9. **Custom assertion helpers that bypass `node:assert`**: `server/test/harness.ts`, launcher
   `test/harness.ts` (`eq` is JSON equality: key-order sensitive, blind to `undefined`), and the
   synthrun, storage-engine, version-store and bridge `ok()` helpers. This breaks the CLAUDE.md "Test
   assertions" rule, and synthrun carries 64 `eslint-disable sonarjs/assertions-in-tests` lines
   because of it.

## Worst offenders

This list covers every slice. The slice report has the full reasoning and rewrite for each item.

| # | Where | Verdict | Why |
|---|---|---|---|
| 1 | `launcher/test/prompt-flow-wiring.suite.ts:319-884` | REWRITE | 30 source greps (~500 lines) over `LauncherRoot`, including call-site counts. Replace with rendered `LauncherRoot` tests: consent gating per entry point, journal/record deletion, reattach. |
| 2 | `launcher/test/bundle-error-watchdog.suite.ts` | REWRITE | 100% source grep, but the recovery behavior is real. Render `MiniAppView`, drive WebView `onMessage`/`onLoadEnd`. |
| 3 | `checks/test/harness.ts` | REWRITE | The greenBy scheduler is dead since chains B–E merged, and it fails open: a stale untracked `checks/test/.phase` demotes ~50 failing tests to PENDING with exit 0. Replace with a plain test/report. |
| 4 | `deploy-config.suite.ts` (~50 planted weakenings, 4 permanent script mutants at 1076-1090, 1224-1247, 1306-1317, 1479-1504) | DELETE / MERGE | Red-checks in the gate. They cost real seconds, leave a sampler process behind, and crash the suite on reformat. Keep one negative control per checker. The hardening lints themselves stay. |
| 5 | `server/test/contract.suite.ts:37-339` | REWRITE | ~55 zod restatements. Keep ~10 invariant checks. L276-284 ("exactly one terminal") runs on a hand-written array: DELETE. |
| 6 | `server/test/e2e.ts:804-922` + `server/src/generation/reconcile.ts` | DELETE both | The test is the only importer of `reconcile.ts`, which is dead production code; resolver.suite covers the logic. |
| 7 | `server/test/server-core.suite.ts:95-138, 220-326, 450-534` | DELETE | Dev-stub event-order pins, tautological "never echoes" checks, a patched global `setTimeout` plus a fixed 300 ms sleep. All covered more strongly in routes-generate, wire-v2 and disconnect. |
| 8 | `synthrun/test/acceptance.ts:576-598` (forged verdict) | REWRITE | Vacuous (confirmed). It forges `contained:true` on an app that really is contained. Forge `false` instead and assert the verdict stays `true`. |
| 9 | `checks/test/acceptance.ts:228-236` | REWRITE | `eval`, `Function`, `document`, `window`, `self`, `top`, `parent`, `frames` are covered only by table membership. No test feeds a mini-app using one and asserts `forbidden_global`. Containment gap. |
| 10 | `launcher/test/consent-screen-actions.suite.ts` | DELETE | Tautology (confirmed). It checks the table's own `grants` flag, which `ConsentScreen.tsx` never reads; handlers are chosen by action name at `:81-83`. The rendered `screen-controls:60-71` already covers the behavior. |
| 11 | `launcher/test/consent-flow.suite.ts` | REWRITE | 15 generated tests of a one-line ternary. They miss the real bug: an entry point that bypasses the consent gate. |
| 12 | `checks/test/release/ios-project.suite.ts:249-356, 460-526` | DELETE | Greps Swift for 13 exact fragments to test `checkIosSceneLifecycleWiring`, which the release CLI never calls. |
| 13 | `checks/test/release/native-network-deny.suite.ts` | REWRITE | A 400-line Kotlin/ObjC lexer inside the test that pins local names. It is the only automated guard for native network deny, so rewrite it; don't delete. Its 17 mutation tests become a table. |
| 14 | `evals/test/tier-b.test.ts:132-144` + `fixtures/synthetic-run-report.json:14-18` | REWRITE | Locks in the storage-roundtrip bug (see Bugs). Record the fixture from a real synthrun report. |
| 15 | `launcher/test/theme.suite.ts`, `tile-colour.suite.ts:160-292`, `orb-menu.suite.ts:104-196`, `src/sdk/test/theme.acceptance.ts:91-99, 146-193` | DELETE | Palette tautologies, pixel/style pins, greps for features never built, and design constants copied from the design doc. Keep only the emoji check, moved to `checks/`. |
| 16 | `server/test/admin.suite.ts:144-200` | REWRITE | "Read while writing" can't fail because the SQLite store calls are synchronous. Hold an uncommitted write transaction on a raw connection while the CLI reads. |
| 17 | `storage-engine/test/acceptance.ts:796-819` | REWRITE | A source grep for the ID regex stands in for a missing behavioral test. Open an artifact whose collection, field or tombstone ID carries an injection. |
| 18 | `launcher/test/boot-state.suite.ts:147-219` | REWRITE | Greps minified generated runtime HTML. Touches paint-frame trust, so rewrite it as a rendered `useMiniAppHost` test, don't delete. |
| 19 | `src/host/logging/test/logging.suite.ts:182-203, 448-455, 465-477, 509-526, 528-552` | DELETE / REWRITE | Greps of a finished migration and of the protected eslint config, which the gate's config tripwire already guards. L528-552 is a JSX regex this PR had to edit; rewrite it as a render test. |
| 20 | `evals/test/cli.test.ts:471-541` | DELETE | Greps `gate.sh`, tests a harness obligation applied long ago, and fails if the shell exports `WHIM_EVAL_SET`. |

## Bugs and gaps the audit found

These are problems in the product or the harness, not test waste. Each should be fixed or
deliberately closed.

**Confirmed by hand**

- **Eval storage-roundtrip can never pass on a real run.** `evals/assertions.ts:111-120` defaults to
  looking for `storage.set`/`storage.get`. The SDK sends `storage.kv.set`/`storage.kv.get`
  (`src/sdk/index.tsx:199,204`), and `evals/adapters/synthetic-run.ts:34` records those real method
  names. The eight storage-roundtrip assertions in `evals/sets/visible/manifest.json:30-100` always
  fail.
- **`server/src/generation/reconcile.ts` is dead production code.** Its only importer is
  `server/test/e2e.ts`, which is why knip doesn't flag it.
- **The synthrun forged-verdict test is vacuous.** See #8 above.
- **`consent-screen-actions.ts`: the table and the UI can disagree silently.** `ConsentScreen.tsx`
  never reads `grants`, and `hasNonGrantingExit` has no production caller.
- **The launcher Node suite can render RN.** `src/host/launcher/test/run.mjs:30-34` aliases
  `react-native`, `react-native-safe-area-context` and `react-native-webview` to `test/native-host.tsx`.

**Reported by an auditor, not re-checked by hand**

- `checks/test/harness.ts:40-51`: a stale `checks/test/.phase` silently demotes failing tests to
  PENDING with exit 0.
- `checks/test/release/store-listing.suite.ts:144-147`: the "listing never contains the release domain"
  rule runs against the fixture domain (`example.com`) in the gate.
- `launcher/native-host.tsx:17` renders `WebView` as a plain host component, so
  `useMiniAppHost.ts:175` `injectJavaScript` is a silent no-op in every rendered `MiniAppView` test.
  Those tests prove navigation, not bundle delivery. Fix with a WebView shim that exposes
  `injectJavaScript` via `forwardRef`.
- Data and consent paths locked only by source greps: a behind-tip rebuild forks with
  `shareData: true` (the build-lifecycle fakes ignore fork options); fork share-vs-fresh threading
  (`fork-question-ui`); consent gating of every entry point.
- `launcher/build-lifecycle.ts:268` `HINT_SEPARATOR = '\n'`: a multi-line server hint shows as one row
  live but two rows after it's reloaded from storage.
- Storage engine: a corrupt `_meta` row makes `open()` fall back to `emptyApplied()`. On a database
  whose tables exist, the planned `CREATE TABLE` has no `IF NOT EXISTS`, so `open()` likely fails with
  a raw SQLite error, and the burned-ID floor is lost either way. Only the empty-table case is tested.
- Bridge: `diag.echo`, a latency-probe capability, is in the production default registry
  (`src/host/bridge/rows.ts:148-160`). Any app that declares `diag` gets a host echo. Harmless, but
  it's a probe capability shipping to users.
- Contract: the wire `failure` event (`contract/src/index.ts:270`) carries only prose, so the device
  and the tests tell budget, expiry and unverified-run failures apart only by string matching.
- `server/src/usage-store.ts:310` `InMemoryUsageStore` and
  `scripts/release/lib/ios-project.ts:603-655` `checkIosSceneLifecycleWiring` are exported product
  code that only tests use.
- Gate wiring: `scripts/netdeny/test/canary.test.mjs` runs in no gate, and the reason it gives is
  wrong, since gate.sh already runs `node scripts/test/*.mjs` directly. The run-stage containment
  adapter tests (`server/test/e2e.ts:114-254`) need no browser but run only in gate-full; they belong
  in the fast gate. `server/src/main.ts` is esbuild-bundled three times per gate run. `deploy/lib.sh`'s
  retry path adds ~15 s of real sleep per run. Release suites run inside `checks:test`, so a release
  lint failure shows up as "static-checks".
- Suites that run by accident: `settings-screen.suite.tsx` and `screen-controls.suite.tsx` run only
  because `settings-probe` and `screen-exits` call them. `disconnect.suite.ts` imports its doubles
  from `routes-generate.suite.ts`.
- The agent control plane: `.claude/settings.json` wires only `SubagentStop`, so `bash-policy.sh` and
  `protect-harness.sh` run only under Codex. CLAUDE.md still says protect-harness hard-blocks
  subagents. (This matches the `whim-harness-hooks-off` memory: hooks off since 2026-07-30.)
- Stale docs and comments: `server/test/SPEC.md` (claims the suite implements "exactly these
  assertions"), `src/host/launcher/test/acceptance.spec.md` (floating exit button, fork data
  semantics), `invariants/sandbox-isolation/README.md` (says 7 checks, now 9; documents dead
  `reference/`), and the "not yet wired to npm run" headers in `synthrun/test/run.mjs` and
  `evals/test/run.mjs`. ~18 launcher module docs say "RN-free: must load under the Node suite", a
  constraint that no longer exists. `checks/test/acceptance.ts:174-176` claims a typecheck that never
  runs because `tsconfig.json` excludes `checks/test`. The `loadDeployDefaults` doc in
  `scripts/release/lib/domain-lockstep.ts` says the suite never calls it, but it does.

## Verification status

> **The DELETE verdicts were re-checked after this section was written. See
> [verification.md](verification.md):** 8 of ~27 high-risk DELETEs were wrong and are now marked inline in
> the slice reports (four deploy-config lints, the version-store data-handle refusal, the engine
> verb-time kinds, `testRecordAssembly`, the forged sysret). Two more are safe only after another change
> lands. The table below is the first round of spot checks.

Treat every finding in the slice reports as a claim with a citation, not a result. These were
checked by hand against the code:

| Claim | Result | How |
|---|---|---|
| `contract.suite.ts:276-284` runs on a hand-written array | Confirmed | Read L270-290 |
| `reconcile.ts` has no production importer | Confirmed | `grep` for importers: only `server/test/e2e.ts` |
| synthrun forged-verdict test is vacuous | Confirmed | Read L576-598; the test's own comment says every run has a rejection from `probes.js` T6b |
| eval storage-roundtrip method mismatch | Confirmed | `evals/assertions.ts`, `src/sdk/index.tsx:199,204`, `evals/adapters/synthetic-run.ts:34` |
| `deploy-config` sleep-5 mutant runs in the gate | Confirmed | Read L1224-1247; 41 `red:` labels in the file |
| `consent-screen-actions` is a tautology | Confirmed | `ConsentScreen.tsx` never reads `grants` |
| Launcher Node suite renders RN | Confirmed | `src/host/launcher/test/run.mjs:30-34` |
| `invariants/.../bridge/runner.mjs:179-198` forged sysret is vacuous | **Refuted by mutation run** | See below |

### Forged sysret: settled by a mutation run (owner-only)

The core auditor called this invariant check vacuous: the forged replies would resolve only the
`set` call, whose result is discarded. That claim is **wrong**. On 2026-09-21 the `ev.source` guard at
`src/runtime/web/syscall.js:78` was commented out (with the owner's permission), the runtime was
rebuilt, and `npm run bridge:invariants` was run:

```
FAIL forged sysret is inert (host answer wins): resolved value="ATTACKER" (want "REAL", not "ATTACKER")
❌ 1 capability-bridge invariant regression(s).
```

The guard was then restored and the runtime rebuilt. The tree matches the committed generated files,
and all 10 checks pass again.

It works like this. Ids come from a per-realm `seq`, and the forged frames for ids 1–8 are queued as
tasks before `set` runs. Without the guard, a forged frame resolves `set`. The `await` continuation
runs in the microtask checkpoint and registers `get` under the next id, and the next queued forged
frame resolves `get` with `ATTACKER`. So the check is live, but **fragile**: it depends on the
water-counter fixture having made fewer than ~7 syscalls before the probe. **KEEP-FIX:** forge across
a wide id range, or read the current `seq`, so a fixture change can't silently make it vacuous.

**New finding from the same run:** `INV-CUEGATE undeclared` (`bridge/runner.mjs`, around L240) still
reported `forged-sysret-inert=true` with the guard removed, so that sub-assertion does not discriminate
the guard it names. Rename it to what it actually proves, or drop it. The standalone "forged sysret is
inert" check is the one that covers `ev.source`.

To re-run the mutation check:

```sh
cd /Users/davrondjabborov/Work/other/Whim
sed -i '' 's|    if (ev.source !== globalThis.parent) return;|    // MUTANT: guard removed|' src/runtime/web/syscall.js
npm run build && npm run bridge:invariants 2>&1 | tail -30
git checkout -- src/runtime/web/syscall.js && npm run build   # always restore
```

Also owner-only, from `core.md`: `run-against-build.mjs:205-222` (T7) passes even if the
re-injection never happens. It has not been mutation-checked yet; the same approach settles it.

## `invariants/` spike leftovers (owner-only)

No runner executes any of these. The `invariants:spike2` script was retired 2026-06-18, and the
production copies live in `build/assemble.mjs` and `src/runtime/web/*`. Git history keeps them all.

- `invariants/sandbox-isolation/reference/`: `bundle.js`, `sdk.js`, `runner.js`, `neutralize.js`,
  `probes.js` (Spike-1 sources), `demo.html` (749-line desktop demo), `spike1-android-result.png`.
- `invariants/sandbox-isolation/sandbox-isolation-probe.html`: a manual Spike-1 page. Its message
  listener has no source check (critic G9).
- `invariants/sandbox-isolation/spike2-bundle-contract/`, the whole folder: 5 `pages/*.html` (~3.2 MB
  with React inlined), the orphaned `runner.mjs` + `package.json` + `package-lock.json` (plus an
  untracked Playwright copy in its `node_modules`), `reference/{probes,neutralize}.js`, 4
  `reference/fixtures/*.app.tsx` (superseded by `fixtures/adversarial/*`), and its `README.md`.

Before deleting, update the live references: `invariants/sandbox-isolation/README.md`,
`docs/spike2-findings.md`, `openspec/config.yaml`, and the provenance comments in
`src/runtime/web/neutralize.js` and `probes.js`. `docs/decisions.md` is append-only, so leave its
mentions as history.

## Suggested order of work

0. **Read [verification.md](verification.md) first.** It lists the verdicts that were overturned or
   are conditional, and the two questions to ask before acting on any unchecked DELETE.
1. **Fix the real bugs first**: the eval storage-roundtrip name, the fail-open greenBy harness, the
   `store-listing` domain, and the two exit-13 hang risks. These are small and change what the gate
   actually proves.
2. **Close the containment and data gaps**: forged verdict (#8), forbidden globals (#9), the forged
   sysret robustness fix and the vacuous `INV-CUEGATE` sub-assertion, the WebView `injectJavaScript` shim, and the grep-only fork and consent paths.
   These need new tests, and each one must fail against the plausible weaker implementation.
3. **Delete** the pure-DELETE items per slice, along with the dead production code they keep alive
   (`reconcile.ts`, `InMemoryUsageStore`, `checkIosSceneLifecycleWiring`, `hasNonGrantingExit`).
   The gate staying green is the check. Deleting a test needs no replacement test.
4. **Rewrite** the source-grep families into rendered launcher tests, and turn the mutation families
   into tables.
5. **Move** the ~10 legitimate standing-invariant greps into lint or `checks/` passes, and switch the
   custom assertion helpers to `node:assert`.
6. **The `invariants/` items** (owner).

Each slice report's per-file sections can feed `/fix-loop` directly. Deletions and rewrites are
different changes: keep them in separate batches so a reviewer can tell "removed coverage" from
"moved coverage".
