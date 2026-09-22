# Test audit: server-ops slice

Slice: `server/test/{machine,deploy-config,ledger,resolver,openrouter,prod-build,loadtest,web-site,logging,metering,admin,config,reports}.suite.ts` plus `server/test/log-capture.ts`. PR status comes from `git diff --numstat main...HEAD`.

Short version: most of this slice earns its place. The money tests (ledger, resolver, machine credit/deadline, route-level cost) are behavioral, run against real SQLite, and mostly discriminate. Almost all of the bloat falls into four groups:

1. Mutant red-checks and planted weakenings baked permanently into deploy-config and loadtest.
2. Old metering tests duplicated by stronger route-level tests.
3. Literal pins on defaults and copy.
4. Weak config greps.

I don't agree with the prior pass's "avoid deleting deploy-config by size". Size isn't the problem there. The bulk of that file (hardening lints, script behavior under stubs) is legitimate, and the deletions below target specific artifacts, not volume.

## 1. Totals

| Class | Files | Test lines | Est. DELETE | Est. REWRITE/MERGE |
|---|---|---|---|---|
| NEW | 9 (deploy-config, ledger, resolver, prod-build, loadtest, web-site, admin, config, reports) | 4,923 | ~430 | ~330 |
| CHANGED | 2 (machine +827/-4, openrouter +88) | 2,430 | ~50 | ~135 |
| OLD | 3 (logging, metering, log-capture) | 640 | ~150 | ~5 |
| **Total** | **14** | **7,993** | **~630 (8%)** | **~470 (6%)** |

In machine.suite.ts, the lines the PR added (L1091-1859: wall-clock budget and provider credit) are almost all KEEP. Its DELETE/MERGE findings are in the pre-PR half.

## 2. Per-file findings (worst first)

### server/test/deploy-config.suite.ts (1825 lines, NEW): REWRITE (trim)

The hardening lints (compose caps and seccomp, Caddy stream safety, Dockerfile pins, secret and sandbox scans, egress firewall rules, profile capacity relations) lock real deployment and containment invariants: the server runs untrusted LLM code in Chromium. The operator-script tests (deploy/smoke/resize/provision/loadtest under PATH stubs) are real behavioral tests at the process boundary. The bloat sits on top of them: permanent mutant runs, ~50 planted weakenings, weak policy greps and literal pins.

