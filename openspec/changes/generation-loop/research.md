# Research digest: what does wiring the real generation pipeline (rewrite → plan → generate → check → run → repair) touch?

<!-- Composed from three `researcher` dispatches: (A) docs/spec.md §8/§9/§10.1/§13/§4.7 and the
     roadmap #11 brief; (B) the SDK-reference / prompt-material terrain; (C) the device-side seam
     (storage engine `_meta`, StoreAccess artifacts, GenerateRequest construction). Trimmed to the
     120-line cap; nothing recommends an approach. -->

## Relevant files
- `docs/v1-roadmap.md` §11 (lines 350–372) — the authoritative scope for this change, incl. the two `server-cancellation` carryovers (LAN abort acceptance; post-abort usage reconciliation).
- `docs/spec.md` §8.1 "The loop", §8.2 "Warning discipline", §10 two-stage prompt, §13 model strategy, §4.7 Model 1 — the thinking document (stale per #42; the live specs win).
- `openspec/specs/generation-contract/spec.md` — `GenerateRequest`, `GenerationEvent`, `Diagnostic`, `WireAppRecord`, `Usage`.
- `openspec/specs/generation-server/spec.md` — device-header gate, SSE framing, stub pipeline, cancellation, metering, the unmounted OpenRouter wrapper, the CI suite.
- `openspec/specs/static-checks/spec.md` + `checks/contract.ts` + `checks/index.ts` — `runStaticChecks(source, {appliedSchema, filename}) → CheckReport`, the closed `DIAGNOSTIC_KINDS` union, `ExtractedManifest`.
- `openspec/specs/harness-diagnostics/spec.md` — diagnostic shape, closed vocabulary, severity rules, no-suppression rule.
- `openspec/changes/synthetic-run-harness/specs/synthetic-run/spec.md` + `handoff/harness-core.md` + `handoff/observe-api.md` — the run stage this pipeline consumes (chains 1–3 of 5 merged at the time of writing).
- `server/src/{pipeline,openrouter,sse,app,main}.ts`, `server/src/routes/{generate,rewrite,usage}.ts`, `server/test/run.mjs` — the server as built.
- `docs/sdk-reference.md` — the prompt-ready SDK reference; `fixtures/*.app.tsx` — six candidate few-shot examples.
- `src/host/storage-engine/{schema,contract,engine}.ts`, `src/host/launcher/{store-access.ts,LauncherRoot.tsx,generation-client.ts}` — the device seam.

## Current behavior
`POST /v1/generate` validates `GenerateRequest`, opens an SSE stream, and drains a **stub** `Pipeline` that emits canned `plan → generate(+token) → check → run` stage pairs, a fixed `usage`, then a fixed `result` (or a `failure` on the `[[fail]]` magic token). `POST /v1/rewrite` returns a deterministic string transform — no model call. `server/src/openrouter.ts` is complete (streaming deltas, captured `Usage`, typed auth/rate-limit/network errors, injectable `fetch`, forwarded `AbortSignal`, generation `id` captured from the first chunk) but **no route imports it**. Usage is credited by the route (`interceptUsage`) into a `node:sqlite` `UsageStore`; that counter is the server's only persisted state. One `AbortController` per request is wired to both the `ReadableStream.cancel()` and `Request.signal` surfaces and threaded into `Pipeline.run(request, signal?)`.

`checks/` is a pure, execution-free library that already returns the extracted `defineApp` manifest on the report (including on failing reports) and already accepts an `appliedSchema` to run `diffSchemas` against. `synthrun/` boots a candidate in the unmodified production page with the real gate and returns a deterministic `RunReport`; its final report assembly is chain-5 of the in-flight `synthetic-run-harness` change.

On the device, `StoreAccess.activeSource()` is literally an alias of `activeBundle()` — a snapshot carries `bundle.js` (+ optional `schema.json`), never the original TypeScript. `LauncherRoot.buildGenerateRequest` (LauncherRoot.tsx:126–141) is the sole builder of `GenerateRequest.app`, filling `schema` from `editing.record.schemaArtifact`. The storage engine keeps its accumulated union in a `private applied: AppliedSchema` loaded from `_meta`; **no public read path exists** on the `StorageEngine` interface.

## Constraints and invariants
- `GenerationEvent` is a closed discriminated union; `stage ∈ plan|generate|check|run|repair` — **there is no `rewrite` stage**. Rewrite is a separate unary endpoint.
- Exactly one terminal event (`result` | `failure`) per stream that runs to completion, always last; an aborted stream ends with none, and that is not a conformance violation.
- Every `/v1/*` route is gated on a UUID `x-whim-device` header; `/healthz` is exempt.
- Model ids are always caller parameters, never embedded (#42 strong-first, downgrade-by-eval). `OPENROUTER_API_KEY` is env-only, gitignored `.env`, never required by the suite.
- Server state is the per-device token counter and nothing else (§4.7 Model 1). Prompts, source, bundles are never stored.
- Diagnostic `kind`s are a closed vocabulary owned by `checks/contract.ts`; downstream stages extend it **additively**, never by minting strings elsewhere, and reuse the runtime's name where one exists.
- `hint` is mandatory and non-empty on every diagnostic; `line` is mandatory for static diagnostics, optional for runtime ones.
- A report is `ok` only with zero diagnostics of any severity, and the checker API exposes no severity-threshold knob (harness-diagnostics req 3); there is no per-app or inline suppression (req 4).
- H1b bundle contract: one TS file importing only `vc-sdk`, IIFE, classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw:'{}'`. `synthrun/builder.ts` mirrors `build/build.mjs` field-for-field and is pinned byte-identical.
- Containment authority is the sandbox runtime; a green static report is necessary, never sufficient. The synthetic harness derives every failure-grade signal from trusted vantages only (F4).
- `invariants/`, `build/*`, `scripts/gate*.sh`, `package.json`, `.claude/**` are Class-2/owner-authored.
- Burned field IDs match `^[a-z]\d+$` (`BURNED_ID_RE`, storage-engine/contract.ts:72); additive-only evolution, IDs never reused. `emptyApplied`, `validateArtifact`, `diffSchemas` are pure and exported from `src/host/storage-engine/schema.ts`; **the storage-engine index barrel statically requires op-sqlite**, so off-device callers must import the submodules directly.
- Decision #52 D5: for an entry carrying `storageGroupId`, generation MUST source `appliedSchema` from the live engine's accumulated `_meta` union (never the app's own snapshot artifact) and allocate new burned IDs past the union's max. Divergent same-named fields under distinct IDs stay legal.
- Decision #53 D7: `activeSource` returns compiled bundle text; #11 "must either track a `source.ts` artifact by then or accept this."
- `@whim/contract` is imported **type-only** on the device (zod's `export *` breaks Metro/Babel); `generation-client.ts` hand-rolls structural guards mirroring the zod shapes.
- Repair cap is stated as "~3" in spec.md §8.1 and "≤ 3" in the roadmap; no decision pins an exact integer.
- `spec.md` has no literal `§8.1.1` heading — the roadmap's citation means item 1 ("Plan") of §8.1's numbered list: "a short structured plan first (screens, state, capabilities, storage keys) … cheap to validate ('asked for reminders, plan has no `notifications` capability → reject & retry')".

## Integration points
- `server/src/pipeline.ts` — the `Pipeline` interface (`run(request, signal?) → AsyncIterable<GenerationEvent>`) is the single seam a real pipeline must satisfy; `main.ts` constructs the implementation.
- `server/src/openrouter.ts` — `OpenRouterClient.stream(options) → { deltas, usage, id }`, ready to be wrapped.
- `checks/index.ts` — `runStaticChecks(source, { appliedSchema?, filename? })`.
- `synthrun/index.ts` — `SynthRunSession.launch/openRun/close`, `buildCandidateSource(source, {filenameHint}) → {js, map}`, `RunOptions {budgets?, appId?, beforeNavigate?}`, `RunReport {ok, diagnostics, contained, truncated, timings, trace, screens, budgets}`. `RunOptions` carries **no** `AbortSignal` today; the total-budget watchdog (`withTotalBudget`, default 45 s) is the only hard stop.
- `checks/contract.ts` `DIAGNOSTIC_KINDS` — the additive extension point for any new kind.
- `docs/sdk-reference.md` — the prompt surface; `fixtures/*.app.tsx` — few-shot candidates (`latency-probe.app.tsx` bypasses the SDK via a raw syscall and is pinned as an expected-flagged sample, not an honest one).
- Device: `StoreAccess.{install,update,activeBundle,activeSource,fork,engineAppId,remove}` (store-access.ts; the `bundle.js`/`schema.json` artifact names are inline literals at L106/L131/L143, no central list); `LauncherRoot.buildGenerateRequest` (L126); `src/host/launcher/test/acceptance.ts` (flat, hand-maintained suite registration).

## Risks and unknowns
- `docs/sdk-reference.md` **does not document `nav`** (`nav.navigate`/`nav.back`) even though it is a live `vc-sdk` export — prompt assembly built on the doc as-is would silently omit navigation. Its provenance is also unrecorded in the roadmap ledger (#3 still reads "unproposed"); I did not resolve which change authored it.
- No exported helper mints or reports burned-ID maxima anywhere in `src/host/storage-engine/`; I did not verify one exists outside it.
- `synthetic-run-harness` chain-5 (report assembly, `RunCandidate` implementation, the `checks/contract.ts` kind additions) was **not merged** at digest time; `handoff/capability-trace.md` did not exist. Only `harness-core.md` and `observe-api.md` are available interfaces.
- Whether `@hono/node-server` fires `Request.signal` on a real TCP disconnect is an untested external assumption — the deterministic suites drive only the `cancel()` surface.
- I did not trace `seed.ts`'s first-run install path in full; it may be a third `InstallSpec` construction site.
- I did not verify the full `AppRecord` shape in `src/host/bridge/contract` beyond the `manifest` / `schemaArtifact` fields.

## Open questions for the planner
1. Does the rewrite stage get its own `GenerationEvent.stage` entry, or stay a separate unary endpoint as built?
2. Is the "~3" repair cap an exact contract constant in this change, or a tunable parameter?
3. Does the pipeline receive the accumulated `AppliedSchema` from the device (requiring a new public engine read) or only ever diff against `emptyApplied()`?
4. Is `activeSource`'s "compiled bundle, not TS" limitation (#53 D7) fixed here or deferred again?
