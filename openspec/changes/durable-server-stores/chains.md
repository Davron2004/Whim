# Context chains: durable-server-stores

## chain-0: bootstrap-deps-and-gate — HUMAN-BOOTSTRAP

- tasks: 1.1–1.3
- rationale: every edit is a `CONFIG_SET` file (`package.json`, `package-lock.json`, `scripts/gate-full.sh`, the CI workflow). The gate refuses to run while one differs from the base commit, so the orchestrator applies and commits these into the staging base before any chain is dispatched.
- edits (precise):
  - `server/package.json`: add the `@google-cloud/firestore` dependency at an exact version.
  - `package-lock.json`: regenerated.
  - Root `package.json`: add the `stores:firestore:test` script.
  - `scripts/gate-full.sh`: add one step running `npm run stores:firestore:test`.
  - `.github/workflows/<gate-full job>`: add `actions/setup-java` (temurin 21) before the gate.
- reads: design.md D5; specs/server-storage-backends/spec.md §"Every backend honours the same store contracts"; handoff: none
- writes-contract: handoff/bootstrap.md (script name, Firestore conformance entry path it expects, emulator project id, env it sets)

## chain-1: server-store-ports

- tasks: 2.1–2.5
- rationale: one layer (the store interfaces and everything that constructs or awaits them: `lifecycle.ts`, `config.ts`, the CLIs, the beta route). It ends with the conformance suite that defines the contract for every backend.
- reads: specs/server-storage-backends/spec.md §"The operator selects one durable backend for every server store", §"Every backend honours the same store contracts", §"Admission is atomic on every backend", §"Retention purges run identically on every backend"; design.md D1, D4, D5; research.md "Constraints and invariants"; handoff: handoff/bootstrap.md
- writes-contract: handoff/store-ports.md (the three async interfaces verbatim with `close()`, the `openStores` signature and its injected Firestore-opener seam, the conformance suite's factory parameter type and exported case list)
- after: chain-0

## chain-2: firestore-docs-stores

- tasks: 3.1–3.4
- rationale: the two simple Firestore stores plus the client, factory branch and conformance entry they need. These are the shared Firestore scaffolding the usage store builds on.
- reads: specs/server-storage-backends/spec.md §"The operator selects one durable backend for every server store", §"Records outlive every server instance on the Firestore backend", §"Every backend honours the same store contracts"; design.md D1, D3, D4, D8; handoff: handoff/store-ports.md, handoff/bootstrap.md
- writes-contract: handoff/firestore-scaffold.md (client construction and emulator handling, collection names and doc-id rules, the batched-delete helper, how the Firestore conformance entry registers a store)

## chain-3: firestore-usage-admission

- tasks: 4.1–4.5
- rationale: the ledger, counters and admission transaction share one data model (design D2/D3) and one set of invariants, and they must be reasoned about together.
- reads: specs/server-storage-backends/spec.md §"Admission is atomic on every backend", §"Retention purges run identically on every backend", §"Records outlive every server instance on the Firestore backend"; design.md D2, D3; research.md "Constraints and invariants"; handoff: handoff/store-ports.md, handoff/firestore-scaffold.md
- writes-contract: handoff/firestore-usage.md (`requests`/`usage`/`admission` document shapes and counter-id format, `deploy/firestore/indexes.json` path)
- after: chain-2 (both edit the Firestore conformance entry and the factory branch)

## chain-4: sqlite-import

- tasks: 5.1–5.2
- rationale: one operator command and its test, reading SQLite and writing the Firestore document model.
- reads: specs/server-storage-backends/spec.md §"A SQLite data directory can be imported into Firestore"; design.md D7; handoff: handoff/firestore-scaffold.md, handoff/firestore-usage.md
- writes-contract: none

## chain-5: deploy-and-docs

- tasks: 6.1–6.3
- rationale: the deploy script and runbook/decision/capability docs. It touches no server source, so it runs parallel to chain-4, which touches no deploy or docs files.
- reads: specs/server-storage-backends/spec.md §"Operators reach production records without a shell on the instance", §"A SQLite data directory can be imported into Firestore"; design.md D1, D6, Migration Plan; handoff: handoff/firestore-usage.md
- writes-contract: none

## Not dispatched

- tasks 7.1–7.2: production rollout and the backup import. The orchestrator runs them attended after the run's merge (they touch production and the operator's local backup).
