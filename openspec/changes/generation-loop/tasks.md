## 1. Wire contract

- [x] 1.1 In `contract/src/index.ts`, make `GenerateRequest.app.source` optional and add
      `GenerateRequest.app.appliedSchema` (optional record — the storage group's accumulated `_meta`
      union), with doc comments stating the #52-D5 sourcing rule and that an absent `source` means "the
      device has no original TypeScript for this app".
- [x] 1.2 Add `ApiError = { error: string, hint: non-empty string }` to the contract, documented as the
      shape every non-SSE `/v1/*` error body validates against, with `DeviceIdError` noted as its
      closed-enum specialization (routes are converted in chain 7).
- [x] 1.3 Extend `server/test/contract.suite.ts`: `GenerateRequest` parses with and without `app.source`;
      `appliedSchema` round-trips; `ApiError` accepts a `DeviceIdError` value and rejects an empty `hint`;
      the `GenerationEvent` union still rejects an unknown `type` and still has no `rewrite` stage member.
- [x] 1.4 Write `handoff/wire-shapes.md` — the three shape changes verbatim, and the absent-source /
      absent-appliedSchema semantics the device and pipeline both rely on.

## 2. Model client and prompt assembly

- [x] 2.1 `server/src/generation/model.ts`: `ModelClient` / `ModelRequest` / `ModelStream` interfaces and
      `ModelRoster` (per-role model ids read from the environment, no id literal in any call site), plus
      `openRouterModelClient(client)` adapting the existing wrapper.
- [x] 2.2 `server/test/fixtures/model/` + `server/test/scripted-model.ts`: a `ScriptedModelClient` that
      replays recorded turns in order, asserts the role each turn was requested for, and exposes the
      requests it received; plus a `noNetworkTransport` that throws on any request to the provider host.
- [x] 2.3 `server/src/generation/prompts/inputs.ts`: load `docs/sdk-reference.md` from disk (resolved from
      cwd, overridable by `WHIM_SDK_REFERENCE_PATH`) and the curated few-shot list from `fixtures/*.app.tsx`,
      excluding `latency-probe.app.tsx`; fail loudly with an actionable error if an input is missing.
- [x] 2.4 `server/src/generation/prompts/index.ts`: message builders for the rewrite, plan, generate, and
      repair turns, each taking an explicit context object (request, plan, current source, diagnostics
      ordered errors-first, and a pre-computed `schemaContext` string) and returning provider-agnostic
      messages.
- [x] 2.5 `server/test/prompts.suite.ts` tripwires: every runtime value export of the `vc-sdk` barrel appears
      in `docs/sdk-reference.md`; every curated few-shot fixture yields a zero-diagnostic `CheckReport`; no
      builder emits an empty required section; no model id appears as a literal in `server/src/generation/`.
- [x] 2.6 Add the missing `nav` section (`nav.navigate(screen)`, `nav.back()`, depth semantics) to
      `docs/sdk-reference.md` — the first red of task 2.5's export tripwire.
- [x] 2.7 Write `handoff/model-client.md` — the client/roster/stream interfaces, the scripted-client
      protocol, and the prompt-builder signatures.

## 3. Device seam

- [x] 3.1 `src/host/storage-engine/schema.ts`: export a pure `burnedIdFloor(applied)` returning each
      collection's maximum ordinal across active **and** retired columns (absent collection ⇒ no floor),
      importable without the native-binding barrel; cover it in `storage:test`.
- [x] 3.2 Add a side-effect-free read of a database's accumulated `_meta` union: applies no artifact, runs
      no DDL, does not create a missing database, returns `emptyApplied()` when there is none; cover in
      `storage:test` that reading leaves `_meta`, tables, and rows unchanged.
- [x] 3.3 `src/host/launcher/store-access.ts`: add the `source.ts` snapshot artifact — `InstallSpec` and
      `UpdateSpec` carry the original source, `install`/`update` write it, and the source reader returns it
      or reports absence instead of aliasing `activeBundle`.
