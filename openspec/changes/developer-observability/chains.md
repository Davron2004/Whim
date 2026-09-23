# Context chains: developer-observability

Two chains aren't implementer work. chain-0 changes the production VM and chain-8 checks real
devices and a live deploy, so the orchestrator runs both attended with the owner. Two tasks are
HUMAN-BOOTSTRAP edits to `CONFIG_SET` files (3.4 `invariants/`, 7.1 `package.json`). The owner
commits each one into the base before its chain gates.

Parallel groups: {chain-0, chain-2, chain-3} have no dependencies. chain-1 follows chain-0;
chain-6 follows chain-1; chain-7 follows chain-6. chain-4 follows chain-2, and chain-5 follows
chain-7, and both are also blocked outside this change until GitHub #63's rewritten text is merged.

## chain-0: vm-log-shipping-spike (ATTENDED — production VM, not dispatchable)

- tasks: 1.1
- rationale: installs an agent on the live VM and decides between the Ops Agent and `gcplogs` (design D8). Every later log-shipping task depends on the answer, and an implementer in a worktree can't touch production.
- reads: design.md D8; specs/server-observability/spec.md §"Server logs reach Google Cloud Logging"; handoff: none
- writes-contract: handoff/log-shipping.md (the chosen path, the working agent config verbatim, and the Logs Explorer field paths for pino fields and severity)

## chain-1: server-log-shipping

- tasks: 1.2–1.4
- rationale: the pino severity formatter, the committed agent config and bootstrap step, and the Operating docs all describe the same log pipeline.
- reads: specs/server-observability/spec.md §"Server logs reach Google Cloud Logging"; design.md D8; handoff: handoff/log-shipping.md
- writes-contract: none
- after: chain-0

## chain-2: server-request-id-and-diagnostics-route

- tasks: 2.1–2.5
- rationale: one server layer. The contract additions, request-id middleware, ledger id and `failure_reason`, and the new route all go through `app.ts`, `usage-store.ts` and `@whim/contract`.
- reads: specs/server-observability/spec.md §"One request id follows a /v1 request everywhere", §"The ledger records a closed failure code"; specs/device-diagnostics/spec.md §"Only an allowlisted projection…" (field list and caps only), §"The diagnostics route validates, bounds and logs without storing"; design.md D2, D7, D9; handoff: none
- writes-contract: handoff/server-diagnostics.md (`WHIM_REQUEST_ID_HEADER` value, the `DiagnosticsBatch` type verbatim, the route's status codes and caps, the `scope: "device"` log line shape)

## chain-3: sandbox-error-capture

- tasks: 3.1–3.4 (3.4 HUMAN-BOOTSTRAP: owner adds the `invariants/` cases and commits them before this chain gates)
- rationale: containment-critical runtime code. The loader listeners and the host's handling of error frames are one path, verified by the same Chromium suites.
- reads: specs/device-diagnostics/spec.md §"Mini-app failures reach the seam as error records"; design.md D6; docs/spike2-findings.md (the five constraints); handoff: none
- writes-contract: none

## chain-4: device-diagnostics-upload (blocked on GitHub #63)

- tasks: 4.1–4.5
- rationale: all inside the device logging seam and its callers: the projection, the transport, the global handler and fatal slot, the request-id attachment, and the static check that locks the two exits.
- reads: specs/device-diagnostics/spec.md §"Only an allowlisted projection…", §"Error-level records are uploaded…", §"Uploads require a current AI-data consent grant", §"Uncaught host errors and fatal JS errors are captured"; specs/host-observability/spec.md (the modified sink requirement); design.md D2–D5, D7; handoff: handoff/server-diagnostics.md
- writes-contract: none
- after: chain-2; GitHub #63 merged. Its code doesn't need #63, but merging the upload before the disclosure check (chain-5) exists would leave `main` able to ship undisclosed diagnostics.

## chain-5: disclosure-coverage (blocked on GitHub #63)

- tasks: 5.1–5.3
- rationale: checks that #63's rewritten declarations cover diagnostics, and locks that coverage into the release checks. It can't start until #63's text is merged.
- reads: specs/device-diagnostics/spec.md §"What the app sends is disclosed wherever it is declared"; design.md D9, D11; #63's merged text; handoff: none
- writes-contract: none
- after: chain-7 (both edit the release tooling under `scripts/release/`; this order keeps source maps from waiting on #63)

## chain-6: alerts

- tasks: 6.1–6.3
- rationale: the committed Cloud Monitoring definitions, `provision.sh` applying them (plus the budget and source-map bucket), and the runbook entry for each alert.
- reads: specs/server-observability/spec.md §"The owner is alerted by email"; design.md D10; handoff: handoff/log-shipping.md (field paths the log-based alerts filter on)
- writes-contract: none
- after: chain-1 (shares `docs/deploy.md` and the deploy-config suite)

## chain-7: source-maps

- tasks: 7.1–7.3 (7.1 HUMAN-BOOTSTRAP: owner adds `metro-symbolicate` to `package.json` and commits it before this chain gates)
- rationale: the release flows produce and upload maps; the operator script consumes them.
- reads: specs/device-diagnostics/spec.md §"Release builds keep a source map for every shipped bundle"; design.md D12; handoff: none
- writes-contract: none
- after: chain-6 (creates the bucket)

## chain-8: live-verification (ATTENDED, not dispatchable)

- tasks: 8.1–8.2
- rationale: a production deploy, a real VM and real devices on both platforms; the owner is present.
- reads: all three spec files' scenarios; handoff: handoff/log-shipping.md, handoff/server-diagnostics.md
- writes-contract: none
- after: chain-1, chain-2, chain-3, chain-4, chain-5, chain-6, chain-7