- [META][CHANGE-DETECTOR][TIMING] old-sleep mutant (L1224-1247) — DELETE. It rewrites `deploy/lib.sh` (`libText.replace('sleep "$sleep_for"', 'sleep 5')`), asserts a source-text count (`eq('the old-sleep mutant replaces exactly one real sleep', sleepCalls.length, 1)`) and then asserts the mutant is slow (`oldElapsed >= 4_500`). That's a fix-loop red-check left in the gate. It burns more than 5 s of real `sleep` on every run and breaks on any edit to that line of lib.sh. The deadline property is already covered by L1205-1222.
- [META][CHANGE-DETECTOR] red rollback-republish plant (L1076-1090) — DELETE. `plant(...)` replaces a five-line verbatim block of deploy.sh and runs a whole sandboxed deploy to prove the preceding assertion (L1069-1073) can fail. Any reword of that block makes `plant` throw "setup: planted weakening did not apply", which crashes the whole server suite instead of failing one named check.
- [META] nested-sudo mutant (L1306-1317) — DELETE. It edits run.sh and asserts that the old bug still fails. It protects nothing shipped. L1299-1304 is the real test.
- [META][TIMING] single-PID cleanup mutant (L1479-1504) — DELETE. It pins run.sh text (`eq('the single-PID cleanup mutant replaces exactly one process-group kill', …, 1)`), leaves a live sampler process and asserts on heartbeats after `pause(250)`. `driveCase` (L1444-1477) is the behavioral test.
- [META][CHANGE-DETECTOR] per-rule `red:` plants: image L1529-1533 and L1537, compose L1544-1554, caddy L1561-1571, scans L1669-1682, profiles L1722-1733, runbook L1781-1784, IPv6 mutants L1641-1651 — MERGE to one negative control per checker. Each plant also pins the exact formatting of the config it targets. For example, `plant(compose, '    cap_add:\n      - SYS_CHROOT\n', …)` throws if compose moves to flow style. A checker that returns `[]` needs one control, not ten. `firewallProblems` compares an exact rule list (L1625), so its four mutants are redundant with the clean check.
- [SOURCE-GREP] `retentionProblems` (L622-624, L1680) — ~~DELETE~~ **KEEP (overturned 2026-09-21, see verification.md)**. It flags any file containing `RETENTION_DAYS`. It catches no realistic bug; a profile setting retention is already refused by `isForbiddenProfileKey` (L674-676).
- [SOURCE-GREP] `keySettingProblems` (L626-628, L1681-1682) — ~~DELETE~~ **KEEP (overturned 2026-09-21, see verification.md)**. It flags the substrings `'versions add'`, `'--data-file'` and `'addresses create'`, which a rename or variable evades trivially. The real property, that the key is never printed, passed as an argument or uploaded, is asserted behaviorally at L994 and L1055-1056.
- [SOURCE-GREP] `associationWriteProblems` (L608-620, L1678-1679) — ~~DELETE~~ **KEEP (overturned 2026-09-21, see verification.md)**. It greps for `applinks`/`assetlinks`/`.well-known` redirects in shell. The "association files come only from release tooling" rule is exercised behaviorally in web-site.suite.ts:319-379 (`buildSite` with runner success, failure and wrong file set), and Caddy serving is locked by `pagesRouteProblems`.
- [SOURCE-GREP][RED-GREEN-ARTIFACT] `hostnameProblems` (L591-602, L1673-1675) — ~~DELETE~~ **KEEP-FIX (overturned 2026-09-21, see verification.md)**. It greps for two literal hostnames (`anycognition.ca`, `sslip.io`). The `sslip.io` rule is a leftover from the pre-DNS setup, and any other hostname passes.
- [CHANGE-DETECTOR] `valuesTests` example-file pins (L1699-1706) — DELETE. `eq('deploy/operator.env.example lists the operator value names only', …[5 exact pairs])` breaks on any new operator value. A missing operator value is already refused, by name, before any gcloud call (L927-934). A filled server.env.example is caught by `secretProblems` (L1669).
- [DUPLICATE] `check('deploy.sh has no --profile option', !…includes('--profile'))` (L1734) — DELETE. It duplicates the behavioral test at L920-925.
- [CHANGE-DETECTOR] profile product pins (L699-709) with their reds (L1722-1729) — DELETE. `standard must use e2-standard-2` and `event must provide … 15/6/32` restate the profile files. The event values are pinned again by the exact `config.env`/`compose.env` expectations at L1040-1054. Keep the relational checks: allowed keys, loads, synthrun ≤ vCPUs, synthrun ≤ generation cap, unique machine types.
- [DOC-TRIPWIRE] runbook `requiredGuidance` (L1768-1773, L1781-1782) — DELETE. `'## OpenRouter key'`, `'run.sh drive'` and similar are strings the doc must contain. Keep the drift half (every `WHIM_*` the runbook names is an accepted input, and every `deploy/*.sh` it names parses), which works as a link checker.
- [CHANGE-DETECTOR] `serverRuntimeProblems`/`caddyServiceProblems`/services list (L359-395, L406) — REWRITE. Exact `env_file` array, exact volume strings, `WHIM_DATA_DIR === '/data'` and services "exactly caddy, whim-server" are literal restatements. Assert the invariants instead: `WHIM_DATA_DIR` is the container side of a host-disk volume (the ledger must persist), and `env_file` includes the file that holds the key. Drop the `${WHIM_IMAGE:?}`/shm/mem scalar pins, which `interpolationProblems` already covers.
- [CHANGE-DETECTOR] pages site exact route table, exact CSP string and top-level allowlist (L497, L499-504, L526-528, L552-557) — REWRITE. Assert the properties: CSP has `default-src 'none'` and no script source, the association routes are JSON with no rewrite or redirect, every `file_server` has `disable_canonical_uris`, and the catch-all answers 404. Adding a page shouldn't require editing the test.
- [CHANGE-DETECTOR] Dockerfile `CMD` exact, `EXPOSE` exact, `--only-shell` literal (L175-177, L200-202) — REWRITE. Drop them. The CMD is proven by prod-build.suite.ts:275-298 booting `node server/main.mjs`, and EXPOSE is documentation only.
- [CHANGE-DETECTOR] `cloudbuildProblems` needles (L637-639) — KEEP-FIX. Keep linux/amd64, no secrets and pinned step images. Drop the region and `--file` literals.
- [CHANGE-DETECTOR] full-deploy `compose.env` exact (L1047-1054) — KEEP-FIX. It pins `16g`/`3gb`. Read the expected values from `deploy/profiles/event.env`.
- [CHANGE-DETECTOR] health-poll speed hack (L1346-1348) — KEEP-FIX. `.replace('-lt 60', '-lt 1')` silently no-ops if the loop changes, and the test then times out at 60 s. Make the poll budget an env var.
- [TIMING] `whim_wait_for_ssh` deadline checks (L1189-1222) and resize retry cases (L1152-1170) — KEEP-FIX. The wall-clock bound (`elapsed < 4_500`) is the property being tested, which is acceptable. But lib.sh's fixed `sleep_for=5` makes each retry case sleep 5 s for real. Make the retry sleep injectable.
- Keep: `dockerfileProblems` pins, playwright == lockfile, non-root user, `composeProblems` hardening, `stop_grace_period ≥ drain+30s`, egress subnet parity, `request_body ≥ server cap`, `flush_interval -1`, secret and sandbox scans, `loadtestProblems` (the copy in loadtest.suite goes instead), the IPv6 firewall exact rules, the bootstrap `--proto =https` check, `bash -n` plus pipefail, and every deploy/smoke/resize/provision/loadtest start-and-drive behavioral case.

