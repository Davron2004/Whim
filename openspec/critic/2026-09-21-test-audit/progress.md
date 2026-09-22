# Carrying out the audit: progress

One line per item: status (done / skipped / overturned / parked), commit, reason. Branch
`integration/store-launch`. Batches follow the order in the task: 1 bugs, 2 containment and data
gaps, 3 deletions, 4 rewrites and merges, 5 moves to lint/`checks/` and `node:assert`, 6
`invariants/` leftovers. New problems found on the way are in [follow-ups.md](follow-ups.md).

## Batch 1: real bugs

| Item | Status | Commit | Note |
|---|---|---|---|
| Eval storage-roundtrip method names (`evals/assertions.ts`) | done | 8a3b99e | Round trip = write + read on one store (kv or records). The new tier-b rows failed against the old evaluator (3 failures), then passed |
| Eval fixture from a real synthrun report | done | 8a3b99e | `synthetic-run-report.json` is a real run of `fixtures/water-counter.app.tsx`. It has only kv calls because of the sysret bug in follow-ups.md. `tier-a`'s adapter test lost its cue entry with it |
| greenBy harness fails open on a stale `.phase` | done | 7b960c0 | Confirmed first: `.phase`=B plus a planted failure gave `PENDING 1 · FAIL 0`, exit 0. After: same plant exits 1. 50 tags, name prefixes, 3 self-tests, and every `.phase`/XPASS instruction removed |
| store-listing domain rule ran against `example.com` | done | efa1c0c | Confirmed first: `anycognition.ca` appended to a listing file passed. After: the same plant fails |
| `policy.suite.ts:113` exit-13 hang | done | 55d3c0c | Confirmed: a policy that ignores its timeout gave exit 13. After: named failure |
| `history-wait.suite.ts:64` exit-13 hang | done | 55d3c0c | Confirmed: a never-settling `runHistoryLoad` gave exit 13. After: named failures |

Fast gate after batch 1: PASSED.

## Batch 2: containment and data gaps

| Item | Status | Commit | Note |
|---|---|---|---|
| Forbidden globals: behavioural tests (`checks` acceptance) | done | c7fac29 | Every name bare and through every root, every root read directly, a shadowing parameter per name. Red-checked (with permission): `Worker` dropped, `frames` dropped, and token matching each fail it; the old table test would have passed the first |
| synthrun forged verdict forges `false` | done | 7645e27 | Red-checked (with permission): outer page tallies the forgery but falls through to process it (missing `return`) → "the forged breach verdict was not adopted (state.contained = false)" |
| Forged-sysret check robust to fixture history | done | 71269e1 | Red-checked (with permission): guard removed + 20 syscalls before the probe → new check fails (`ATTACKER`), old check passes and the suite exits 0 |
| `INV-CUEGATE` forged-sysret sub-assertion | done | 71269e1 | Dropped: it matched the fixture's own "posted to self" text (audit mutation run 1) |
| WebView shim exposing `injectJavaScript` + delivery test | done | a4f7c7d | Red-checked: a host that never injects fails it; the existing rendered tests stayed green under that mutant |
| Fork `shareData` (build-lifecycle fake + rendered fork question) | done | 5f4c35b | Red-checked against three weaker variants: Home sends true for "Start fresh", root drops the options, rebuild forks fresh |
| Rendered consent gate for every entry point | done | f6d2fd7 | Red-checked (with permission): each of the 5 entry points calling its continuation without the gate fails the suite |

Fast gate after batch 2: PASSED.

## Batch 3: deletions