- [x] 3.4 Update every `InstallSpec`/`UpdateSpec` construction site (launcher delivery and the first-run
      seed path) to supply the original source, keeping legacy entries working untouched.
- [x] 3.5 `LauncherRoot.buildGenerateRequest`: send the original TypeScript when the snapshot has it and
      omit `app.source` when it does not; source `app.appliedSchema` from the live database for
      `access.engineAppId(entry)`, never from `entry.record.schemaArtifact`.
- [x] 3.6 New `src/host/launcher/test/generation-request.suite.ts`, registered in the launcher acceptance
      list: legacy entry omits source; a grouped entry ships the union containing the other member's fields;
      a fork with shared data inherits the founder's union; a brand-new app ships no `app` at all.
- [x] 3.7 Write `handoff/device-seam.md` — the floor helper and applied-schema read signatures, the source
      artifact name and reader semantics, and the request-building rules.

## 4. Plan and state machine

- [ ] 4.1 `server/src/generation/plan.ts`: the internal `Plan` shape, a fenced-block-tolerant parser for the
      model's JSON skeleton, and `validatePlan(plan, request)` returning structured, quotable failure
      reasons (initial ∈ screens, unique non-empty names, known capabilities, storage keys imply the storage
      capability, no capability dropped that the supplied applied schema requires).
- [ ] 4.2 `server/src/generation/machine.ts`: the state machine — states, transitions, the plan-attempt and
      repair-attempt budgets (defaults 2 and 3, both injectable), the warnings-only sub-budget, and an abort
      check at every boundary.
- [ ] 4.3 The event emitter: `stage` start/done pairs with `attempt` propagated onto the repair round's
      `repair`/`check`/`run` events, `token` deltas during generate and repair, `diagnostic` events as
      findings occur, exactly one `usage` event immediately before exactly one terminal event, and no
      terminal event on abort.
- [ ] 4.4 Declare the injected stage interfaces (`CheckStage`, `BuildStage`, `RunStage`, `Clock`) and the
      `RunTrace` out-parameter here, so the machine compiles and tests against fakes with no concrete
      dependency.
- [ ] 4.5 `server/test/machine.suite.ts` with fake stages: happy path; repair-then-success; repair-cap
      exhaustion (4 candidates, 3 repair pairs, `attempts: 4`); plan re-ask then failure; warnings-only
      one-repair-then-deliver; containment failure short-circuit; abort at each boundary; exactly-one-terminal
      and no-terminal-on-abort assertions; a stage throwing still yields one `failure`.
- [ ] 4.6 Write `handoff/pipeline-machine.md` — the deps object, the stage interfaces, `RunTrace`, the event
      ordering contract, and the budget semantics.

## 5. Check stage, allocation floor, and app record

- [ ] 5.1 `checks/contract.ts`: additively add `id_below_floor` and `build_failure` to the central kind list.
- [ ] 5.2 `checks/passes/schema-check.ts`: when an applied schema is supplied, flag any introduced field ID
      at or below its collection's burned-ID floor as `id_below_floor` with a hint naming the next free ID;
      extend `checks:test` with the gap case (`f1`,`f5` applied, candidate adds `f3`), the retired-column
      case, the clean above-floor case, and an unknown-collection case.
- [ ] 5.3 `server/src/generation/stages/check.ts`: run the checker with the request's applied schema, map
      the report to the stage result (errors block, warnings recorded), and forward every diagnostic; include
      the source pre-flight (parse gate + default-exported `defineApp`) that treats an unparseable supplied
      `app.source` as absent.
- [ ] 5.4 `server/src/generation/stages/build.ts`: build the candidate through the harness's
      production-pinned builder and map a builder throw to a `build_failure` error diagnostic with an
      actionable hint.
