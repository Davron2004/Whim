# Proposal: generation-loop

## Why

Whim's whole pitch — say what you want, get a working app — currently ends at a stub. `POST /v1/generate`
streams canned events from `createStubPipeline`, `POST /v1/rewrite` returns a string transform, and the
finished OpenRouter wrapper sits unmounted with a comment naming this change as the thing that wires it.
Every other piece the loop needs now exists: the wire contract (#8), the pure static checker (#9), the
synthetic run harness (#10), the SDK reference and component kit (#3/#4), and the device-side prompt flow
(#7) that already renders `plan`/`generate`/`check`/`run`/`repair` stage events it has never actually
received. This change is the keystone that connects them: the orchestrated pipeline that turns a prompt
into a harness-validated app record.

Three recorded obligations also come due here. Decision #52 D5 ("recorded here, enforced when #11 is
proposed") requires generation to source `appliedSchema` from the live engine's accumulated `_meta` union
for storage-group entries and allocate burned field IDs past its maximum. Decision #53 D7 records that the
device re-sends *compiled bundle text* as `GenerateRequest.app.source` and says #11 "must either track a
`source.ts` artifact by then or accept this" — a real engineer model cannot minimally edit an IIFE, so it
must be fixed. And `server-cancellation`'s two carryovers (LAN abort acceptance, post-abort usage
reconciliation) land with the pipeline that makes them meaningful.

## What Changes

- **A bounded pipeline state machine** replaces the stub behind the unchanged `Pipeline` interface:
  `plan → generate → check → run` with a `repair` loop capped at **3 repair attempts** (4 candidates
  total), a separate cap of **2 plan attempts**, and an abort check at every state boundary. It emits
  `stage` start/done pairs carrying `attempt`, streams `token` deltas during generate and repair, forwards
  every diagnostic as a `diagnostic` event, and always ends a completed stream with exactly one terminal
  `result` or `failure`.
- **Every LLM call goes through an injectable `ModelClient`.** The OpenRouter wrapper becomes one adapter;
  the deterministic suites run a `ScriptedModelClient` over recorded turn fixtures. **No suite ever reaches
  the network** — a guard transport throws on any `openrouter.ai` request, and the offline suite passes with
  `OPENROUTER_API_KEY` unset. Model ids stay caller parameters sourced from env (`#42`), never embedded.
- **Prompt assembly with one source of truth**: the system prompt is built from `docs/sdk-reference.md`
  (loaded from disk, not copied into code), the token vocabulary it already documents, and a curated set of
  `fixtures/*.app.tsx` few-shot examples. Two tripwires keep it honest — every `vc-sdk` runtime export must
  appear in the reference, and every few-shot fixture must pass `runStaticChecks` with zero diagnostics.
  Fixing the first tripwire's red adds the missing `nav` section to `docs/sdk-reference.md`.
- **A structured plan, validated against the request** before any code is generated: screens, initial
  screen, state, capabilities, and storage keys, cross-checked for internal consistency and against the
  request's own constraints. An invalid plan is re-asked once, then fails honestly.
- **The check stage** runs the pure checker (#9) with the device-supplied `appliedSchema`; **the run stage**
  runs the synthetic harness (#10) against the built candidate. A `contained: false` verdict is a
  **terminal failure that is never repaired** — the loop does not teach a model to iterate on escape
  attempts.
- **The delivered `WireAppRecord` is harness-validated**: its `manifest` and `schema` come from the check
  report's statically extracted `defineApp` argument (no second source of truth, #41), its `bundle` and
  `sourceMap` from the production esbuild contract. This closes #41's deferred "later: harness-validated".
- **#52 D5 enforced end to end.** `GenerateRequest.app` gains `appliedSchema`; the device sources it from
  the live engine's accumulated `_meta` (a new read-only peek that applies no artifact), never from the
  app's snapshot artifact; the prompt states the per-collection burned-ID floor; and the static checker
  gains an `id_below_floor` diagnostic so an under-floor allocation is caught and repaired, not shipped.
- **#53 D7 closed.** Snapshots gain a `source.ts` artifact, so the edit flow re-sends original TypeScript.
  `GenerateRequest.app.source` becomes **optional** for pre-existing installs that have none; the pipeline
  then regenerates under the supplied manifest and applied schema instead of pretending it has source. The
  server additionally pre-flights any supplied source through the parse gate and treats an unparseable one
  as absent — it never feeds compiled output to the model as "your current code".
- **Rewrite becomes a real small-model call** behind the same `/v1/rewrite` endpoint, metered through the
  existing `UsageStore`, with a structured error body on model failure. It stays a unary endpoint — the
  `GenerationEvent.stage` enum is not widened.
- **Cancellation aborts mid-pipeline cleanly and reconciles usage.** The signal is honored at every stage
  boundary, forwarded to the model transport, and threaded into the synthetic run. On abort the server
  polls OpenRouter's generation-stats endpoint for authoritative post-abort token counts and credits them —
  **BREAKING (behavioral)**: a cancelled stream no longer credits nothing.
- **Test surface**: the fast deterministic suite (`server:test`) covers the machine, stages, prompts, and
  contract with fakes and no Chromium; one new Chromium-backed end-to-end suite exercises the real
  check/build/run path against a scripted model. That new suite needs one `package.json` script and one
  `gate-full.sh` line — recorded as HUMAN-BOOTSTRAP, not applied by an agent.

## Capabilities

### New Capabilities
- `generation-pipeline`: the orchestrated, bounded, offline-testable generation state machine — stages and
  their order, repair bounds, plan validation, model-client injection, prompt assembly, harness-validated
  app-record assembly, cancellation semantics, and the burned-ID allocation floor.

### Modified Capabilities
- `generation-contract`: `GenerateRequest.app.source` becomes optional and `app.appliedSchema` is added; a
  shared `ApiError` body replaces the ad-hoc `{error, hint}` JSON the routes emit today.
- `generation-server`: the real pipeline and the real rewrite replace their stubs; the OpenRouter wrapper is
  mounted; cancellation gains usage reconciliation; the blocking CI suite grows a Chromium-backed lane.
- `static-checks`: the schema pass gains the monotone burned-ID allocation floor (`id_below_floor`) when an
  applied schema is supplied.
- `linked-apps`: the #52 D5 allocation contract stops being a recorded intention and becomes an enforced
  requirement, including where the device sources `appliedSchema` from.
- `mini-app-versioning`: a snapshot carries the original TypeScript source alongside its bundle.
- `storage-schema-evolution`: the accumulated `_meta` union is readable without applying an artifact.

## Impact

- **Server (`server/`)**: new `src/generation/` subtree (machine, plan, stages, prompts, record, model
  client, reconciliation); `routes/generate.ts`, `routes/rewrite.ts`, `app.ts`, `main.ts` rewired; new test
  suites. `server/package.json`'s declared dependency set is unchanged — `checks/` and `synthrun/` are
  repo-root libraries reached by relative import, the existing `contract/src/index.ts → ../../checks/contract`
  precedent.
- **Contract (`contract/`)**: three additive schema edits; still zod-only, still Metro-safe.
- **Checker (`checks/`)**: two additive `DIAGNOSTIC_KINDS` entries (`id_below_floor`, `build_failure`) and
  one new schema-pass rule.
- **Harness (`synthrun/`)**: `RunOptions` gains an `AbortSignal` honored by the run.
- **Device (`src/host/`)**: storage engine gains a pure burned-ID floor helper and a read-only applied-schema
  peek; `StoreAccess` gains the `source.ts` artifact; `LauncherRoot.buildGenerateRequest` sources source and
  applied schema correctly.
- **Docs**: `docs/sdk-reference.md` gains its missing `nav` section; `docs/capabilities.md` gains the new
  capability row; `docs/decisions.md` gains this change's entry at closure.
- **Runtime/sandbox/CSP/bridge**: unchanged. No new npm dependency.
- **Operational**: the server now needs Chromium (via the existing `playwright` dev dependency) and an
  `OPENROUTER_API_KEY` in its environment to serve real generations; neither is required by the gate.
- **Depends on** `synthetic-run-harness` being fully merged (its chain-5 assembles the `RunReport` this
  pipeline consumes) and on `prompt-flow-ux` (already built) for the device flow.