| Item | Status | Commit | Note |
|---|---|---|---|
| Server DELETE verdicts (contract, server-core, wire-v2, prompts, policy, routes-unary, admission, e2e, deploy-config, metering, loadtest, config, admin, logging, web-site, machine, openrouter, resolver, reports, prod-build) | done | 5b8cb5b | 1,863 lines. Column-pin cover proven by mutation: prompt written into usage.db fails the marker scan |
| `reconcile.ts` + `e2e.ts` testReconciliation, `server/test/SPEC.md`, model fixtures, `noNetworkTransport` | done | 5b8cb5b | |
| `InMemoryUsageStore` | overturned | - | Not kept alive by DELETE tests: 9 suites' kept tests use it as their store fake, and it shares 5 private helpers with the SQLite store. Moving it would add test-only exports; replacing it is a rewrite |
| deploy-config "standard must not override server limits" | overturned (kept) | 5b8cb5b | A rule, not a pinned value. The machine-type and 15/6/32 pins went |
| web-site "privacy.html names OpenRouter" | overturned -> REWRITE | - | Weak (phrase pin), not impossible to fail. Batch 4 |
| resolver mislabelled unresolved-count check | overturned -> relabelled | 5b8cb5b | Its assertion is real; only the tautology beside it went |
| metering "credit before terminal" | done (deleted), gap recorded | 5b8cb5b | Vacuous as written; no test checks the ordering anywhere. The real test goes to batch 4 |
| Tooling DELETE verdicts (checks acceptance, evals, release suites, hostile corpus, unroll.test.sh) | done | 0b117e4 | 823 lines |
| `checkIosSceneLifecycleWiring` + 5 tests + Swift fixtures | done | 0b117e4 | |
| domain-lockstep pure-function tests | overturned in part | 0b117e4 | One mismatch case per checker kept (one negative control per checker); matching cases deleted |
| Core DELETE verdicts (synthrun, logging, storage-engine, vstore, bridge, SDK, isolation, bridge runner stale-gen) | done | 5908fbf | 583 lines |
| Launcher DELETE verdicts | done | 4405308 | 1,026 lines, incl. 3 whole suites and `hasNonGrantingExit` |
| prompt-flow-wiring highlighting-provider grep (L809-812) | overturned -> REWRITE | - | Only check that the settings switch reaches the tree; no cover. Batch 4 |
| xhr-transport "non-ApiError body leaves code absent" (inside L493-520) | kept | - | Not a Retry-After case; the audit range overshot |
| run-timeline "details reads the journal on open" / "back closes the sheet" | kept for batch 4 | - | Replaced in the same commit as their rendered versions |
| Conditional: prompt-flow-wiring delivery routing (L498-512) | done | e9253cf | shareData moved in 5f4c35b |
| Conditional: prompt-flow-wiring consent grep + retired flow (L857-884) | done | e518419 | After the consent red-checks. Same commit removes consent-flow, consent-options and fork-question-ui suites and the entry-point greps (coverage moved in batch 2) |

Fast gate after batch 3: PASSED.

## Batch 4: rewrites and merges

Fanned out to three agents in worktrees (launcher on Opus 5; server and tooling+core on Sonnet 5); their items are recorded below as they merge. Done in the main tree:

| Item | Status | Commit | Note |
|---|---|---|---|
| Bridge runner: water-counter, undeclared-capability, sql-injector judged host-side | done | 75e317a | Host shim records sysrets and lists tables |
| Bridge runner: stub-authority negative control | done | 75e317a | A planted `kv._h.engine` must be found |
| Bridge runner: `exposeBinding` + main-frame guard; bounded settle | done | 75e317a | |
| Boot-state: built outer page forwards paint as trusted (launcher.md, owner item) | done | 75e317a | New bridge check |
| run-against-build: T4 probes line only; A1 waits on the generation | done | 999f9fa | |
| run-against-build: T7 same-realm re-injection | done (removed) | 999f9fa | A strict version is impossible: probes run once per realm, so there is no gen-2 verdict |
| bash-policy.test.sh smuggling rows merged; L40 named | done | 63763b6 | 15 rows removed, 63 pass |

Merged from the tooling+core agent (18 commits, 0916a78..95dd91e, cherry-picked):

| Item | Status | Commit | Note |
|---|---|---|---|
| checks: verb-time kinds from the engine (`STORAGE_ERROR_KINDS`), raw-timer test over all three timers, nav table, `assertAllWellFormed` on every report, latency-probe case in the hostile corpus, static vs bridge `undeclared_capability` constant | done | see "test(checks): rewrite constant-pin tests" | Red-checked: kind dropped from DIAGNOSTIC_KINDS; bridge constant renamed |
| native-network-deny mutation tests as a table; exact-message rule dropped | done | "test(release): table-drive native-network-deny" | |
| native-network-deny lexer rewrite to invariant tokens | parked | - | See follow-ups.md: only guard of native network deny, no independent way to validate a new lexer |
| ios-project, android-project tables; release-cli, hermes-entry merges; native-config pins; assets constant | done | "test(release): …" (4 commits) | |
| evals: tier-b kind coverage table; report.test negative control | done | "test(evals): …" (2 commits) | |
| evals: tier-a case-verdict table | done (orchestrator) | "test(evals): table the case verdict" | The agent judged it already fine; it wasn't (constants vs own literals, no failed-A/passing-B row). Red-checked: ignoring Tier A fails the new row |
| netdeny canary: variants from source, SIGINT instead of --seconds | done | "test(netdeny): …" | Gate wiring pending (gate.sh, orchestrator) |
| fixloop-preflight text pins; sonar-pr-issues merges | done | "test(scripts): …" (2 commits) | |
| synthrun: determinism, 9 fixed sleeps, awaitQuiet race, forgery count, date hint; probeEgressBlocked red direction; launch-site pin | done | "test(synthrun): …" (2 commits) | synthrun 313 checks pass |
| logging: sensitive-field list in the test, LEVELS pins, flush poll | done | "test(logging): …" | |
| storage-engine §F injection tests (collection, field, tombstone id), §C/§D merges | done | "test(storage-engine): …" | Security red-check pending (identifier validation) |
| version-store §2.3 specific error; §4.2/§6.1/unborn-HEAD/§C8/assertNoGitLeak merges | done | "test(version-store): …" | Red-checked: `dataStore` dropped from the refusal list |
| bridge §A verb list; §C latch | done | "test(bridge): …" | |
| sdk appColor sweep merge; List renders its children | done | "test(sdk): …" | Red-checked: List rendering nothing |

