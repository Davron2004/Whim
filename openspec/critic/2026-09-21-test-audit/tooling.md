# Test audit: tooling slice

Scope: `checks/test/**`, `evals/test/**`, `scripts/test/**`, `scripts/netdeny/test/**`, `.claude/hooks/test/**`, `.codex/hooks/test/**`. I read every test file in full and the implementation wherever a verdict depended on it. Nothing was run.

My overall read: this slice holds up better than "half should go". Most release suites are lint tests of shipped release lints (the release CLI runs `checkIosProject`, `checkAndroidProject`, `checkStoreListing` before every build), and each pairs a real-repo guard with a clean-fixture baseline and discriminating mutants. That structure is sound. The waste sits in four places: the greenBy scaffolding and the constant-table tests it produced in `acceptance.ts`, source-greps of Swift/Kotlin/ObjC code, tautologies and duplicates in the eval suites, and try/finally near-copies that should be tables. One test, and the fixture behind it, locks in a real product bug (storage-roundtrip, below).

## 1. Totals

Line estimates cover the test file lines I would remove (DELETE) or rework (REWRITE/MERGE). A MERGE usually shrinks the code to a third of its size, so the rework column overstates what survives.

| Class | Files | Test lines | Est. DELETE | Est. REWRITE/MERGE |
|---|---|---|---|---|
| NEW (added by PR #35) | 11 | 3,322 | ~310 | ~895 |
| CHANGED | 3 | 1,698 | ~250 | ~155 |
| OLD | 21 (6 are eval fixtures) | 3,830 | ~340 | ~100 |
| **Total** | **35** | **8,850** | **~900 (10%)** | **~1,150 (13%)** |

The NEW rework number is mostly boilerplate: about 45 mutation tests in `native-network-deny`, `ios-project`, and `android-project` repeat the same 12-line mkdtemp/try/finally shell. As tables they would save roughly 500 lines without losing a single case.

## 2. Per-file findings, worst first

### checks/test/acceptance.ts (1417 lines, CHANGED) — REWRITE (partial)

The PR only added the release-suite hook and three import tests (L448-479), and those are good. The problems are older, mostly in §B0, which greenBy chain B wrote before any code existed.

- [RED-GREEN-ARTIFACT / CHANGE-DETECTOR] `B §contract: DiagnosticKind union is closed…` (acceptance.ts:L125-171) — DELETE. It asserts `DIAGNOSTIC_KINDS` equals a 38-entry hand copy of itself (`DIAGNOSTIC_KINDS.length === expected.length`). Adding a kind means editing both lists. Renaming or deleting a kind a producer emits already fails `tsc` in `checks/passes/*` and `synthrun/*`, which are type-checked. If you want the uniqueness line, keep it as a one-liner.
- [DUPLICATE] `B §contract: the storage engine's VERB-TIME kinds…` (L173-188) — ~~DELETE~~ **REWRITE (overturned 2026-09-21, see verification.md)**. The comment says the `StorageErrorKind & DiagnosticKind` element type "fails to typecheck" on drift, but `tsconfig.json` excludes `checks/test`. esbuild strips the type unchecked, so that safety is imaginary. The runtime loop repeats six members of the L125 list.
- [CHANGE-DETECTOR] `B §contract: HOST-FAULT kinds not_open/corrupt_storage are NOT in the vocabulary` (L190-200) — DELETE. It checks two strings are absent from a constant. The rule it names ("no producer renames a host fault into a candidate kind") lives in synthrun's mapping, and a producer that maps `not_open` to `launch_failed` passes this test. If the rule matters, test it where synthrun handles a `not_open` engine error.
- [TAUTOLOGY] `B §contract: unobserved, failed and timed-out containment are three distinct kinds` (L202-211) — DELETE. `new Set(['containment_unobserved','containment_failure','mount_timeout']).size === 3` holds by construction, and L125 already covers membership.
- [DUPLICATE] `B §contract: the synthetic run mints no kind of its own` (L213-226) — DELETE. `synthrun/report.ts:L195` pushes `ObservedDiagnostic`s into `RuntimeDiagnostic[]`, whose `kind` is `DiagnosticKind`, so `tsc` already enforces the subset.
- [RED-GREEN-ARTIFACT, containment] `B §contract: GLOBAL_ROOTS + FORBIDDEN_DIRECT_NAMES tables are well-formed` (L228-236) — REWRITE. It is the only lock on `eval`, `Function`, `document`, `window`, `self`, `top`, `parent`, `frames`, and it checks table membership, not detection. No test anywhere in the repo asserts that `eval('x')`, `new Function('x')`, `document.cookie`, or `window.fetch(...)` draws `forbidden_global`. The behavioral tests cover only `fetch`, `globalThis`, and `.constructor`. Rewrite: parametrize over every GLOBAL_ROOT (`${root}.foo`) and every FORBIDDEN_DIRECT_NAME (`${name}(...)` or `${name}.x`), assert `forbidden_global`, and add the shadowed-parameter negative control for each.
- [CHANGE-DETECTOR] `B §contract: CAPABILITY_EXPORTS has exactly storage + cues rows` (L238-242) — DELETE. D §capabilities (L568-614), the storage+cues honest sample (L1277), and the latency-probe `unused_capability` check (L1384) cover the behavior.
- [CHANGE-DETECTOR] `B §contract: NAV_CALL_SHAPES ships exactly the nav.navigate target row` (L244-251) — DELETE. D §screens (L644-818) covers it behaviorally and more thoroughly.
- [RED-GREEN-ARTIFACT] `B §contract: SDK_LINT_RULES steers setTimeout/setInterval/requestAnimationFrame` (L253-259) — REWRITE. Only `setTimeout` has a behavioral test (L824). Parametrize L824 over all three timer names and drop the table check.
- [META] `B §harness: …` self-tests (L261-271) — DELETE along with the greenBy machinery (see harness.ts).
- [CHANGE-DETECTOR] `B §storage-surface: KNOWN LIMIT — a facade held in a local alias is NOT collected` (L364-376) — DELETE. It pins a limitation, so the only way to fail it is to improve the scanner. The comment is the right home for that fact.
- [DUPLICATE] `C §globals: computed access on a tainted alias…` (L500-504) and `C §globals: Object.prototype pollution attempt…` (L511-514) — DELETE. They match hostile/corpus.ts:L46-56 (join-assembled `fetch` key) and L83-88 (identical `defineProperty(Object.prototype…)`), and the hostile versions also assert `ok === false`.
- [DUPLICATE] `C §globals: a forbidden-global diagnostic carries a non-empty, SDK-shaped hint` (L527-532) — MERGE. Apply `assertAllWellFormed` to every report the suite produces (wrap `runStaticChecks` once) and drop this test.
- [TAUTOLOGY] `D §diagnostics: static undeclared_capability matches the runtime bridge gate kind string verbatim` (L585-590) — DELETE **(but the lockstep it names is untested; see verification.md)**. `assertHasKind(r,'undeclared_capability')` already found the diagnostic by that kind, so `d.kind === 'undeclared_capability'` cannot fail. It also repeats L568.
- [DUPLICATE] `D §capabilities: a real vc-sdk storage use is still flagged undeclared (positive control…)` (L609-614) — DELETE. It is L568 with the call moved from `setup` into `homeBody`.
- [MERGE] `D §screens: aliased nav import rejects…` and `namespace nav import rejects…` (L712-749) — MERGE into one table over {direct, aliased, namespace} × {dangling, non-literal}, with L644/L661 as the direct row.
- [VACUOUS] `§storage continuity: an aliased facade in the PREVIOUS source is never demanded` (L1137-1144) — DELETE. With an empty `previousSurface`, `storageContinuityPass` loops over nothing, so no drift is true by construction (checks/passes/storage-continuity.ts:L92-98). The setup assertion repeats L364.
- [CHANGE-DETECTOR] `E §assembly: diagnostics … appear in PASSES declaration order` (L1182-1192) — DELETE. It pins the internal pass order and the exact diagnostic count, and no consumer depends on order. L1157 covers accumulation and L1194 covers determinism.
- [DUPLICATE] `E §honest-corpus: latency-probe is pinned expected-flagged` (L1379-1385) — MERGE into the hostile corpus as an inline `globalThis.__whimSyscall(...)` case. L490 already covers the `forbidden_global` half, and the test depends on a dev fixture file.
- [META] 51 `{ greenBy: 'C'|'D'|'E' }` tags and the `B §`/`C §`/`D §`/`E §` name prefixes — REWRITE (mechanical) when harness.ts goes.
- Everything else is KEEP: parse gate, import allowlist including the PR's re-export/import-equals tests, shadowing, manifest, capabilities, screens, schema floor, identity drift, storage continuity, purity, and the honest fixtures.

### checks/test/release/native-network-deny.suite.ts (861 lines, NEW) — REWRITE

This is the only automated guard for D17's native network refusal, a containment leg, so REWRITE, not DELETE. The on-device canary is manual. The test file carries a 400-line hand-written Kotlin/ObjC lexer and checker (L12-417) that greps source code, and much of it pins code shape, not the invariant.

- [SOURCE-GREP / CHANGE-DETECTOR] checker body (L162-172, L187-192, L216-225, L234-244, L354-356) — REWRITE. Renaming the local `wrapper` to `view` or `context` to `ctx` fails `createBody.indexOf('wrapper.webView.settings.blockNetworkLoads = true')` and `'return wrapper'`. A reworded `check(...)` message fails `exactOneCheckNamesAutolinking`, which requires the literal `react-native-webview autolinking`. `WhimTonePackage must remain registered` (L190-192) has nothing to do with network deny. `module providers must be inherited unchanged` (L242-244) and the exact `[self initX:frame configuration:configuration]` string (L354-356) pin implementation choices. Rewrite: keep only the invariant-bearing facts (the replacement manager subclass sets `blockNetworkLoads = true` in code, never `false`; the autolinked package is replaced in place; iOS rules are exactly `^https?:` and `^wss?:` blocks; the unavailable branch disables JS; both files belong to their build phases). Match tokens, not whole statements. Longer term, an Android instrumented test that asserts `settings.blockNetworkLoads` on a manager-created view (and an XCTest for the rule list) would replace most of the lexer.
- [CHANGE-DETECTOR] `native-network-deny: the exact-one check must carry the autolinking message itself` (L679-697) — DELETE with the rule above.
- [MERGE] 17 mutation tests (L545-677, L715-860) — MERGE into one table of `{file, mutate, expectFindingIn}` rows. Each currently repeats mkdtemp/writeValidFixture/try/finally. Keep the discriminating rows: append-vs-replace (L545), onAfterUpdateTransaction (L563), `= false` (L581), stock manager (L596), comment and raw-string impersonation (L611, L629, L653, L833), WS rule dropped (L730), resource-type qualifier (L715), rules missing from Resources (L742), wrong exchange (L772), fail-closed branch removed or misplaced (L791, L809).
- KEEP: the real-tree Android and iOS tests (L529, L699) and both clean-fixture baselines (L534, L704). Their names overclaim, though, since "refuses every WebView network load" is not what a text check proves.

### checks/test/release/ios-project.suite.ts (660 lines, NEW) — REWRITE (partial)

- [SOURCE-GREP / CHANGE-DETECTOR] five `scene callback checks reject …` tests (ios-project.suite.ts:L460-526), the 108-line Swift fixtures they need (L249-356), and the `checkIosSceneLifecycleWiring` half of L387-397 — DELETE. `checkIosSceneLifecycleWiring` (scripts/release/lib/ios-project.ts:L603-655) is a list of 13 verbatim Swift fragments, among them `'if let existingFactory = reactNativeFactory'` and `'UIColor(named: "LaunchBackground")'`. The release CLI never calls it, so it exists only for this test. Renaming a local breaks it, and it cannot tell whether UIKit delivers a link, as the file's own comment (L460-461) admits. If cold and warm link delivery needs an automated lock, use a simulator E2E (`xcrun simctl openurl` cold and warm, then assert the launcher opens the linked app). Delete the lib function with the tests.
- [MERGE] the ~20 "X fails" mutation tests (L400-458, L528-659) — MERGE into a table. Five of them are one pattern ("a literal DEVELOPMENT_TEAM / MARKETING_VERSION / CURRENT_PROJECT_VERSION / bundle id fails"), and the Debug and Release baseConfigurationReference tests (L588-606) are copies of each other. The invariants are real, so keep every row: Xcode's version field writes literals into pbxproj, iPad support needs iPad screenshots, `ITSAppUsesNonExemptEncryption`, the privacy manifest, and the scene manifest crash fix.

### checks/test/harness.ts (143 lines, CHANGED) — REWRITE

- [META] greenBy scheduling (harness.ts:L1-10, L17-58, L60-84, L112-143) — REWRITE to a plain `test(name, fn)` plus a `report()` that fails on any failure (about 40 lines). Chains B-E merged long ago, no active change writes `checks/test/.phase`, and only `acceptance.ts` uses the tags. The scheduler also carries a live hazard: `.phase` is untracked and gitignored, and the gate runs from the primary tree. A stale `.phase` containing `B`, left there by any chain run, marks about 50 C/D/E tests `due: false`, turns their failures into `PENDING`, and exits 0. The "fail-closed" comment on L49 only covers a missing file. Also remove the matching `.gitignore` entry and the XPASS guidance in `.claude/agents/reviewer.md` and `implementer.md`. Keep the `assert`/`assertHasKind`/`assertNoKind` helpers. The PR's `nodeAssert.ok` change was correct.

### evals/test/tier-b.test.ts (281 lines, OLD) — REWRITE (partial)

- [TAUTOLOGY: fixture shaped to the bug] `storage-roundtrip: a write and a read both recorded passes` / `…write with no matching read fails` (tier-b.test.ts:L132-144) — REWRITE. With no target, `evaluateStorageRoundtrip` looks for `storage.set` and `storage.get` (evals/assertions.ts:L111-113). The SDK emits `storage.kv.set`, `storage.kv.get`, and `storage.records.*` (src/sdk/index.tsx:L199,L204), and synthrun records `method` as sent. The eight `storage-roundtrip` assertions in `evals/sets/visible/manifest.json` (L30-100) therefore cannot pass on a real run. This test and `fixtures/synthetic-run-report.json` both use the invented names, so they lock the bug in. Rewrite: build `syscallsInvoked` from real method names (`storage.kv.set`/`storage.kv.get`, plus a `records.append`/`records.list` row), and it goes red until the evaluator is fixed.
- [CHANGE-DETECTOR] `this suite covers every closed assertion kind` (L61) — REWRITE. `ASSERTION_KINDS.length === 6` checks a count, not coverage. Drive the green and red cases from a table keyed by `ASSERTION_KINDS` so a missing entry fails.
- [DUPLICATE] the whole "load-time guarantees" section (L188-281) — DELETE. It matches loader.test.ts:L155-222 case for case: missing English, unknown kind naming the closed set, code string, module-reference field. If you value the side-effect sentinel, fold it into loader.test.ts:L197-205, though the loader never evaluates anything, so it guards a bug nobody would write.

### evals/test/cli.test.ts (541 lines, OLD) — KEEP-FIX

- [META / SOURCE-GREP] `the gate never invokes a corpus-eval run` and the pending-class2 tri-state (cli.test.ts:L471-528) — DELETE. The tri-state tracks a Class-2 obligation that is long applied (gate.sh has `check "corpus-eval" npm run -s evals:test`), and it walks the openspec archive to stay green. The gate.sh grep checks a file only humans edit, and it misses the plausible spelling `npm run -s evals -- run`. The spend protection that matters is the live-judge opt-in, which tier-c.test.ts:L114-155 tests behaviorally.
- [META / environment-dependent] `this acceptance suite runs with no eval set present in its own environment` (L530-541) — DELETE. It fails for anyone who exports `WHIM_EVAL_SET` in their shell and protects nothing shipped.
- [TAUTOLOGY] `red-check: the input … really does carry the secret` (L298-301) — DELETE. It checks that a literal contains itself.
- KEEP: producer sourcing, the exactly-one-terminal-event cases (L140-176), resolution and exit-code matrix, holdout console redaction plus its visible control, tracked-directory refusal, diff/compare exit codes.

### evals/test/loader.test.ts (354 lines, OLD) — KEEP-FIX

- [DOC-TRIPWIRE] corpus registry drift (loader.test.ts:L23-61) — DELETE. It parses a markdown table in `docs/app-corpus.md` by column position. Drift in the other direction already fails loudly: an eval case naming an unregistered slug is refused (L127-140). This is a judgment call. If the owner treats the doc as the source of truth, generate `TIER0_SLUGS` from it instead of checking it.
- [CHANGE-DETECTOR] `the committed visible set has 22 cases (11 apps x 2 phrasings)` (L268) and `the visible set directory exists` (L263, since `loadEvalSet` on L266 throws anyway) — DELETE. Keep the slug-coverage check (L271-275) and the no-holdout-directory check (L281).
- [VACUOUS] `this file is discoverable by evals/test/run.mjs` (L283-291) — DELETE. If the file weren't discovered, the check wouldn't run.
- [DUPLICATE / TAUTOLOGY] redaction absence checks and console capture (L311-333) — DELETE. L306 already asserts the redacted case deep-equals `{caseId, promptSha256}`. The console block logs that already-checked string and then tests `console.log`.
- [PLATFORM] `promptSha256 is deterministic… / differs… / 64-char hex` (L348-353) — DELETE. These test `node:crypto`.

### evals/test/tier-a.test.ts (219 lines, OLD) — KEEP-FIX

- [DUPLICATE] `Tier A: determinism` (tier-a.test.ts:L87-96) — DELETE. `evaluateTierA` is a pure composition, and acceptance.ts:L1194 covers purity of `runStaticChecks`.
- [DUPLICATE] `RunReport.contained === true maps to an authenticated, contained verdict` (L124-133) — DELETE. It reads the same fixture as L102-115, whose full `eq` already includes `containment`.
- [TAUTOLOGY] `tierAFailed(FAILED_TIER_A) is true / …false` (L196-197) — DELETE. The function body is `status === 'fail'`.
- [TAUTOLOGY / non-discriminating] the three case-verdict checks (L198-218) — REWRITE. Each compares `tierB`/`tierC` constants to their own literals. The "Tier A failure short-circuits" case passes a skipped Tier B, so `computeCaseVerdict` returns `fail` even if it ignored Tier A. Rewrite as a table: (failA, passB) is fail, (passA, failB) is fail, (passA, skippedB) is fail, (passA, passB) is pass.
- KEEP: honest pass, error-diagnostic fail, untrusted verdict fails, breach and unobserved mapping.

### evals/test/tier-c.test.ts (313 lines, OLD) — KEEP-FIX

- [TAUTOLOGY / META] `scripted judge returns the mapped verdict` and `…throws for an unmapped case id` (tier-c.test.ts:L50-72) — DELETE. `createScriptedJudge` is a test double (the CLI has no `--judge` flag), so this asserts a mock returns what it was told to.
- [DUPLICATE] `replayFileName keys on case id + rubric version` (L93-97) — DELETE. L78-91 loads `replay-case-1__v1.json` through the same function.
- [PLATFORM] `hashScoredSection is deterministic / differs` (L308-313) — DELETE. It tests sha256.
- KEEP: replay judge, live-judge opt-in and credential gating (a spend guard), Tier C gating, malformed-verdict errors, and the rubric hash drift check, which exists by design to force a version bump.

### scripts/netdeny/test/canary.test.mjs (255 lines, NEW) — REWRITE

- [META / unwired] whole file — REWRITE. It tests the manual reproduction canary and nothing runs it. The header says `package.json` is protected, but gate.sh already runs `node scripts/test/sonar-pr-issues.test.mjs` directly, so the same line would wire this one. It is worth keeping because the `--expect zero` bundle-count rule is what stops the canary from producing false "zero traffic" evidence for the store-launch security claim.
- [TIMING] L155-253 — the canary exits on a fixed `--seconds 2`/`3` wall-clock window while the test fetches six bundles that each trigger an esbuild build. On a loaded machine the window closes mid-fetch. Rewrite: end the run with SIGINT after the traffic (the canary already handles SIGINT) and drop `--seconds`.
- [CHANGE-DETECTOR] hand-copied `NAVIGATION_VARIANTS`/`LEAK_REQUIRED` (L26-29) — REWRITE. Derive them by bundling `variants.ts` or having `run.mjs` print them.

### checks/test/release/domain-lockstep.suite.ts (66 lines, NEW) — KEEP-FIX

- [TAUTOLOGY / RED-GREEN-ARTIFACT] `domainLockstepFinding: …` and `deployHostLockstepFindings: …` pure-function tests (domain-lockstep.suite.ts:L25-35, L44-65) — DELETE (**one mismatch case per checker kept: overturned 2026-09-21, see verification.md**). They exercise `native === launcher` and two template-string equalities. "Discriminating: a same-length-only check would miss this" guards against code nobody writes. Keep the two real-repo lockstep tests (L19-23, L37-42); they are the point of the file.

### checks/test/release/hermes-entry.suite.ts (147 lines, NEW) — KEEP-FIX

- [CHANGE-DETECTOR] `a bound import of the installer … still fails the check` (hermes-entry.suite.ts:L73-80) — DELETE. A bound import runs the same side effects, so the "bare" requirement is style, not the ordering invariant.
- [TAUTOLOGY / DUPLICATE] `reproduces the marshal.ts crash class…` (L88-96) — DELETE. `({}).TextDecoder === undefined` is always true, and L98-109 does the real UTF-8 round trip.
- [DUPLICATE] `a second call is a no-op for already-installed globals` (L118-126) — MERGE into L111. A second call is the "existing global kept by identity" path.
- [MERGE] `an existing process.platform is never overwritten` (L142-146) — MERGE with L111 into one "existing globals are never replaced" test.
- KEEP: the real `index.js` first-statement check (an AST lock on the standing Hermes-polyfills-first invariant), the late-import negative control, the comment control, the round trip, and platform mapping.

### checks/test/hostile/corpus.ts (188 lines, OLD) — KEEP-FIX

- [CHANGE-DETECTOR] `F §hostile-negative: dynamic deep-merge pollution boundary is documented` (corpus.ts:L159-168, L180-187) — DELETE. It asserts `prototype_pollution` is not reported, so it fails only when detection improves. Record the boundary in a comment.
- KEEP: the nine hostile cases, as a parametrized containment corpus.

### evals/test/fixtures/synthetic-run-report.json (26 lines, OLD) — REWRITE

- [TAUTOLOGY: fixture shaped to implementation] trace methods `storage.get`/`storage.set` (L14-18) — REWRITE. Use a trace recorded from a real synthrun run (`storage.kv.get`/`storage.kv.set`). This fixture hides the storage-roundtrip bug above.

### checks/test/release/android-project.suite.ts (192 lines, NEW) — KEEP-FIX

- [low value] `a debug config without the dev cleartext hosts fails` (android-project.suite.ts:L180-191) — DELETE. It locks developer convenience, and removing the dev hosts breaks the emulator loop on the first run anyway. The store-relevant rule is the main-config cleartext test (L164-178), which stays.
- [MERGE] five mutation tests (L125-191) — MERGE into a table. They share the mkdtemp/try/finally shell.
- KEEP: real project, baseline, autoVerify, filter on launcher, placeholder host, cleartext domain-config.

### .claude/hooks/test/bash-policy.test.sh (138 lines, CHANGED) — KEEP-FIX

- [DUPLICATE / non-discriminating] simulator-install tail-smuggling rows (bash-policy.test.sh:L114-127: semicolon, AND, OR, pipe, background, newline, CR, overwrite/append redirect, quoted path, glob, param expansion, command substitution, shell wrapper) — MERGE down to one head-anchor row (`env` wrapper) and one tail-anchor row (`; cp …`). The regex anchors fail the others identically, and the compound unroller denies most of them anyway (unroll.test.sh:L112-117 covers the redirect and compound deny kernel). Several rows pass even against an unanchored exception, so they prove little one by one. Keep the rows that discriminate: root defers, subagent deny, segment re-entry, bare `xcrun`, `/tmp/xcrun` lookalike, non-UUID, extra argument, `/../` and `/./`, hard-deny-first (`curl.app`), and the four general `cp`/`mv`/`ln`/`install` protected-write rows, which were new coverage.
- [weak failure message] L40 — a bare `[[ … ]]` under `set -e` exits 1 without naming the case. Wrap it in `expect_*`.
- Note: `.claude/settings.json` wires only `SubagentStop`, so this hook is live only through the Codex adapter (`.codex/hooks.json` → `.codex/hooks/bash-policy.sh`). The tests still protect real code.

### .claude/hooks/test/unroll.test.sh (138 lines, OLD) — KEEP-FIX

- [DUPLICATE] `refspec smuggling in compound denies`, `compound push of main denies`, `subagent worktree add + unknown -> none` (unroll.test.sh:L125-130) and the "negative control" (L132-136) — DELETE. They repeat bash-policy.test.sh:L61, L60, L49, and the negative control asserts `!= allow` on a command L127 already asserts is `deny`.
- KEEP: Layer A (quoted connectors are one segment, fail-closed constructs) and the rest of Layer B.

### evals/test/report.test.ts (456 lines, OLD) — KEEP-FIX

- [TAUTOLOGY] `the leak-detection check itself fires on a deliberately unredacted object (negative control)` (report.test.ts:L275-284) — REWRITE. It tests `String.includes` on a literal. A real negative control runs a visible-visibility report through `serializeReport`/`renderSummary` and asserts the prompt does appear, which proves the holdout absence checks look at a surface that carries prompts.
- KEEP: canonical ordering, timing-independent body, diff and compare semantics, and all the holdout redaction tests, which guard the eval's core guarantee.

### checks/test/release/native-config.suite.ts (194 lines, NEW) — KEEP-FIX

- [CHANGE-DETECTOR] `the real release/whim-release.xcconfig parses to the chosen release identity` (native-config.suite.ts:L56-65) — KEEP-FIX. Drop the `WHIM_MARKETING_VERSION === '1.0.0'`, `WHIM_BUILD_NUMBER === '1'`, and `WHIM_DOMAIN` pins, because the first version bump breaks them and domain agreement is domain-lockstep's job. Keep `WHIM_APP_ID` and `WHIM_APPLE_TEAM_ID`, since a published bundle id must never change.

### checks/test/release/release-cli.suite.ts (362 lines, NEW) — KEEP-FIX

- [DUPLICATE] `gradle.properties holding WHIM_UPLOAD_* secrets in the clear…` (release-cli.suite.ts:L109-118) — MERGE with L98-107. Both are the same `extraCredentialFiles` mode-0644 branch with a different label.
- [DUPLICATE] `categoriesFor does not classify "statfs" without the mach-o underscore as some other category…` (L226-229) — MERGE into L218. Its name contradicts itself and it re-asserts DiskSpace.
- [CHANGE-DETECTOR, minor] AASA/assetlinks shape via `JSON.stringify(a) === JSON.stringify(b)` (L277-291) — KEEP-FIX. Use `deepStrictEqual` so key order doesn't matter. Array order (Play fingerprint first) still gets checked.

### checks/test/release/store-listing.suite.ts (240 lines, NEW) — KEEP-FIX

- [false safety] `store-listing: the real repo passes with zero findings` (store-listing.suite.ts:L144-147) — KEEP-FIX. It passes `FIXTURE_CONFIG` (`WHIM_DOMAIN: 'example.com'`) instead of `loadNativeReleaseConfig(REPO_ROOT)`, so the rule "listing text never commits the release domain" (scripts/release/lib/store-listing.ts:L149) runs against the wrong domain in the gate. A listing containing `anycognition.ca` passes the gate, and only the release-time preflight would catch it.

### checks/test/release/assets.suite.ts (309 lines, NEW) — KEEP-FIX

- [CHANGE-DETECTOR, minor] `brand.json disagreeing with SHELL_COLORS.paper fails, showing both values` (assets.suite.ts:L201-212) — KEEP-FIX. It hard-codes `'#fbfaf8'`. Import `SHELL_COLORS.paper` so a palette change doesn't break the test.

### scripts/test/fixloop-preflight.test.sh (673 lines, OLD) — KEEP-FIX

- [CHANGE-DETECTOR] exact-text asserts on the apply command and the park note (fixloop-preflight.test.sh:L381, L410-411, L584-587, L598-600) — KEEP-FIX. The apply command gets executed right after (L386-401, L413-428), which is the real test, so drop the verbatim string match. The park-note rows pin prose ("runbook step 12", "Do that FIRST", "WILL FAIL"). Keep the ancestor/not-ancestor fact in both directions and drop the rest. The gatefull precondition cases, their negative control, and the checkverdict classifier are good harness tests: they catch a false-green gate and a PR flipped ready before CI ran.

### scripts/test/sonar-pr-issues.test.mjs (139 lines, OLD) — KEEP-FIX

- [CHANGE-DETECTOR] `formatFindings shape…` and `formatFindings: missing line renders as ?` (sonar-pr-issues.test.mjs:L94-110) — MERGE into the two end-to-end tests (L113-137), which already match the same heading regex. The markdown is read by an agent, not parsed, so pinning it twice adds nothing. The invisible-project guard (L45-54) is the valuable test here, because it stops a false-clean Sonar result.

### evals/test/harness.ts (72 lines, OLD) — KEEP-FIX

- [house rule] `check`/`eq` (harness.ts:L31-48) don't delegate to `node:assert`, which CLAUDE.md requires for S2699, and all six test files carry a `sonarjs/no-empty-test-file` suppression because of it. Make `check` call `nodeAssert.ok` inside a try/record (the checks/test pattern), and replace the hand-written `deepEqual` with `util.isDeepStrictEqual`.

## Keep

- .codex/hooks/test/protected-patch.test.sh — hash-bound grant, TOCTOU, replay, rename escape, subagent denial. Real bypass tests. (Bare `[[ ]]`/`grep -q` failures exit without naming the case; that's cosmetic.)
- .codex/hooks/test/provider-adapters.test.sh — adapter translation, multi-file and move-destination protection, unparseable-patch fail-closed.
- checks/test/run.mjs — runner.
- checks/test/release/index.ts — aggregator. Its header is a chain diary ("chain-1 pre-creates… chain-16…"); trim it to one line.
- evals/test/run.mjs — auto-discovering runner. The header "Not yet wired to an npm run script" is stale.
- evals/test/fixtures/candidates/honest.app.tsx, error-diagnostic.app.tsx, judge/replay-case-1__v1.json, synthetic-run-report-breach.json, synthetic-run-report-unobserved.json — minimal fixtures.

## 3. Patterns

1. **Constant-table and count checks from tests-first chains (13).** These assert a table equals a copy of itself or has N entries, instead of exercising the behavior the table drives. Examples: acceptance.ts §B0 (8 tests), tier-b.test.ts:L61 `ASSERTION_KINDS.length === 6`, loader.test.ts:L268 "22 cases", native-config.suite.ts:L56-65 version pins, acceptance.ts:L1182 pass order. Representative: acceptance.ts:L125-171. Worst consequence: acceptance.ts:L228-236 looks like `eval`/`document`/`window` coverage, and no behavioral test exists for any of them.
2. **Source-grep of code, not config (about 26 tests plus two checkers).** Checks that read XML/plist/pbxproj/JSON config are fine, because the config value is the invariant and they read it as data. The brittle ones regex-match Swift, Kotlin, ObjC, or shell: `checkIosSceneLifecycleWiring` (13 verbatim Swift fragments, 5 tests), the native-network-deny lexer (~400 lines, 17 mutation tests), and the gate.sh grep in cli.test.ts. Representative: ios-project.suite.ts:L460-526.
3. **Tautologies, including fixtures shaped to the implementation (14).** Constants compared to their own literals (tier-a.test.ts:L198-218), a test double tested (tier-c.test.ts:L50-72), `String.includes` "negative controls" (report.test.ts:L275, cli.test.ts:L298), sha256 determinism twice (loader, tier-c), and `({}).TextDecoder === undefined`. The costly case: fixtures/synthetic-run-report.json invents `storage.get`/`storage.set`, and tier-b's storage-roundtrip test agrees with it while real runs can never pass.
4. **Cross-file duplicates (12).** tier-b's load-time block copies loader.test.ts case for case (4). acceptance.ts duplicates hostile/corpus.ts twice. unroll.test.sh repeats three bash-policy rows plus a weaker negative control. tier-a determinism repeats checks purity. release-cli has two credential rows. Representative: tier-b.test.ts:L188-281.
5. **META: greenBy scaffolding and process tripwires (6 tests + 51 tags).** harness.ts's phase scheduler, three §harness self-tests, the pending-class2 tri-state, "this file is discoverable", and "no eval set in my own env". The scheduler also fails open on a stale untracked `.phase`.

Also worth doing: table-driving the ~45 mkdtemp/try/finally mutation tests in the release suites saves roughly 500 lines with no loss of cases.

## 4. Incidental

- evals/assertions.ts:L111-113: `storage-roundtrip` with no target looks for `storage.set`/`storage.get`, but the SDK sends `storage.kv.set`/`storage.kv.get`/`storage.records.*` (src/sdk/index.tsx:L199,L204), so the eight visible-set storage-roundtrip assertions (evals/sets/visible/manifest.json:L30-100) always fail on real runs.
- checks/test/acceptance.ts:L174-176 says the intersection type fails to typecheck on drift, but `tsconfig.json` excludes `checks/test`.
- checks/test/harness.ts:L40-51: a stale `checks/test/.phase` in the primary tree silently demotes failing C/D/E tests to PENDING with exit 0.
- scripts/netdeny/test/canary.test.mjs:L13-19: the stated reason it isn't gated (package.json is protected) is wrong, since gate.sh already calls `node scripts/test/*.mjs` directly.
- scripts/release/lib/ios-project.ts:L603-655: `checkIosSceneLifecycleWiring` is exported product code that only the test calls.
- scripts/release/lib/domain-lockstep.ts: the `loadDeployDefaults` doc says "(never called by the suite)", but domain-lockstep.suite.ts:L39 calls it, and the file header says the suite does.
- evals/test/run.mjs:L12-13: "Not yet wired to an npm run script" is stale; package.json has `evals:test` and gate.sh runs it.
- `.claude/settings.json` wires only `SubagentStop`, so `bash-policy.sh`/`protect-harness.sh` run only under Codex. CLAUDE.md still says protect-harness hard-blocks subagents.
- Release suites run inside `checks:test` (static-checks), so a release lint failure shows up in the gate as "static-checks". It's a side effect of avoiding a package.json edit, and it's confusing when you read gate output.
