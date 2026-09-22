# Test audit: server-behavior slice

Scope: the generation server's request and stream tests (`server/test/{routes-generate,routes-unary,server-core,wire-v2,contract,admission,disconnect,policy,prompts,stages,source-block}.suite.ts`, `e2e*.ts`, `e2e.run.mjs`, and the support files). Classification comes from `git diff --numstat main...HEAD`. I read every file in the slice in full and checked the implementation under `server/src/` and `contract/src/index.ts` wherever a verdict depended on it.

The new route suites (`routes-generate`, `routes-unary`, `disconnect`) are the best tests in the slice. They drive the real app over `app.request` or a raw TCP socket, and they assert refusals, slot counts, ledger rows and credited tokens. Most of the dead weight sits in the older and changed files: skeleton-era stub tests in `server-core`, zod restatements in `contract` and `wire-v2`, and one test in `e2e.ts` that exists only to test a module nothing else imports.

## 1. Totals

| Group | Files | Test lines | Est. DELETE | Est. REWRITE/MERGE |
|---|---|---|---|---|
| NEW | 8 (routes-generate, routes-unary, admission, disconnect, policy, source-block, e2e-drain-server, e2e-fixtures) | 3,846 | ~114 | ~169 |
| CHANGED | 7 (contract, server-core, wire-v2, prompts, e2e.ts, acceptance.ts, e2e.run.mjs) | 4,071 | ~898 | ~123 |
| OLD | 6 + fixtures/model (stages, sse-reader, scripted-model, harness, run.mjs, SPEC.md) | 695 (+14 fixture) | ~209 | 0 |
| **Total** | 21 + fixtures | 8,612 | **~1,220** | **~290** |

About 14% of the slice should go and another 3% needs rework. That's well below the owner's "half" estimate. This slice is mostly route-level behavioral testing, and the new chains wrote real tests. The waste is concentrated, so it's easy to remove.