Merged from the launcher agent (it could not commit; applied as a patch in three commits):

| Item | Status | Commit | Note |
|---|---|---|---|
| prompt-flow-wiring greps → prompt-flow-ui + attempt-lifecycle-ui (approve order, leave/abort, rewrite context, refusal landing, token text, leave-it-running + Details sheet, demotion, reattach, hydration, Discard, concurrency, journal) | done | 84360dc | Replaces refusal-target.suite and run-timeline's journal/back greps. ~30 red-checks, two regressions the greps missed |
| logging.suite screen-boundary grep → rendered | done | 84360dc | |
| highlighting provider grep (overturned DELETE) → rendered | done | 84360dc | |
| bundle-error-watchdog, realm-delivery, launch-failure-ui, boot-state paint trust, unmount-teardown → mini-app-host-ui | done | d5bdc36 | Three suites deleted. Paint-trust security red-check pending |
| grid, tile colour, flow screens, orb, report sheet, app-busy, history, observability, WhimProse, failure screen, settings-sections | done | d5bdc36 | |
| product-verbs FORBIDDEN gains schema/database/storage/clone | done, `link` overturned | d5bdc36 | "App link" is product copy |
| Retry-After table, scheme-host/link-routing/app-link tables, contract-arm list, run-journal/store-access merges, xhr backstop, acceptance.ts wiring, deliver-by-source wait, stale spec checklists | done | bdea0ec | |
| generation-client timing (low priority); moving whim-prose to src/host/ui; deliver-by-source bootstrap into invariants | skipped | - | Low value or owner-only |
| whim-prose "never faded/typed in" grep | dropped | 84360dc | The native shim can't observe animation |

Also in the main tree: frameEdgesFor's 13 generated tests (a batch 3 DELETE the name-based pass missed) deleted in 95fa013; the netdeny canary test wired into the fast gate in dd54505 (about 2 s, no browser).

## Batch 5: lint and checks/ moves, node:assert

| Item | Status | Commit | Note |
|---|---|---|---|
| Console only through the logging seam (logging.suite grep) | done → ESLint `no-console` | 75894a1 | src/host minus the seam and the six probe surfaces |
| @whim/contract type-only in device code (logging.suite grep) | done → `@typescript-eslint/no-restricted-imports` | 75894a1 | Now covers every contract import, not four DevLog names |
| Direct BackHandler only in the two adapters (screen-exits grep) | done → `no-restricted-properties` | 75894a1 | Now all of src/host |
| Bare `__DEV__` (observability-ui grep) | done → `no-restricted-syntax` | 75894a1 | Now all launcher source, not only LauncherRoot |
| vc-sdk never imports whim-prose (whim-prose grep) | done → `no-restricted-imports` | 75894a1 | The "stays pure for Node" half dropped: the runner renders RN now |
| Emoji text presentation (theme.suite) | done → checks/test/repo/source-scans.suite.ts | 75894a1 | Red-checked with a planted glyph |
| Release-domain literal (release-config.suite) | done → checks/test/repo/source-scans.suite.ts | 75894a1 | Red-checked with a planted domain |
| Each lint rule red-checked on a planted violation and an allowed form | done | 75894a1 | |
| Launcher, evals, synthrun, storage-engine, version-store, bridge helpers → node:assert | done | 083143f | eq is deepStrictEqual; every suite passed unchanged; a planted false assertion fails each |
| synthrun's 60 `sonarjs/assertions-in-tests` disables | done (removed) | 083143f | Local `ok` wrappers: the ESLint rule follows a helper within its file, not across an import |
| evals `sonarjs/no-empty-test-file` suppressions | kept (audit premise wrong) | - | That rule wants test-framework calls, not assertions; it still fires |
| server/test/harness.ts → node:assert | waiting | - | After the server agent's work merges |

## Batch 6: invariants/ spike leftovers

| Item | Status | Commit | Note |
|---|---|---|---|
| reference/, sandbox-isolation-probe.html, spike2-bundle-contract/ | done | ea8a9d2 | 2,929 lines + ~3.2 MB of pages; references updated; knip ignore dropped |

## Not in any batch (README "Bugs and gaps")

| Item | Status | Reason |
|---|---|---|
| `HINT_SEPARATOR = '\n'` splits a multi-line hint after reload | parked | Product change, not in the requested batches |
| Storage engine: corrupt `_meta` falls back to `emptyApplied()` | parked | Product change, not in the requested batches |
| `diag.echo` in the production default registry | parked | Product decision, not in the requested batches |
| Wire `failure` event carries only prose | parked | Contract change, not in the requested batches |
| Control-plane hooks wired only under Codex; CLAUDE.md says otherwise | parked | Harness decision (memory `whim-harness-hooks-off`), not in the requested batches |
