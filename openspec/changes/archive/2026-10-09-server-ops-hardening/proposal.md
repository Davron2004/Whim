## Why

Production moved to Cloud Run with Firestore stores on 2026-10-07/09 (decisions #71–#73). Several parts of the server and its tooling still assume the VM, or assume a single-process database. Four problems follow:

- Log-based alerts never fire (#138).
- No automated check runs after a deploy (#146).
- A lost Firestore commit reply can double-credit a device's lifetime tokens (#145).
- About 1 in 10 cold starts dies in Chromium (#139).

Two content-policy gaps showed up during beta-1 and also reach testers:

- A classifier call that hangs once becomes a "try again" on the first prompt (#119).
- Classifier calls made for generations waiting in line are bounded by no daily limit (#120).

These should be fixed before outside testers arrive, because each of them is either invisible to the operator or spends money nobody budgeted.

## What Changes

- **Idempotent Firestore credit (#145).** `FirestoreUsageStore.credit` applies each call at most once, even when the SDK retries a commit whose reply was lost.
  - It runs in a transaction that creates a per-call credit marker, the same pattern `admit` uses with its `admissionId`.
  - Markers carry no device id and are purged after one UTC day.
  - The `UsageStore` interface and all call sites are unchanged.
- **Bounded classifier retry (#119).** The content-policy check makes at most two attempts inside the unchanged overall deadline `WHIM_POLICY_TIMEOUT_MS` (10 s).
  - Each attempt is bounded by a new `WHIM_POLICY_ATTEMPT_TIMEOUT_MS`.
  - A hung first attempt no longer turns into a `503`.
  - The check still fails closed.
- **Limited classifier calls in the line (#120).** A generation that finds every slot busy now admits a `policy-check` ledger row before its classifier call. The row counts against new per-device and global daily limits, and carries the call's tokens and cost.
  - This closes the join-then-abort loop.
  - The check's cost now has a row to land on.
  - It also makes the line path's ledgering symmetric with the free-slot path for `policy_unavailable`.
- **Boot survives a Chromium launch crash (#139).**
  - Boot and every relaunch retry a failed browser launch up to three times with byte-identical launch options. A weaker configuration is never used.
  - Boot logs the host CPU model and kernel, to collect evidence for the root cause.
- **Alerts on Cloud Run (#138).**
  - Every log-based alert and log metric is retargeted from `log_id("docker")`/`gce_instance` to the `whim-server` Cloud Run revision logs.
  - `deploy/cloudrun/deploy.sh` applies them all on each plain deploy, keyed by fingerprint.
- **Cloud Run smoke (#146).**
  - New `deploy/cloudrun/smoke.sh`, run by `deploy/cloudrun/deploy.sh` at the end of every mode, checks: domain mappings ready, `/health` commit and identity, device gate `400`, update gate `426`, SSE frame spacing, pages and association files, and the purge job and scheduler present.
  - It also sends one documented live `/v1/clarify` from a fixed smoke device id, the one production write a smoke makes, which can be turned off with `--no-live`.
  - The VM `deploy/smoke.sh` stays VM-only, for a return to a VM.
- **Firestore admission load test off production (#143).** An on-demand harness bursts concurrent `admit` calls against the Firestore emulator and reports p50/p99 latency, transaction attempts and over-admission.
  - An opt-in, attended tier can run it against a throwaway `whim-loadtest-*` database that it creates and deletes.
  - That tier has a hard operation cap, refuses the production database and prints its cost (cents) before it starts.
- **Runbook.** `docs/deploy.md` gets the Cloud Run saved queries and alerts, the smoke, the new limits, and the load test. A new decision entry is added.

No **BREAKING** wire changes. `/v1/*` stays gated by `x-whim-device`, and every stream still ends in exactly one terminal `GenerationEvent`.

### Scope decisions per issue

| Issue | Decision | Why |
|---|---|---|
| #145 | In | Data-integrity bug in the store this change already touches. The fix is local to the Firestore backend. |
| #119 | In | Same code path as #120 (`checkPolicy`). A bounded retry is the fix, and the production timing measurement is an attended pre-deploy step. |
| #120 | In | Shares the policy and admission code with #119. Splitting it would make two chains edit `routes/generate.ts`. |
| #138 | In | Pure ops. Alerts are the operator's only signal on a scaled-to-zero service. |
| #139 | In (mitigation + evidence) | Same-option retry makes the crash harmless and keeps the containment rule. Finding the root cause (CPU flags, `--cpu-boost`) would mean deploying experiment revisions, so it stays open on the issue and is fed by the new boot log line. |
| #143 | In (emulator tier; throwaway-DB tier opt-in) | The emulator tier proves correctness under a burst at zero cost. Only a real database shows real contention, so that tier is built but runs only on the product owner's explicit go-ahead. Sharded counters are out unless the measurement shows contention. |
| #146 | In | No post-deploy check exists for production today. |
| #134 | **Out** | Measuring the generation cap on Cloud Run needs a real gen2 instance under replay load. A local container on Apple silicon emulates amd64, so its CPU numbers are meaningless, and a temporary Cloud Run load-test service breaks this change's "local server or emulator only" constraint. Re-aim the issue to Cloud Run with an explicit product-owner cost approval. Until then the caps (3/2) are the VM's measured values, carried over. |

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `server-storage-backends`: adds at-most-once credit under lost commit replies.
- `content-policy`: adds a bounded second classifier attempt inside the existing deadline.
- `server-admission-control`: adds the ledgered, daily-limited `policy-check` row for generations waiting in line.
- `server-deployment`: boot retries a failed browser launch with identical options and logs the host CPU; adds Cloud Run log-based alerts, a Cloud Run smoke run by the deploy script, and the off-production Firestore admission load test.

The base text of these four capabilities still lives in unarchived changes (`public-generation-server`, `beta-1`, `durable-server-stores`). Those must be archived before this one.

## Impact

- **Server code:**
  - `server/src/firestore/usage-store.ts` (credit and purge)
  - `server/src/policy/policy.ts`, `config.ts`
  - `server/src/routes/{generate,clarify}.ts`, `server/src/admission/*`
  - `server/src/usage-store.ts` (new `RequestKind`), the usage report
  - `server/src/lifecycle.ts`, `server/src/main.ts`, `synthrun/session.ts`
- **Deploy:**
  - `deploy/monitoring/*.json`, `deploy/lib.sh`, `deploy/provision.sh` (shared rendering)
  - `deploy/cloudrun/deploy.sh`, new `deploy/cloudrun/smoke.sh`
  - new `deploy/loadtest/firestore-admission.sh`
- **Tests:** existing suites only (`store-conformance`, `firestore-conformance`, `policy`, `routes-*`, `admission`, `deploy-config`, `loadtest`, boot). No new npm script, no gate edit, no `CONFIG_SET` file. No chain is HUMAN-BOOTSTRAP.
- **GCP spend:** unchanged in steady state.
  - Scale-to-zero, `min-instances 0` and `max-instances 1` stay.
  - The smoke adds one clarify call per deploy, a fraction of a cent.
  - Credit markers add about one read and one write per credit, also a fraction of a cent per thousand generations.
  - The throwaway-database load test costs cents and runs only with explicit approval.
- **Docs:** `docs/deploy.md`, `docs/decisions.md` (new entry), `docs/capabilities.md` (server-deployment row).

## Product-owner rulings (2026-10-09)

1. **#143 real-Firestore run — approved, unattended**, on a throwaway `whim-loadtest-*` database only: hard cap 50,000 operations per run (≈ $0.10), deletion in a `finally`, and a post-run check that lists databases and fails if any `whim-loadtest-*` remains. The production `(default)` database is refused by construction.
2. **Smoke's live `/v1/clarify` runs on every deploy, including `--tag` rollbacks** — a rollback is when proof of a working generation path matters most.
3. **`policy-check` limits 30/device/day and 800/day global are accepted.** A content-policy refusal while waiting in line spends a generation unit, same as a refusal on a free slot.
4. **Uptime check stays as designed;** add a task to chain 4 that verifies `whim-server` uses request-based billing (CPU allocated only during requests) so a kept-warm idle instance costs nothing, and records the setting in `docs/deploy.md`.