### server/test/metering.suite.ts (267 lines, OLD): REWRITE (delete ~45%)

- [TAUTOLOGY] "nothing but counter: only numeric fields" (L77-94) — DELETE. It checks `typeof usage.promptTokens === 'number'` and `!('prompt' in usage)` on a typed object built by `read()`, which is true by construction. The comment admits it doesn't inspect the table.
- [CHANGE-DETECTOR][DUPLICATE] usage table exact columns (L96-121) — DELETE. `eq('usage table schema: exact columns', …)` pins the schema. The content-free property is proven behaviorally, with markers pushed through every route and then searched for in usage.db, at routes-generate.suite.ts:1065-1150.
- [DUPLICATE] store "zeros for unknown id" (L123-131) — DELETE. The route-level version at L184-195 is stronger.
- [VACUOUS] "credit before terminal" (L197-211) — DELETE. It reads the store after `drainSse` has consumed the whole stream (`usage.totalTokens > 0`), which is identical to §6.3 (L147-182) and can't observe ordering. A real version would read the store when the `result` frame arrives, before the stream closes.
- [DUPLICATE] missing device header on /v1/usage (L213-220) — DELETE. wire-v2.suite.ts:172-196 iterates every /v1 route.
- [DUPLICATE][TIMING] cancellation does not corrupt metering (L222-266) — DELETE. It sleeps a fixed 50 ms (`setTimeout(r, 50)`). routes-generate.suite.ts:1045-1058 proves "cancelled before any model call credits nothing" without a sleep, and L996-1043 proves delivered and cancelled runs credit exactly once.
- §6.3 readback (L147-182) — KEEP-FIX. `check('readback: totalTokens > 0 …')` would pass on double-crediting. Assert the stub pipeline's exact usage instead.
- Keep: restart durability (L54-75) and per-device scoping (L133-143).

### server/test/loadtest.suite.ts (483 lines, NEW): REWRITE (delete ~23%)

