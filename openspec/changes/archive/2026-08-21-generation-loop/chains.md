# Context chains: generation-loop

<!--
  HARD EXTERNAL PRECONDITION for every chain below: `synthetic-run-harness` must be FULLY
  merged (its chain-5 assembles the `RunReport` this pipeline consumes, and adds its own
  `checks/contract.ts` kind entries). The dispatcher MUST NOT start any chain of this change
  before that. See design.md D8.

  Dependency order (dependency-free chains run in parallel):
    wave 1: chain-1 ∥ chain-2
    wave 2: chain-3 ∥ chain-4
    wave 3: chain-5 → chain-6 → chain-7
-->

## chain-1: contract-wire-shapes

- tasks: 1.1–1.4
- rationale: three additive edits to one file (`contract/src/index.ts`) plus their round-trip tests in one
  suite file — the smallest possible unit, and the shape every later chain quotes
- reads: specs/generation-contract/spec.md §Generation request and rewrite shapes, §Structured API error
  body; handoff: none
- writes-contract: handoff/wire-shapes.md (the optional-`source` and `appliedSchema` semantics, the
  `ApiError` shape, and the `DeviceIdError` relationship)

## chain-2: model-client-and-prompts

- tasks: 2.1–2.7
- rationale: the LLM seam, the offline scripted client, and prompt assembly share one vocabulary and one
  directory (`server/src/generation/{model.ts,prompts/}` + `server/test/{scripted-model,prompts.suite,fixtures/model}`);
  none of it needs the wire delta, so it runs beside chain-1
- reads: specs/generation-pipeline/spec.md §Every model call goes through an injectable client, §The API key
  is environment-held, §Prompt assembly has one source of truth per input; design.md D3, D10; handoff: none
- writes-contract: handoff/model-client.md (client/roster/stream interfaces, scripted-client protocol,
  prompt-builder signatures)

## chain-3: device-seam

- tasks: 3.1–3.7
- rationale: everything the device must supply to the pipeline — the pure floor helper and the
  side-effect-free applied-schema read in the storage engine, the `source.ts` artifact in `StoreAccess`, and
  the one request builder that consumes both. Entirely under `src/host/**`, disjoint from every server-side
  chain, so it never contends for a file
- reads: specs/linked-apps/spec.md §Generation reads the group's accumulated schema…, §New fields in a
  shared group are allocated above the group's floor; specs/storage-schema-evolution/spec.md (both
  requirements); specs/mini-app-versioning/spec.md §A snapshot carries the original source…; design.md D13,
  D14; handoff: handoff/wire-shapes.md
- writes-contract: handoff/device-seam.md (floor-helper and applied-schema-read signatures, source-artifact
  name and reader semantics, request-building rules)
- after: chain-1

## chain-4: plan-and-state-machine

- tasks: 4.1–4.6
- rationale: the plan parser/validator, the machine, and its event emitter are one working context under
  `server/src/generation/{plan.ts,machine.ts}` and one suite; it compiles against fake stages only, so it
  needs nothing from chain-3 and runs beside it
- reads: specs/generation-pipeline/spec.md §The pipeline is a bounded state machine, §Stage events narrate
  the machine…, §Exactly one terminal event…, §The plan is structured and validated against the request,
  §Repair asks for a minimal diff…, §Cancellation aborts the pipeline at every boundary; design.md D4, D5,
  D6, D11; handoff: handoff/model-client.md
- writes-contract: handoff/pipeline-machine.md (deps object, injected stage interfaces, `RunTrace`, event
  ordering contract, budget semantics)
- after: chain-2

## chain-5: checks-build-and-record

- tasks: 5.1–5.7
- rationale: the two additive kinds, the allocation-floor rule in `checks/passes/schema-check.ts`, and the
  three server-side stage modules that consume the checker and the builder — one vocabulary
  (`CheckReport` → diagnostics → `WireAppRecord`) and no file shared with chain-3 or chain-4
- reads: specs/static-checks/spec.md §The schema check reuses the storage engine's pure functions, §The kind
  vocabulary grows additively for the generation loop; specs/generation-pipeline/spec.md §The check stage
  gates before anything executes, §The delivered app record is harness-validated, §Generation allocates
  burned field IDs above the accumulated floor, §An edit without original source regenerates honestly;
  design.md D12, D13; handoff: handoff/device-seam.md, handoff/pipeline-machine.md
- writes-contract: handoff/stage-contracts.md (check/build/record signatures and the diagnostic mapping)
- after: chain-3, chain-4

## chain-6: run-stage-and-cancellation

- tasks: 6.1–6.6
- rationale: the synthetic-harness adapter, the harness's own signal threading, post-abort reconciliation,
  and the browser-backed end-to-end suite are the one part of this change that needs Chromium — kept
  together so exactly one chain carries that cost and one implementer holds that context
- reads: specs/generation-pipeline/spec.md §The run stage is the synthetic harness, and containment failure
  is terminal, §Cancellation aborts the pipeline at every boundary, §Aborted runs reconcile their
  authoritative usage; specs/generation-server/spec.md §Blocking server suite in CI; design.md D8, D9, D15;
  handoff: handoff/pipeline-machine.md, handoff/stage-contracts.md; plus the merged synthetic-run-harness
  interfaces (`handoff/harness-core.md`, `handoff/observe-api.md`, `handoff/capability-trace.md`)
- writes-contract: handoff/run-stage.md (run-stage and reconciliation signatures, session lifecycle,
  containment/truncation policy)
- after: chain-5
- **HUMAN-BOOTSTRAP touchpoint (task 6.5 only)**: the browser-backed suite needs one `package.json` scripts
  entry and one `gate-full.sh` invocation line — both Class-2, agent-blocked. The implementer writes the
  suite and its runner, and records the two exact lines in `pending-class2.md`; a human applies them.
  Everything else in this chain is dispatchable.

## chain-7: server-wiring-and-acceptance

- tasks: 7.1–7.7
- rationale: the composition root and the three route/entry files are the last layer over everything merged
  before it, plus the docs and the attended acceptance — one context, and the only chain that touches
  `server/src/{app,main}.ts` and `server/src/routes/**`
- reads: specs/generation-server/spec.md §SSE generation endpoint over the real generation pipeline,
  §Rewrite endpoint over the real rewrite model, §Client disconnect aborts the pipeline, §OpenRouter client
  wrapper, §Blocking server suite in CI; specs/generation-contract/spec.md §Structured API error body;
  design.md D1, D2, D5, D9, D15; handoff: handoff/wire-shapes.md, handoff/model-client.md,
  handoff/pipeline-machine.md, handoff/stage-contracts.md, handoff/run-stage.md
- writes-contract: none
- after: chain-6
- note: task 7.6 is **attended, on-device, human-run** — it is recorded as PENDING at merge and updates the
  decision entry's status tag once performed, exactly as #48/#52/#53 did. It does not block the chain's gate.
