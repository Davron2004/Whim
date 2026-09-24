# Context chains: request-envelope

chain-6 runs live on production and real phones, so the orchestrator does it attended with the
owner. No chain touches a `CONFIG_SET` file: 3.1 adds a TurboModule without editing `package.json`.

Parallel groups: {chain-1, chain-3} have no dependencies. chain-2 follows chain-1; chain-4 follows
chain-1 and chain-3; chain-5 follows chain-2 and chain-4; chain-6 follows everything.

This change goes before `developer-observability`. That change's chain-2 and chain-4 read this
change's `handoff/envelope.md`.

## chain-1: server-envelope-and-request-id

- tasks: 1.1–1.6
- rationale: one server edge. The contract constants and codes, the request-id and envelope middleware, the ledger id, and the consent-practice table all sit around `app.ts`'s `/v1` mount and the admission path.
- reads: specs/request-envelope/spec.md (all requirements); design.md D1, D3, D6–D9; handoff: none
- writes-contract: handoff/envelope.md (the five header names and value formats verbatim, the legacy default, the middleware order, `ServiceRefusalCode`'s two new members with status and hint, the `PRACTICES` table shape and `permits()` signature, the request-line fields, and the `requestId` field on `ClientError` and results)

## chain-2: server-minimum-build

- tasks: 2.1–2.4
- rationale: the operator values, the gate middleware, the `/healthz` field and the runbook are one feature, all on the server and deploy side.
- reads: specs/app-update-gate/spec.md §"The server refuses builds below a per-platform minimum", §"Raising a minimum is a documented operator step"; design.md D4; handoff: handoff/envelope.md
- writes-contract: handoff/min-build.md (the `/healthz` `minBuild` shape and the refusal's status and code)
- after: chain-1 (both mount `/v1/*` middleware in `app.ts`)

## chain-3: native-app-info

- tasks: 3.1–3.3
- rationale: native code on both platforms plus the pure wrapper around it, verified on the emulator; nothing else touches these files.
- reads: specs/request-envelope/spec.md §"Every /v1 request carries the client envelope"; design.md D2; handoff: none
- writes-contract: handoff/app-info.md (the `app-info.ts` export and its failure behaviour)

## chain-4: device-envelope

- tasks: 4.1–4.3
- rationale: everything in the phone's transport layer: the options, the headers, reading the request id, and the refusal rules.
- reads: specs/request-envelope/spec.md §"Every /v1 request carries the client envelope", §"One request id follows a /v1 request everywhere", §"The refusal vocabulary gains the envelope's two codes", §"The phone's header names match the contract"; design.md D5 (only for the `update_required` landing), D6, D8; handoff: handoff/envelope.md, handoff/app-info.md
- writes-contract: handoff/refusal-routing.md (added at dispatch: how a refusal code reaches a screen, where `consent_required` is routed, and the exact hook chain-5 uses to route `update_required` to the update screen)
- after: chain-1, chain-3

## chain-5: update-screen

- tasks: 5.1–5.4
- rationale: the launcher screen, its store links, and the launch-time check that uses it.
- reads: specs/app-update-gate/spec.md §"The app shows an update screen that blocks AI features, not the app"; design.md D5; handoff: handoff/min-build.md, handoff/app-info.md, handoff/refusal-routing.md
- writes-contract: none
- after: chain-2, chain-4 (chain-4 adds the refusal rule this screen is routed from, and both edit launcher files)

## chain-1b: request-id-on-provider-lines (added at dispatch)

- tasks: the unmet part of 1.3/the request-id requirement: OpenRouter's "model call" line, the content-policy "check" line and the cost resolver's lines carry `requestId`
- rationale: chain-1 threaded the id through routes and the pipeline but stopped at the model, policy and summariser interfaces, which were outside its task wording.
- reads: specs/request-envelope/spec.md §"One request id follows a /v1 request everywhere"; design.md D6; handoff: handoff/envelope.md
- writes-contract: none
- after: chain-2 (both edit `server/`; serialized to keep file scopes disjoint)

## chain-7a: review-fixes-server (added after review)

- tasks: reviewer findings H1 (smoke accepts a `/healthz` without `minBuild` only when both minimums are `0`; rollback docs), L1 (duplicate `scope` on model-call lines), L2 (wire-v2 exact middleware count), L4 (in-memory ledger refuses duplicate ids), L5 (rewrite model-call `requestId` test), L6 (document the report exemption's ledger/log writes), L7 server half (de-duplicate `request-edge.suite` setup)
- reads: progress.md reviewer entry; handoff: envelope.md, min-build.md
- writes-contract: none
- after: chain-5

## chain-7b: review-fixes-phone (added after review)

- tasks: reviewer findings M2 (type errors in tsc-excluded launcher suites), L3 (phone version pattern equals the server's, lockstep-checked), L7 phone half (UI suite fixtures from real producers where cheap), M1 test rename to the amended scenario
- reads: specs/app-update-gate/spec.md (amended scenario); handoff: envelope.md, app-info.md, refusal-routing.md
- writes-contract: none
- after: chain-5 (runs in parallel with chain-7a; disjoint files: 7a owns `server/` and `deploy/`, 7b owns `src/`, `contract/`, `checks/`)

## chain-6: live-verification (ATTENDED, not dispatchable)

- tasks: 6.1–6.2
- rationale: a production deploy, TestFlight build 381237, new builds on both platforms, and a temporary minimum raise.
- reads: both spec files' scenarios; handoff: all
- writes-contract: none
- after: chain-1, chain-2, chain-3, chain-4, chain-5