- [TAUTOLOGY][DUPLICATE] `testDeployFilesExcludeLoadtest` grep plus red-check (L316-322) — DELETE. `` `${readRepoFile('deploy/compose.yaml')}\n# loadtest`.toLowerCase().includes('loadtest') `` is always true. The grep duplicates deploy-config.suite.ts:604-606 and L1676.
- [META] poisoned-entry red-check (L254-276) — DELETE. It writes a real esbuild bundle only to prove a `startsWith` filter works. The input list is shown to be non-empty by prod-build.suite.ts:250 (`inputs.includes('contract/src/index.ts')`). Also MERGE L247-252 with prod-build.suite.ts:249-251: both bundle `server/src/main.ts` separately, so fold them into one pass that asserts no `server/test/` and no `server/src/loadtest/` input.
- [DUPLICATE] replay-model plan/generate probes (L156-178) — DELETE, and REWRITE the classifier probe (L180-183). `PLAN_SYSTEM_PROBE` and `CLASSIFIER_SYSTEM_PROBE` are hand-copied prompt sentences. If `prompts/index.ts` or `policy/policy.ts` is reworded, the replay model's marker match breaks in production while this test keeps passing on its own copies. Plan and generate are covered for real by `testMachineOverReplayModel` (L206-230), which uses the real prompts. Build the classifier message with `policy.ts`'s real builder. Keep fixture rotation (L185-196) and the unknown-model throw (L198-201).
- [RED-GREEN-ARTIFACT] `check('the model override is a real ModelClient', typeof overrides.model?.client.stream === 'function')` (L134) — DELETE.
- [META] env_file `!override` red-checks (L330-334) — KEEP one of the two, delete the other. `check('the override exists and touches only whim-server', override.includes('whim-server:'))` (L325) never checks "only". KEEP-FIX by fixing the name or the check.
- Low value, operator-only (L359-377, L425-467) — DELETE. `testPercentile`, `testStatsCsv` and `testParseArgsAndReadPeakStats` cover report formatting and CLI parsing for an operator tool. None of them feed `verdict()` (drive.ts:329-351), and failures show up to the operator as soon as the tool runs.
- Keep: key refusal (L67-85), fetch trap/inert key/zero-cost transports (L99-152, the no-spend guarantee), the production-exclusion metafile check, SSE framing, and the verdict table (L383-423).

### server/test/config.suite.ts (171 lines, NEW): MERGE

