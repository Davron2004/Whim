# Context chains: server-ops-hardening

No chain touches a `CONFIG_SET` file (`package.json`, the lockfile, `scripts/gate*.sh`, tsconfig, eslint, knip, `.claude/**`, `build/`, `invariants/`). New tests extend existing suites, and `server/test/acceptance.ts` is not edited, so no chain is HUMAN-BOOTSTRAP and every chain self-gates with the unmodified `scripts/gate.sh`. A chain that edits Firestore code or tests also runs `npm run -s stores:firestore:test` from the main tree on its committed tip (worktrees cannot run it; see `docs/harness.md`).

Dependency graph:
- chain-1 → chain-2 → chain-3.
- chain-2 → chain-4 (contract).
- chain-1 → chain-5.
- chain-6 runs after all of them.
- chain-4 and chain-5 can run in parallel with chain-3.

## chain-1: store-credit-idempotency

- tasks: 1.1–1.4
- rationale: one store method plus its purge and conformance harness, all in the Firestore backend and its emulator test.
- files: `server/src/firestore/usage-store.ts` (and the Firestore purge it calls), `server/test/firestore-conformance.ts`, `server/test/store-conformance.suite.ts` (only if a shared case is needed), `deploy/firestore/indexes.json` (only if the coverage check demands it)
- reads: specs/server-storage-backends/spec.md §"A lost commit reply never credits usage twice"; design.md D1; research.md §"#145 credit"; handoff: none
- writes-contract: handoff/credit-idempotency.md (marker collection name and fields, purge cutoff, the lost-reply harness API that chain-5 reuses)

## chain-2: server-policy-bounds

- tasks: 2.1–2.6
- rationale: the content-policy retry and the line-path `policy-check` row share `checkPolicy`, `routes/generate.ts`, `config.ts` and the policy wiring in `lifecycle.ts`. Splitting them would put two chains in the same files.
- files: `server/src/policy/*`, `server/src/config.ts`, `server/src/lifecycle.ts` (policy construction only), `server/src/routes/generate.ts`, `server/src/admission/*`, `server/src/usage-store.ts`, `server/src/firestore/usage-store.ts` (kind acceptance only), usage report/summary code, and the suites `policy`, `routes-generate`, `admission`, `store-conformance`
- reads: specs/content-policy/spec.md §"A transient classifier failure is retried once inside the policy deadline"; specs/server-admission-control/spec.md §"A policy check for a generation waiting in line is ledgered and daily-limited"; design.md D2, D3; research.md §"#119/#120"; handoff: handoff/credit-idempotency.md
- writes-contract: handoff/policy-bounds.md (env names and defaults, the `policy-check` kind and row-id rule, the `attempts` log field, older-image `summary` behaviour)
- after: chain-1 (both edit `server/src/firestore/usage-store.ts` and the store conformance)

## chain-3: synthrun-launch-resilience

- tasks: 3.1–3.4
- rationale: one launch call site and the boot that drives it. These are the session, lifecycle and their existing launch-failure suites.
- files: `synthrun/session.ts`, `server/src/lifecycle.ts` (boot host record and launch path only), `server/src/main.ts` (only if the exit path needs it), `synthrun/test/resilience.ts`, `server/test/prod-build.suite.ts`
- reads: specs/server-deployment/spec.md §"Production boot proves the synthetic run works before serving" (MODIFIED); design.md D4; research.md §"#139 boot"; handoff: none
- writes-contract: handoff/browser-launch.md (log message names and fields, the attempt bound)
- after: chain-2 (both edit `server/src/lifecycle.ts`)

## chain-4: deploy-cloudrun-ops

- tasks: 4.1–4.7
- rationale: everything under `deploy/` for Cloud Run operations: alert definitions, shared shell helpers, the deploy script and the new smoke. They are tested together by the fake-tool `deploy-config` suite.
- files: `deploy/monitoring/*.json`, `deploy/lib.sh`, `deploy/provision.sh`, `deploy/smoke.sh`, `deploy/cloudrun/deploy.sh`, new `deploy/cloudrun/smoke.sh`, `server/test/deploy-config.suite.ts`
- reads: specs/server-deployment/spec.md §"Log-based alerts match the Cloud Run service's logs", §"A Cloud Run deploy ends with a Cloud Run smoke check"; design.md D5, D6; research.md §"#138 alerts", §"#146 smoke"; handoff: handoff/policy-bounds.md (the env keys to forward)
- writes-contract: handoff/cloudrun-ops.md (smoke CLI and modes, check list, smoke device id and prompt, monitoring apply behaviour, exact filters)
- after: chain-2 (contract read only; no shared files)

## chain-5: firestore-admission-loadtest

- tasks: 5.1–5.5
- rationale: an off-production measurement tool. It consists of a test-side harness, its shell entry point and guard tests, and touches no product code.
- files: new harness under `server/test/` (bundled only by its own runner), new `deploy/loadtest/firestore-admission.sh`, `server/test/firestore-conformance.ts` (one small-burst case), `server/test/loadtest.suite.ts`
- reads: specs/server-deployment/spec.md §"Firestore admission contention is load-tested without touching production"; design.md D7; research.md §"#143/#134 load test"; handoff: handoff/credit-idempotency.md (harness proxy pattern)
- writes-contract: handoff/firestore-admission-loadtest.md (CLI, report fields, cap and cost estimate)
- after: chain-1 (both edit `server/test/firestore-conformance.ts`)

## chain-6: docs-runbook

- tasks: 6.1–6.3
- rationale: the runbook, decision log and capability map. These are prose only, written once from every contract so no two chains edit `docs/deploy.md`.
- files: `docs/deploy.md`, `docs/decisions.md`, `docs/capabilities.md`
- reads: design.md (all decisions), proposal.md §"Scope decisions per issue"; handoff: handoff/credit-idempotency.md, handoff/policy-bounds.md, handoff/browser-launch.md, handoff/cloudrun-ops.md, handoff/firestore-admission-loadtest.md
- writes-contract: none
- after: chain-1, chain-2, chain-3, chain-4, chain-5

## Not dispatched

- tasks 7.1–7.6: production log reads, the emulator load-test runs, the optional throwaway-database run, the production deploy and the issue updates. The orchestrator runs them attended after the run's merge, because they use the owner's GCP credentials and touch production (7.4 is the smoke's one sanctioned write). Task 7.3 runs only with the product owner's explicit approval.
