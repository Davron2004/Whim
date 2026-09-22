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
| Forbidden globals: behavioural tests (`checks` acceptance) | done, red-check pending | c7fac29 | Every name bare and through every root, every root read directly, a shadowing parameter per name. Expected names written in the test. Red-check against weaker checkers needs your permission (security guard) |
| synthrun forged verdict forges `false` | done, red-check pending | 7645e27 | Verdict must stay contained; tally exactly clean-baseline + 1. Red-check needs the outer page's nonce check disabled (permission) |
| Forged-sysret check robust to fixture history | done, red-check pending | 71269e1 | `get` issued first, forgeries for ids 1..1000. Red-check needs the `ev.source` guard removed (permission) |
| `INV-CUEGATE` forged-sysret sub-assertion | done | 71269e1 | Dropped: it matched the fixture's own "posted to self" text (audit mutation run 1) |
| WebView shim exposing `injectJavaScript` + delivery test | done | a4f7c7d | Red-checked: a host that never injects fails it; the existing rendered tests stayed green under that mutant |
| Fork `shareData` (build-lifecycle fake + rendered fork question) | done | 5f4c35b | Red-checked against three weaker variants: Home sends true for "Start fresh", root drops the options, rebuild forks fresh |
| Rendered consent gate for every entry point | done, red-check pending | f6d2fd7 | 5 entry points x {no grant, outdated grant} + device header after agreeing + decline from a running app. Red-check needs each entry point bypassing the gate (permission) |

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
| Conditional: prompt-flow-wiring consent grep + retired flow (L857-884) | waiting | - | Rendered consent tests landed (f6d2fd7); deleting after their red-check |

Fast gate after batch 3: PASSED.

## Not in any batch (README "Bugs and gaps")

| Item | Status | Reason |
|---|---|---|
| `HINT_SEPARATOR = '\n'` splits a multi-line hint after reload | parked | Product change, not in the requested batches |
| Storage engine: corrupt `_meta` falls back to `emptyApplied()` | parked | Product change, not in the requested batches |
| `diag.echo` in the production default registry | parked | Product decision, not in the requested batches |
| Wire `failure` event carries only prose | parked | Contract change, not in the requested batches |
| Control-plane hooks wired only under Codex; CLAUDE.md says otherwise | parked | Harness decision (memory `whim-harness-hooks-off`), not in the requested batches |
