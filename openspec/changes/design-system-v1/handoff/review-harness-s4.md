# Review: harness-s4 (Opus high, shift 4) — REJECT (HIGH)

- HIGH scripts/lib/only-filter.mjs:71, :91-104: a filtered run can execute nothing and exit 0. `visit()` filters
  `test('title')` calls inside entry-declared suite functions by title: (a) suite call kept but body emptied
  (`--only StorageSurfaceScanner` on checks/test/acceptance.ts keeps `await testStorageSurfaceScanner()`, its 7 tests
  become `;`; same for `--only observers` / `--only capability-wiring` on synthrun/test/acceptance.ts); (b) titles
  kept but the suite call dropped (`--only imports|screens|capabilities` match titles inside testImportAllowlist /
  testScreenGraph / testCapabilityDirections; their calls don't match → removed; `kept` non-empty so requireMatched
  passes). checks/test/harness.ts:64 exits 0 when fail === 0. Fixture `testSweepReach() {}` is empty so the suite
  can't see it. Fixed: (1) a kept local-suite call runs its whole body; a title match inside a local suite keeps the
  enclosing call (decide at the call, don't filter titles inside suite-named FunctionDeclarations); (2) runtime
  backstop: with --only set, the run FAILS if 0 tests ran (env flag from the runner; report checks pass+fail > 0);
  (3) fixture cases for (a) and (b), red-checked against the current code.
- MEDIUM scripts/test/fixloop-preflight.test.sh:84: contains() is correct and not looser (old grep was -qiF too;
  nocasematch restored), but #238's red isn't reproduced; the ancestor case's small hay can't plausibly SIGPIPE →
  runner runs the spinner repro on BASE; if BASE never fails, #238 stays open for the ancestor/"Permission denied" cases.
- LOW :24 load `typescript` lazily inside filterSource (bare gate runs pay the load now).
- LOW :120 compare fs.realpathSync of args.path and entry (symlinked checkout fails closed).
- LOW checks/test/repo/only-filter.suite.ts:78-89 depends on bridge suite titles (§G4, §G5, §A duplicate
  registration, §G8): add a comment at those titles.
- LOW CLAUDE.md:52 "matches a suite file or a test title" is untrue for sdk:test (file names only).
Verified clean: bare runs unchanged (filter null, plugins []), no-match exits 1, --only without value exits 2, no
CONFIG_SET touch, CLAUDE.md one line; #230 ACCEPT (role on the same touch div; both directions tested).