Standing invariants and where each is actually protected (so the deletions below don't strip coverage):
- **Exactly one terminal event.** `routes-generate.suite.ts:836-850` (a pipeline that emits two terminals gets one on the wire), `:930-933` (expiry), `:964-965` (mid-run 402), `:811-815` and `:945-950` (none after an abort), `disconnect.suite.ts:172`.
- **Every `/v1/*` route gated.** `wire-v2.suite.ts:173-197` iterates the mounted route table, and `:219-250` proves a substituted verifier gates every route.
- **Admission before model spend.** `routes-generate.suite.ts:535-598` and `:641-648`, plus `routes-unary.suite.ts:349-369` (zero-turn scripted clients prove that no call happens).

## 2. Per-file findings, worst first

### server/test/contract.suite.ts (389 lines, CHANGED) — REWRITE

Most of this file restates `contract/src/index.ts` one zod call at a time. `run.mjs` already runs `tsc --noEmit`, and the samples are typed as `GenerationEvent`, so any narrowing of a variant's shape fails compilation before these runtime checks run. Keep about ten checks that encode wire invariants a newcomer would recognise, and delete the rest.

- [TAUTOLOGY] "exactly one terminal event" / "terminal event is last" (contract.suite.ts:L276-L284) — DELETE. It builds a three-element literal array and asserts it contains one `result`. No code under test runs. The real property is tested at routes-generate.suite.ts:L836-L850.
- [PLATFORM] round-trip of every variant (L37-L75) — DELETE. `GenerationEvent.parse(structuredClone(v))` deep-equals `v`, which is zod behaviour. The compile-time typing noted in the comment at L37-L38 already catches schema drift, and `sse-reader.ts:86` parses every real frame through the same schema in the route suites.
- [RED-GREEN-ARTIFACT] positive "accepts" restatements: `Diagnostic accepts stub BUILD_FAILURE kind` / `accepts optional severity + message` (L95-L107), `Usage accepts integers` (L125-L128), GenerateRequest app/source/appliedSchema optional (L132-L157), `RewriteResponse shape` (L219), AppContext and ClarifyRequest accept/round-trip (L221-L254), ApiError accepts (L257-L268), and `ServiceRefusalCode accepts ${code}` ×7 (L325-L335) — DELETE. Each literal checks itself against its own declaration. `admission.suite.ts:L302-L303` ("every ServiceRefusalCode has a builder") and the route suites' `expectRefusal` already validate every code the server emits.
- [DUPLICATE] ReportRequest/ReportResponse bounds (L286-L317) — DELETE. The one bound that matters to a user (the over-long note gets a 400 and stores nothing) is asserted at the route in routes-unary.suite.ts:L1004-L1012.
- [CHANGE-DETECTOR] "server runtime deps are exactly the allowed set" (L357-L365) — DELETE. It fails whenever a dependency is deliberately added and catches nothing that the React-adjacent check at L366 doesn't. The same goes for "pino-pretty is a server dev dependency" (L388). Behaviour without pino-pretty is covered by the production image test in prod-build.suite (another slice).
- Keep: unknown `type` rejected (L78), thinking `chars` bounds (L83-L86), Diagnostic hint mandatory (L89-L90), WireAppRecord strips install state (L110-L114), RewriteRequest strips source/bundle/ids (L193-L218, the privacy guarantee that rewrite never forwards code), closed stage enum (L271-L274), Usage integers (L122-L124), contract deps are `[zod]` plus the no-React checks (L352-L354, L366), and lockfile pins (L370-L378).

### server/test/server-core.suite.ts (857 lines, CHANGED) — REWRITE (delete ~280 lines)

This is the skeleton-era suite, written against the stub pipeline before the real routes existed. The route suites have since replaced most of it with stronger versions.

- [DUPLICATE] missing and malformed `x-whim-device` on generate/rewrite (server-core.suite.ts:L95-L138) — DELETE. wire-v2.suite.ts:L173-L197 checks every mounted `/v1` route. Malformed shapes are covered at the verifier (admission.suite.ts:L347-L358), and wire-v2.suite.ts:L219-L250 proves the middleware forwards any verifier refusal. Keep the `/healthz` block (L85-L93). Its `{ok, service}` body is a deploy smoke contract (deploy-config.suite.ts:907).
- [META] stub happy-path order, tokens, usage-before-result, and the failure path (L220-L299) — DELETE. This asserts the hardcoded sequence of `createStubPipeline`, a dev-only double that `config.ts:164` refuses in production. The real pipeline's order is tested in machine.suite, and the route's one-terminal enforcement in routes-generate.suite.ts:L836-L850.
- [DUPLICATE] invalid generate body → 400, not SSE (L301-L310) — DELETE. See routes-generate.suite.ts:L591-L593.
- [TAUTOLOGY] "rewrite never echoes the input prompt verbatim" / "rewrite is deterministic against the same scripted response" (L312-L326) — DELETE. Two apps get identical scripted turns whose text differs from the prompt by construction, so neither assertion can fail unless the scripted client itself breaks.
- [DUPLICATE, TIMING] `testSseCancelAbortsPipeline` (L450-L534) — DELETE. It monkeypatches global `setTimeout` to count the stub pipeline's own `delay()` timers and sleeps a fixed 300 ms. "No event after cancel" is proven more strongly by routes-generate.suite.ts:L821-L834 (a pipeline that ignores its signal still forwards nothing) and over real TCP in disconnect.suite.ts:L139-L191. The timer bookkeeping belongs to a dev double.
- [DUPLICATE] double-credit race, block 2 ("aborted before any usage event still reconciles exactly once", L636-L682) — DELETE. It's the same property as routes-generate.suite.ts:L1018-L1040, which also covers the classifier's tokens.
- [TIMING] double-credit race, block 1 (L585-L634) — KEEP-FIX. This is the only test that disconnects between the `usage` event and the terminal (money). It waits a fixed `setTimeout(50)` for the resolver. Pass a `ResolveTracker` and `await tracker.drain()` instead, as routes-generate does at L987-L990.
- [DUPLICATE] "keepalive fires 0 times after cancel" loop (L434-L442) — KEEP-FIX. Delete the loop. It can only fail in the case where L432 has already failed.
- [TIMING] keepalive-on (L201-L213) — KEEP-FIX. Its 80 ms × ~14 stub events spend over a second of wall clock. A source that yields once and then holds would show a keepalive in about 30 ms.
- Keep: SSE framing ids, `event:` equals `data.type`, and keepalive off (L142-L199); the rewrite app context reaching the model turn (L328-L356); invalid rewrite body (L358-L365); unconfigured rewrite → 502 (L367-L374); request logging and its privacy floor (L691-L752); the stub bundle defining the module (L762-L793); the stub `[[fail]]` passthrough (L803-L845).

### server/test/e2e.ts (1056 lines, CHANGED) — KEEP-FIX (delete ~175 lines)

- [DEAD CODE] `testReconciliation` (e2e.ts:L804-L922) — DELETE, along with `server/src/generation/reconcile.ts`. `reconcileAbortedUsage` has no importer anywhere under `server/src`: the routes call `resolveRequestUsage` from `usage/resolve.ts`. The module survives knip only because `test/**` is a knip entry and this test imports it. The underlying retry, budget, give-up and credit logic is tested in resolver.suite.ts (sections at L148, L194, L244, L286).
- [DUPLICATE, TIMING] `testCancellationDisposesAndReleasesSlot` (L350-L404) — DELETE. It drives `SynthRunSession` directly, with no server involved, and asserts `elapsed < 8000`. synthrun/test/resilience.ts:L239 covers the same abort ("250 ms into a hanging mount, the context closes and the slot frees within 5 s, once each") and also counts that the slot was released exactly once.
- [TIMING] `testLoadtestServerCapacityAndNoSpend` (L949-L952) — KEEP-FIX. It sleeps a fixed 150 ms and assumes three runs hold their slots by then. On a slow CI box the fourth request gets admitted and the test flakes. Wait on a condition instead, for example until three streams have returned headers.
- [MISPLACED] run-stage adapter tests (L114-L254: containment failure, unobserved verdict, no forgery detail, truncation) — KEEP-FIX. They're containment invariants and worth keeping, but they're pure Node with a stub `RunCandidate` and run only in the Chromium suite (gate-full). Move them into the fast suite so a regression fails `gate.sh`.
- Keep: the honest candidate through the real stages with a byte-identical build (L275-L318), the hostile candidate staying contained (L322-L348), the boot self-test (L418-L446), composed-server boot plus TCP disconnect closing the browser context (L533-L608), the SIGTERM drain (L764-L802), and the drain waiting for probes (L996-L1027).

### server/test/wire-v2.suite.ts (823 lines, CHANGED) — KEEP-FIX (delete ~105 lines)

- [RED-GREEN-ARTIFACT, DUPLICATE] `testContractShapes` (wire-v2.suite.ts:L88-L169) — DELETE. These are zod restatements ("three questions validate", "a fourth question is rejected", "clarifications are optional", "an absent summary stays absent") that duplicate contract.suite. The one that matters to users, the fourth question being dropped, is asserted at the route (L299).
- [META] stub clarify block and `[[noclarify]]` (L257-L279) — DELETE. "stub clarify is deterministic" compares the fixed `STUB_QUESTIONS` constant with itself across two apps. The model-path zero-questions success is covered at routes-unary.suite.ts:L740-L741.
- [TAUTOLOGY] "no stage name leaked into the prose" (L591) — DELETE. The scripted model supplied the prose.
- [CHANGE-DETECTOR] reserved tile hues (L494-L498) — KEEP-FIX. The test hardcodes `#b91c1c`, `#0d9488` and others, while `check.ts` reads the palette from `src/sdk/theme`. A token change would fail these checks without any bug. Iterate `STATUS_COLORS`, `STATUS_COLORS_ON_INK` and `SHELL_COLORS` instead.
- Keep: the whole-route-table gate (L173-L197), the substituted verifier (L219-L250), model-backed clarify, including the invalid, unusable and unconfigured cases (L282-L327), clarifications in and plan rows out (L332-L379), rewrite retry and best-attempt (L383-L457), summary shaping (L506-L565), the summariser timeout and failure (L594-L623), the summary on the terminal (L674-L769), and SSE passthrough (L773-L809).

### server/test/prompts.suite.ts (853 lines, CHANGED) — KEEP-FIX (delete ~95, rewrite ~90)

- [META] `testScriptedModelClient` (prompts.suite.ts:L127-L173) — DELETE. It tests the test double. Its role-mismatch and exhaustion errors already fire in every suite that uses it. Deleting it leaves `server/test/fixtures/model/*.json` unused (nothing else reads them), so delete those too.
- [META] "noNetworkTransport: refuses any request" (L110-L124) — DELETE. This is also a test of test plumbing, and `noNetworkTransport` in scripted-model.ts:L126-L136 then becomes dead code.
- [DUPLICATE, weak] model id and abort-signal passthrough (L86-L108) — REWRITE. openrouter.suite.ts:L221-L224 and :L364 cover these fields on `OpenRouterClient`. The adapter (`model.ts:112-124`) copies five fields, and a dropped `reasoning` or `maxTokens` would go unnoticed. Replace with one check that sends a full `ModelRequest` through `openRouterModelClient` and asserts the outgoing body's `model`, `max_tokens` and `reasoning`, plus the signal identity.
- [CHANGE-DETECTOR] prompt-copy regexes: `/keep that name unless the request explicitly asks to rename it/i`, `/describe ONLY what this request changes/` (L244-L251), `/Never ask.*what the app is/i` (L293-L296) — DELETE. Rewording an instruction fails these, and no data-flow bug would. The data-flow checks around them (prompt, name and collections reach the user message) are good.
- [CHANGE-DETECTOR] `testEditTurnPrompt` (L386-L441) — REWRITE. The honesty property is real: the prompt must not claim a "Current source" block that isn't there. But every assertion matches a full English sentence, such as `"Keep the app's current name unless this request explicitly asks to rename it."`. Export the section markers (the current-source heading, the storage-locations heading, the continuity instruction) from `prompts/index.ts` as constants. Then assert presence or absence of each marker across three cases: edit with source, edit without source, new app.
- [DOC-TRIPWIRE] `testSchemaArtifactDocumented` phrase pins: `/tombstones/`, `/epoch-millisecond/i`, `/Date\.now\(\)/`, and the `DayPoint.date` "unrelated"/"storage" window (L643-L660), plus `FIELD_TYPES.length === 6` (L634) — DELETE. They encode one doc patch's wording. Keep the loop that checks every engine `FIELD_TYPES` member is named in the section (L635-L641). That one follows the engine's closed set, so a seventh type fails it.
- [CHANGE-DETECTOR] `testEditTurnThreading` copy pins (L533-L537) — KEEP-FIX. Keep the numeric floor ("above 7") and the one-scan identity checks, and drop the full-sentence matches.
- Keep: prompt input loading (L177-L193), builder data flow, `testEditTurnThreading`'s one-scan wiring (L462-L527), `testExportsDocumented` (a doc tripwire, but the reference is model input, so an undocumented export teaches the model an incomplete SDK), few-shot fixtures are zero-diagnostic (L665-L677), the no-model-id-literal source scan (a standing invariant), the three content-policy tripwires (L741-L815), and json-block (L817-L834).

### server/test/stages.suite.ts (175 lines, OLD) — KEEP-FIX (delete ~37 lines)

- [TAUTOLOGY] `testRecordAssembly` (stages.suite.ts:L130-L166) — ~~DELETE~~ **KEEP, trimmed (overturned 2026-09-21, see verification.md)**. `assembleRecord` (record.ts:13-22) copies six fields. The "prosy" case (L150-L157) passes a manifest and asserts the name comes from that manifest. The comment at L152 admits it "structurally cannot" do otherwise. L159-L165 repeats L50-L54. The field mapping is exercised end to end by e2e.ts:L299-L308 (record name from extraction, bundle byte-identical to production).
- Keep: severity mapping plus the floor forwarding (L46-L85), source pre-flight (L89-L106), the build stage (L110-L128).

### server/test/policy.suite.ts (508 lines, NEW) — KEEP-FIX (delete ~50 lines)

- [TAUTOLOGY] "a harmful clarification answer is caught" / "app names in a rewrite are checked" (policy.suite.ts:L294-L314) — DELETE. The fake classifier refuses exactly when it sees the marker, so the verdict comes from the fake. These only re-prove that the input builder includes the text, which L271-L273 and L282 assert directly.
- [DUPLICATE] `testStubPolicy` (L484-L495) — DELETE. The route suites use the default `StubContentPolicy` and drive both markers end to end: `[[refuse]]` → 422 at routes-generate.suite.ts:L731 and `[[policy-down]]` → 503 at L746.
- [DUPLICATE] "a stub allow/refuse carries no usage" and "failure still throws PolicyUnavailableError" (L216-L230) — DELETE. The first is true by construction of a 10-line stub. The second repeats L151-L157.
- [CHANGE-DETECTOR] `eq('output is bounded: maxTokens', req.maxTokens, 48)` (L243) — DELETE. It's a constant equal to its own literal. The `reasoning: false` check next to it guards cost and can stay.
- [TIMING] classifier timeout (L113-L116) — KEEP-FIX. It awaits a check whose only pending timer is `AbortSignal.timeout(30)`, and that timer is unref'd. It passes only while something else happens to keep the event loop alive. If that changes, or if the timeout regresses, Node exits 13 mid-suite without naming the test. Wrap it in a ref'd deadline the way routes-unary.suite.ts:L270-L280 does.
- Keep: the fail-closed cases (L108-L175), usage and generation id carriage (L184-L214), classifier bounds other than the literal (L235-L253), input coverage via the builders plus the outgoing request excluding `app.source` (L257-L292), the cache (L345-L418), and content-free logging (L422-L482).

### server/test/routes-unary.suite.ts (1170 lines, NEW) — KEEP-FIX

- [DUPLICATE] `testPolicyCallIsMetered` (a) (routes-unary.suite.ts:L729-L744) — DELETE. testClassifierCreditedOnceOnUnaryEndings success/clarify (L842-L858) asserts the same classifier-plus-clarify total and also that cost resolves once.
- [DUPLICATE] `testPolicyCallIsMetered` (b) (L746-L761) — MERGE into testRefusedRewriteMakesOnlyTheClassifierCall (L696-L712). Same request, one more assertion (the classifier's usage is credited).
- [CHANGE-DETECTOR] `model.requests.filter((r) => r.request.maxTokens === 48)` (L789) — KEEP-FIX. It identifies classifier calls by an internal constant. Give the classifier and clarify calls separate scripted clients, or count calls by role.
- [DUPLICATE] "a report with no device header → 400" (L1061-L1068) — DELETE. See wire-v2.suite.ts:L173-L197. The same goes for "the refusal code validates as ServiceRefusalCode" (L1095-L1101), which repeats L1031-L1039 where the code is already `eq`'d to `daily_limit`.
- [KITCHEN-SINK] `testUnaryFailureRecovery` matrix (L485-L570) — REWRITE. It protects real ledger properties (row closed, not refunded, tokens never credited twice, capacity freed), but it runs ten combinations with expected values computed by branching on the parameters: `failure === 'settle' && !stub ? usage : zero`, and `completed = failure.includes('settle') ? 2 : 1`. A failing case can't be read without re-deriving that logic. Turn it into a literal table, one row per (route, failure, stub) combination, with the expected status, row, settle count and credited total written out.
- [TIMING] `/healthz/sse` spacing (L1107-L1129) — KEEP-FIX. It takes 2 s of real time on every run. The ≥1800 ms lower bound can't flake, but it's slow. Make `PROBE_FRAME_INTERVAL_MS` an app option so the test can use about 20 ms and still assert three spaced frames.
- Keep: admission order (L282-L370), the unary global ceiling on both stores (L379-L419), the store blip at admission time (L430-L483; this is a different path from the matrix's post-model credit failure), rewrite ledger endings (L572-L640), the chunked body cap (L642-L674), the stalled rewrite timing out (L676-L694), the classifier credited once on every ending (L802-L924), the mid-call 402 (L926-L975), the report route and its content-free log (L977-L1093), and the separate probe pool (L1131-L1153).

### server/test/admission.suite.ts (590 lines, NEW) — KEEP-FIX

- [RED-GREEN-ARTIFACT] `eq('the probe cap defaults to a small fixed number…', DEFAULT_MAX_CONCURRENT_PROBES, 2)` (admission.suite.ts:L148) — DELETE. It checks a constant against its own literal, and config.suite.ts:35 pins the same default.
- [DUPLICATE] "a raised cap of 15 admits 15 devices" (L138-L143) — DELETE. It's the cap-3 case (L118-L128) with a bigger number.
- [low value] "a non-positive-integer cap is refused at construction" (L174-L196) — DELETE. `config.ts:133-139` already reads every cap through `readPositiveInt`. This guard only catches a programmer passing NaN in code.
- [CHANGE-DETECTOR] `DESIGN_HINTS` table and `eq('hint is the design table's user-facing text', …)` (L249-L258, L295), plus the hint strings in the slot mapping (L318-L326) — KEEP-FIX. The table is a verbatim copy of `REFUSAL_HINTS`, so it catches copy edits and nothing else. Keep the stronger "hint is free of internal identifiers" check (L296-L297), status, code, Retry-After and the builder completeness check.
- [CHANGE-DETECTOR] `runVerifier` deep-equals the exact hint sentences (L337-L353) — KEEP-FIX. Assert `ok`, `status`, `error`, and a non-empty hint.
- Keep: slot basics, idempotent and stale-handle release, one-way drain (L103-L241), the Retry-After math at the midnight boundaries (L305-L311), and all of the operator credit tests (L395-L568): TTL, fail-open, in-flight sharing, the invalidation race, and the real transport URL and auth.

### server/test/routes-generate.suite.ts (1208 lines, NEW) — KEEP-FIX

This is the strongest file in the slice. It observes behaviour at the boundaries (HTTP status, refusal body, Retry-After, slot counts, ledger rows, raw SQLite bytes) and bounds every wait.

- [DUPLICATE] `for (const cap of [3, 15])` (routes-generate.suite.ts:L656) — MERGE to a single cap. The second pass repeats the first.
- [slow] 500 fresh devices against a ceiling of 400 (L701-L719) — KEEP-FIX. The same property ("rotating ids cannot bypass the ceiling") holds with a ceiling of 3 and 5 devices, which is how routes-unary.suite.ts:L390-L415 tests it.
- `expectRefusal` checks `ServiceRefusalCode.safeParse(error)` and then `eq(error, code)` (L496-L497). The first check adds nothing. Trivial.
- Keep everything else: credit first (L535-L579), size and validation first (L581-L598), slot and unit order (L600-L649), daily limit, rollover and ceiling, policy outcomes, single teardown on every ending, abort suppression, settlement recovery against real SQLite, expiry and drain, the mid-run 402, cost reconciliation, the store blip, and the data-directory scan.

### server/test/SPEC.md (147 lines, OLD) — DELETE

It says "The acceptance suite implements exactly these assertions", which is no longer true. §2.2 says server deps are exactly three packages (the suite now pins seven), §5 describes the stub pipeline as the product path, and §7.5 says "no route mounts" the OpenRouter wrapper. The live specs in `openspec/specs/` are the source of truth. A stale test plan that claims exactness misleads anyone who reads it.

### server/test/fixtures/model/*.json (14 lines, OLD) — DELETE

Only prompts.suite.ts's `testScriptedModelClient` reads these (see above).

### server/test/scripted-model.ts (136 lines, OLD) — KEEP-FIX

`noNetworkTransport` (L126-L136) is used only by the META check at prompts.suite.ts:L110-L124. Delete it along with that check. The rest of the file is the double every suite relies on.

## Keep

- server/test/disconnect.suite.ts (NEW) — KEEP. Real TCP disconnects for generate and clarify, the one place `@hono/node-server`'s own close path is proven to reach the pipeline, slots and ledger. (L169's elapsed-time check is redundant with the `waitFor` bound before it. Harmless.)
- server/test/source-block.suite.ts (NEW) — KEEP.
- server/test/e2e-drain-server.ts (NEW) — KEEP.
- server/test/e2e-fixtures.ts (NEW) — KEEP.
- server/test/e2e.run.mjs (CHANGED) — KEEP.
- server/test/acceptance.ts (CHANGED) — KEEP.
- server/test/run.mjs (OLD) — KEEP.
- server/test/sse-reader.ts (OLD) — KEEP.
- server/test/harness.ts (OLD) — KEEP (see Incidental).

## 3. Patterns

1. **Duplication across suites, about 14 cases.** Each generation of the server (skeleton, wire-v2, public-generation-server) re-tested properties the next generation tested more strongly, and nobody deleted the older copy. Examples: the device gate is tested four times (server-core L95-L138, wire-v2 L173-L197, admission L333-L359, routes-unary L1061-L1068), cancel-stops-events three times, and invalid body → 400 three times. Representative example: server-core.suite.ts:L450-L534 re-proves "no events after cancel" with a stub pipeline and a patched global `setTimeout`, while routes-generate.suite.ts:L821-L834 proves it against a pipeline that ignores its abort signal.
2. **Schema and constant restatement (RED-GREEN-ARTIFACT/PLATFORM), about 55 checks.** zod "accepts X" checks in contract.suite and wire-v2 `testContractShapes`, `ServiceRefusalCode accepts …` ×7, `DEFAULT_MAX_CONCURRENT_PROBES === 2`, `FIELD_TYPES.length === 6`, `maxTokens === 48` twice. These are what the "red first" rule produced: the check was red only because the declaration didn't exist yet. Representative: contract.suite.ts:L325-L335.
3. **Copy pins (CHANGE-DETECTOR), about 30 checks.** Refusal hints copied verbatim from `REFUSAL_HINTS`, verifier hint sentences, full prompt-instruction sentences, a hardcoded brand palette, sdk-reference phrasing. Representative: admission.suite.ts:L249-L258 plus L295, a second copy of the hint table.
4. **Tests of test doubles and dev stubs (META/TAUTOLOGY), about 9 groups.** The stub pipeline's event order, stub clarify determinism, stub policy markers, the ScriptedModelClient protocol, `noNetworkTransport`, the fake classifier that refuses whatever it's told to, `assembleRecord` returning the manifest it was handed. Representative: policy.suite.ts:L300-L305, where the double decides the verdict under test.
5. **Fixed sleeps and wall-clock windows (TIMING), 7 sites.** server-core L625 and L677 (50 ms), L516 and L525 (5 ms and 300 ms); e2e.ts L950 (150 ms), L391 and L400 (`< 8000`); routes-unary L1128 (2 s window); policy L113 (an unref'd-timer await). Representative: e2e.ts:L949-L952, which flakes when three runs haven't taken their slots within 150 ms.

## 4. Incidental

- `server/src/generation/reconcile.ts` is dead production code. Nothing under `server/src` imports it. knip keeps it alive only because `server/test/**` is an entry and e2e.ts imports it. Its header still lists `app.ts`, `main.ts` and `routes/generate.ts` as import sites.
- `server/test/harness.ts` tallies checks itself and never delegates to `node:assert`, contrary to the CLAUDE.md "Test assertions" rule. Sonar's S2699 can't recognise any server check as an assertion.
- The run-stage containment adapter tests (e2e.ts:L114-L254) run only in gate-full, although they need no browser.
- `disconnect.suite.ts` imports its doubles (`RecordingUsageStore`, `ControlledModelClient`, `within`, `waitFor`) from `routes-generate.suite.ts`, so one suite file doubles as another's helper library.