- [CHANGE-DETECTOR] 25 default literals (L26-55) — MERGE/DELETE. `check('defaults: server port', defaults.serverPort === 8787)` restates a constant as its own literal. Keep one `deepEqual` over the spend-bounding defaults (per-device and global daily limits, `minCreditUsd`, `generationMaxMs`) plus the drain relation (L50-53). Body caps are cross-checked against Caddy (deploy-config L516), retention against the privacy page (web-site L119-129), and host/port by the prod-build boot.
- [RED-GREEN-ARTIFACT] parse cases for three hand-picked variables (L57-104) — REWRITE as one table over every key `loadServerConfig` reads (discover them with the Proxy recorder at deploy-config.suite.ts:662-672). For each key, garbage must throw a `ServerConfigError` naming it, and a valid non-default value must change the parsed field. That catches the realistic bug (a misspelled env name that's silently ignored) for all ~25 keys instead of 3.
- [TAUTOLOGY] "clock is injectable" and "defaults to Date.now" (L106-111) — DELETE.
- [RED-GREEN-ARTIFACT] `check('config is frozen', Object.isFrozen(...))` (L170) — DELETE.
- Keep: production refusals (L113-168).

### server/test/admin.suite.ts (209 lines, NEW): REWRITE

- [VACUOUS] "reading while the server writes" (L144-200) — REWRITE. Every `NodeSqlite*Store` method is a synchronous `DatabaseSync` body (for example usage-store.ts:505-540), so `Promise.all([writes, read])` runs them one after another and never contends for a lock. The test can't produce `SQLITE_BUSY`. Rewrite: open a raw `DatabaseSync` on the same file, `BEGIN IMMEDIATE` plus an uncommitted insert, then run `runAdminCli` (or spawn `server/whim-admin.mjs`) with a separate reader. Assert exit 0, that it doesn't wait out `busy_timeout`, and that it doesn't see the uncommitted row. Do this for both stores.
- [CHANGE-DETECTOR] unknown subcommand prints the grammar (L37-43) — DELETE. It checks help text (`output.includes('reports list')`) for an operator CLI, and failures show up the moment the operator runs it.
- Keep: list hides content, show prints everything, purge, usage summary.

### server/test/logging.suite.ts (300 lines, OLD): KEEP-FIX

- [SOURCE-GREP][RED-GREEN-ARTIFACT] `testRetiredHelpersAreGone` (L155-179) — DELETE. `check('server/src/dev-log.ts no longer exists', …)` plus a regex for `[whim-server]`/`logRun(`/`logRequest(`: a dead-code removal with no lasting invariant.
- [DUPLICATE] `eq('every /v1 route still requires x-whim-device', ungated.status, 400)` (L197-199) — DELETE. See wire-v2.suite.ts:172-196.
- [DUPLICATE] direct `isDevLogBatch` guard checks (L286-288) — DELETE. The eight route-level malformed cases (L271-284) already cover the guard.
- Keep: serializer redaction (L70-153), sink off by default and outside /v1, append order, whole-batch refusal.

### server/test/web-site.suite.ts (393 lines, NEW): KEEP-FIX

- [TAUTOLOGY][META] "a hand-kept key list (the rejected weaker variant) misses the new key" (L150-159) — DELETE. It tests an implementation that exists only inside the test.
- [CHANGE-DETECTOR][TAUTOLOGY] 30-day red-check (L162-170) — DELETE. `normalizedPolicy.replace(/deleted after 90 days/, …)` pins "90" and then asserts 30 ≠ 90. The lockstep check above it is the real test.
- [META] two parity red-checks (L133-141, L143-148) — MERGE: keep L146-148 (deny-by-default).
- [CHANGE-DETECTOR] `check('privacy.html names OpenRouter …', renderedPolicy.includes('through OpenRouter'))` (L116) — DELETE. It's an exact-phrase pin: "via OpenRouter" would break it, and a substring can't enforce the disclosure anyway.
- [DUPLICATE] `!renderedPolicy.includes('{{')` (L117) — DELETE. `renderPage` already throws on a leftover `{{`, as asserted at L206-211.
- [DUPLICATE] `associationState` "neither" case (L244-254) — MERGE into the `buildSite` absent case (L302-317), which asserts the same `missingPath`.
- Keep: consent parity (L110-114), retention lockstep (L119-129), placeholder rules and escaping, store links, no-script, the upload-only association case, and `buildSite` success, failure and wrong-files.

### server/test/machine.suite.ts (1905 lines, CHANGED): KEEP-FIX

The state-machine tests are behavioral at the event boundary. The PR's new budget and credit tests (L1091-1859) are strong: 402 mid-stream, in repair, in the expiry turn, from the summariser, and cache invalidation contrasted with an ordinary failure.

- [DUPLICATE][PLATFORM] `testAbortIsIdempotentAndQuiet` (L807-825) — DELETE. Same setup as `testAbortBeforeStart` (L708-718); the second `controller.abort()` is an AbortController no-op, as its own comment says.
- [DUPLICATE] `testRepairBudgetsAreConstructorInjectable` (L1028-1041) — MERGE into `testPlanReaskThenFailure` as a planAttempts 1-vs-2 parameter. Its `if (terminal.type === 'failure') eq(...)` is conditional.
- [CHANGE-DETECTOR] `testUsageRejectionAfterDeltasLogsAtThrowSite` (L993-1026) — REWRITE. By its own doc comment it exists to cover the `throwLoggedModelCallFailure` call site, and it asserts log fields (`r.which === 'usage'`). Keep the money property (a usage rejection after a clean stream must not deliver unmetered: one failure, no `result`, `RunTrace.outcome === 'failed'`) and drop the log-shape checks.
- [KITCHEN-SINK] `testModelStreamThrowYieldsOneFailure` "run log carries the plan stage start" (L968-973) — DELETE. It's unrelated to the subject.
- [CHANGE-DETECTOR] verbatim copy constants (L637-638, L1094-1096) — KEEP-FIX. Six sentences are duplicated from machine.ts:190-201, and a reword fails about 12 assertions. The wire `failure` has no reason code (see Incidental), so export the constants (and check `CREDIT_EXHAUSTED_REASON === refusals.budget_exhausted`, which is a real invariant). Pin the copy once if it's meant to be locked.
- [CHANGE-DETECTOR] `eq('stalled model: the deadline was armed once, for maxRunMs', clock.armedDelays, [MAX_RUN_MS])` (L1282) and `eq('default budget: … 600000 ms', …)` (L1834) — DELETE. The first is timer-count internals. The second pins a default production never uses: lifecycle.ts:385 always passes `config.generationMaxMs`.
- [DUPLICATE] "exactly one terminal event" re-asserted right after `assertCompletedEnvelope` (L280, 283, 407, 444, 468, 503, 625, 698, 1038, 1087) — KEEP-FIX: drop them.
- [latent false positive] leak list includes `'contained'` (L679) — KEEP-FIX. Any prompt template that says "self-contained" would fail here. Match the verdict tokens instead.
- Keep: everything else, including plan parse/validate, happy path, thinking, fenced unwrap, repair, the containment/unverified split, abort boundaries (`testAbortDuringCheck`/`Run` exercise the post-work signal check, which the start-boundary test doesn't reach), RunTrace ids, and all deadline and credit tests.

### server/test/openrouter.suite.ts (525 lines, CHANGED): KEEP-FIX

- [RED-GREEN-ARTIFACT] `check('usage schema identity …', OpenRouterUsage === Usage)` (L186) — DELETE.
- [VACUOUS] `check('no API key required by suite', true)` (L372-373) — DELETE.
- [DUPLICATE] §7.7d content-only frames (L428-438) — DELETE. It repeats L142 and L149.
- Three near-copy HTTP error blocks (L262-313) — MERGE into a table like the mid-stream cases (L491-509), and add HTTP 402. The `!(err instanceof OpenRouterRateLimitError)` checks hold by construction.
- [CHANGE-DETECTOR] `capturedCall?.init?.signal === controller.signal` (L364) — KEEP-FIX. It checks identity; a client that links its own timeout via `AbortSignal.any` would fail harmlessly. Assert that the forwarded signal is aborted instead.
- Keep: delta order, the trailing-frame flush, usage and id capture, the reasoning flag on the wire, null body rejecting usage, reasoning deltas, and all mid-stream error frames (a realistic truncation bug).

### server/test/ledger.suite.ts (635 lines, NEW): KEEP-FIX

- [CHANGE-DETECTOR][DUPLICATE] `testNoContent` exact column list (L247-285) — DELETE. It broke once already when `generation_ids` was added, and the marker scan at routes-generate.suite.ts:1065-1150 proves the actual property.
- Note, not a verdict: the `InMemoryUsageStore` halves of the contract loops (L143-152, L371, L418, L484, L604) test a test double. Nothing in production uses it (Incidental). It's cheap, and fake fidelity keeps route suites honest.
- Keep: UTC-midnight Retry-After and rollover, global ceiling and precedence, the atomic last unit (fails if anyone adds an `await` between count and insert, per usage-store.ts:30), durability, refund, settle/recordCost idempotence, admission-day settlement, purge, summary, unresolved→resolved upgrade, sweep candidates, max age, persisted `[]`, migration, empty globalKinds.

### server/test/resolver.suite.ts (560 lines, NEW): KEEP-FIX

- [DUPLICATE][TIMING] `testHangingAttemptCutOffByTimeout` (L243-262) — DELETE. `check(…, elapsedMs < 2000)` is a wall-clock check against a request id `''` with no ledger row. L193-241 hangs one id, must settle under the safety timeout and also asserts the ledger outcome.
- [TAUTOLOGY] `check('the resolved row is the one the provider answered for', lateId !== neverId)` and the mislabeled L394 ("keeps its cost", which actually asserts `unresolvedCount`) (L394-395) — DELETE.
- Delegating store wrappers written twice (L52-69, L419-432) plus `RecordingUsageStore` in routes-generate.suite.ts:119 — MERGE into one shared spy.
- Keep: the creditOwned no re-credit, cancelled single credit, unresolved explicit, partial never stamped resolved, tracker drain, empty ids, and sweep pickup, drain stand-down, starvation and fan-out cap. These run against real SQLite; the route suite records attempted writes through a fake store.

### server/test/reports.suite.ts (157 lines, NEW): KEEP-FIX

- [DUPLICATE] "configurable retention" block (L77-86) — DELETE. It never touches configuration: it calls the same `purgeOlderThan(cutoff)` as L63-75 with a different number.
- [TIMING] `testSchedulePurge` (L108-126) — KEEP-FIX. Fixed `setTimeout` waits of 5 ms and 40 ms against `intervalMs: 10`. Inject a timer (as `ManualClock` does in machine.suite) or return the boot-run promise.
- Keep: exact stored fields, 90-day purge, the secure_delete marker check, list/get.

### server/test/prod-build.suite.ts (490 lines, NEW): KEEP-FIX

- [VACUOUS] `check('the tree lies outside the checkout', …)` (L234) asserts the test's own `mkdtemp` — DELETE.
- [RED-GREEN-ARTIFACT] `check('a write:false bundle writes nothing', …)` (L252) tests a build-helper option — DELETE.
- L249-251 — MERGE with loadtest.suite.ts:247-252 (one bundle pass). Keep L250 as the non-vacuity control.
- Keep: the exact runtime tree, the bundle import scan and its one negative control, stub boot, all boot refusals, and the three SIGTERM drain cases with ledger outcomes (real end-to-end money and ops tests). `testUsageAndCostTransport` (L439-474) belongs in resolver.suite but earns its place.

### Keep

- `server/test/log-capture.ts` (73 lines, OLD) — KEEP; used by six suites.

## 3. Patterns

1. **Fix-loop red-checks left in the gate (META + CHANGE-DETECTOR): about 65 instances.** These are about 50 per-rule `red:` plants and 4 executed shell mutants in deploy-config, plus 4 in loadtest, 3 in web-site and 1 in prod-build. They prove a check could fail against an older or weaker implementation, which is the fix loop's job, not the permanent suite's. `plant()` throws when its exact source text is gone, so reformatting a config crashes the whole server suite. Representative: deploy-config.suite.ts:1224-1247 rewrites lib.sh to `sleep 5` and asserts the mutant takes at least 4.5 s, on every gate run. Keep at most one negative control per checker, and none for checkers that compare exact values.
2. **DUPLICATE of a stronger route-level test: about 12.** Representative: metering.suite.ts:222-266 (cancellation with a 50 ms sleep) against routes-generate.suite.ts:1045-1058. Also the metering and ledger column pins against the routes-generate marker scan, and the logging and metering device-gate checks against wire-v2.suite.ts:172-196.
3. **Literal pins (CHANGE-DETECTOR): about 55 assertions.** config defaults (25), profile machine types and capacity, compose/Caddy literal paths and CSP, example env files, verbatim failure copy (6 constants), schema column lists. Representative: config.suite.ts:54 `defaults.serverPort === 8787`.
4. **VACUOUS or TAUTOLOGY: 6.** Representative: admin.suite.ts:144-200 "concurrent" reads over synchronous `DatabaseSync` that can't interleave. Others: loadtest L319-322, openrouter L373, resolver L395, metering L77-94, prod-build L234.
5. **TIMING: 7.** Fixed sleeps (metering L244, reports L117/L123), wall-clock bounds (resolver L261, deploy-config L1202/L1219), and real `sleep 5` in lib.sh retry paths (about 15 s per run in deploy-config).

## 4. Incidental

- `InMemoryUsageStore` (server/src/usage-store.ts:310) says "for tests and dev", but nothing outside `server/test` constructs it. It's dead production code.
- The contract's `failure` event (contract/src/index.ts:270) carries only prose, so the device, and these tests, can tell budget exhaustion, expiry and unverified-run failures apart only by string matching.
- `server/src/main.ts` is bundled three times per gate run (prod-build L222 and L249, loadtest L247), plus one poisoned bundle written to disk.
- `server/test/harness.ts` `check()` doesn't delegate to `node:assert`, which the repo's CLAUDE.md asks of Node test helpers (outside this slice's rating).