- [ ] 5.5 `server/src/generation/record.ts`: assemble `WireAppRecord` from the check report's extracted
      manifest and schema plus the built bundle and source map — one extraction, no re-parse, no
      model-restated manifest.
- [ ] 5.6 `server/test/stages.suite.ts`: check-stage severity mapping; pre-flight rejects compiled bundle
      text; build failure becomes `build_failure`; record assembly matches the extracted manifest and not
      the model's prose; a record is never assembled from a report carrying an error.
- [ ] 5.7 Write `handoff/stage-contracts.md` — the check/build/record signatures and the diagnostic mapping.

## 6. Run stage and cancellation

- [ ] 6.1 `synthrun`: add `RunOptions.signal?: AbortSignal`, threaded so an abort kills the page, disposes
      the context, and releases the semaphore slot on the same path the total-budget watchdog already uses;
      cover it in the harness's own suite.
- [ ] 6.2 `server/src/generation/stages/run.ts`: the harness adapter — one session per pipeline, per-run
      slot, `RunReport` → diagnostics, `contained === false` → immediate terminal failure consuming no
      repair attempt and feeding nothing back, `truncated` → not a pass.
- [ ] 6.3 `server/src/generation/reconcile.ts`: post-abort usage reconciliation — injectable transport,
      bounded attempts and total time budget, quiet give-up, credits through the existing `UsageStore`, no
      new persistence.
- [ ] 6.4 `server/test/e2e.ts` (+ its runner): the browser-backed end-to-end suite — one honest
      corpus-shaped candidate through the real check, build, and run stages to a `result` whose bundle is
      byte-identical to the production build; one escape-attempting candidate to a containment `failure`;
      one cancellation mid-run asserting the context is disposed and the slot released.
- [ ] 6.5 Record the Class-2 bootstrap in `pending-class2.md` — **HUMAN-BOOTSTRAP**: the exact
      `package.json` script line for the new browser-backed suite and the exact `gate-full.sh` invocation
      line. No agent applies either.
- [ ] 6.6 Write `handoff/run-stage.md` — the run-stage and reconciliation signatures, the session lifecycle
      the composition root owns, and the containment/truncation policy.

## 7. Server wiring and acceptance

- [ ] 7.1 `server/src/generation/index.ts`: `createGenerationPipeline(deps)` implementing `Pipeline`,
      composing the machine with the real model client, checker, builder, and run session; roster and
      `OPENROUTER_API_KEY` read from the environment at construction, with a typed actionable error naming
      the variable when the key is absent.
- [ ] 7.2 `server/src/routes/rewrite.ts`: real rewrite through the model client and the roster's rewrite
      model, metered through the `UsageStore`, `502` + `ApiError` on model failure, never returning the
      input prompt as a rewrite.
- [ ] 7.3 `server/src/routes/generate.ts` and `app.ts`: thread `RunTrace` into `Pipeline.run`, schedule
      reconciliation on the abort path, keep `interceptUsage` as the sole normal-path crediting authority,
      and convert every route error body to `ApiError`.
- [ ] 7.4 `server/src/main.ts`: wire the real pipeline by default and keep the stub reachable behind
      `WHIM_PIPELINE=stub` for LAN UI work; launch the run session once per process and close it on
      shutdown.
- [ ] 7.5 `server/test/acceptance.ts`: register the new suites, assert the whole deterministic suite passes
      with `OPENROUTER_API_KEY` unset and the no-network transport installed, and assert the fast suite
      launches no browser.
- [ ] 7.6 **Attended, on-device (PENDING at merge)**: real device on the LAN against a real key — generate
      an app end to end and install it; then kill the app mid-generation and confirm the server observes the
      abort (closing the roadmap's cancellation carryover (a)) and that the reconciled usage lands in
      `/v1/usage`.
- [ ] 7.7 Add the `generation-pipeline` row to `docs/capabilities.md` and append this change's entry to
      `docs/decisions.md` (the resolved D-list, the two carryovers, and the recorded warnings-delivery
      divergence).
