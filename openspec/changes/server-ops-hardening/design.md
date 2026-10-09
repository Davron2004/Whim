## Context

Production runs on Cloud Run in `us-east4` with stores in Firestore (Montreal): `whim-server` is gen2, 2 vCPU / 4 GiB, 0–1 instances, with `--cpu-boost` (decisions #71–#73; `docs/deploy.md` "Cloud Run", "Firestore stores"). The terrain is in `research.md`. This change fixes seven issues that fall out of that move or showed up in the beta-1 flowbench. The proposal's scope table says why each is in or out (#134 is out).

Hard constraints, carried into every task:
- No material GCP spend: scale-to-zero, `min-instances 0` and `max-instances 1` stay, and nothing runs always-on.
- No DNS changes.
- No production writes during tests. The only exception is the Cloud Run smoke's one documented `POST /v1/clarify`.
- `/v1/*` stays gated by `x-whim-device`.
- Exactly one terminal `GenerationEvent` per stream.
- No `CONFIG_SET` file changes (research.md "Gate wiring"). Every new test extends an existing suite, so `server/test/acceptance.ts` and `package.json` are untouched.

## Goals / Non-Goals

**Goals:**
- Lifetime token totals on Firestore are exact under SDK commit retries (#145).
- A single slow classifier attempt no longer reaches a tester as `503` (#119).
- Every classifier call is attributed to a ledger row that some daily limit counts (#120).
- A Chromium launch crash no longer costs the instance (#139).
- Operators get alerted on Cloud Run (#138).
- Every Cloud Run deploy is verified automatically (#146).
- Firestore admission's hot-counter behaviour is measured off production (#143).

**Non-Goals:**
- The root cause of the Chromium SIGSEGV. This change collects evidence and leaves #139 open for it.
- Sharded admission counters. These come only if #143's measurement shows contention.
- Re-measuring the generation caps on Cloud Run (#134, out).
- Retiring the VM scripts. `docs/deploy.md` keeps them for a return to a VM.
- Model or provider routing changes for the classifier. That is operator config, per the model-strategy notes.
- Any per-IP limit on `/v1`.

## Decisions

### D1. #145: a per-call credit marker inside a transaction
**Premise check.** Verified against the installed `@google-cloud/firestore` 9.3.1:
- `DocumentReference.set` commits through `WriteBatch.commit`.
- That commit retries on `ABORTED` plus the gapic `Commit` codes `RESOURCE_EXHAUSTED` and `UNAVAILABLE` (`write-batch.js`, `firestore-api` client config).
- So a commit that landed but lost its reply is re-applied, and an increment then counts twice.

**Design.** Change `FirestoreUsageStore.credit` as follows:
- It mints a `randomUUID()` marker id once per call, outside the transaction function.
- It runs `db.runTransaction` with the same retry budget as `admit`, so the hot path keeps one retry policy.
- The transaction reads `creditMarks/{markerId}`.
  - If the marker exists, the transaction does nothing.
  - Otherwise it applies the three increments and `lastCreditedDay` to `usage/{device}`, and creates the marker `{ utcDay }`.
- A retried transaction re-runs the function, sees its own marker, and becomes a no-op. This is exactly `admit`'s `admissionId` pattern (research.md §1).
- The signature and every call site stay as they are. SQLite and in-memory stores are unchanged, because a commit and its acknowledgement happen in one process there.

**Purge.**
- The existing hourly ledger purge (and the `whim-purge` job, which runs the same purges) deletes markers whose `utcDay` is before yesterday.
- Markers hold no device id, so device export and delete do not need to know about them, and they hold no personal data.
- The purge is a single-field range query on `utcDay`, so it needs no composite index. `firestore-index-coverage.ts` confirms that.

**Test that discriminates.**
- The lost-reply harness in `firestore-conformance.ts` today replays only `runTransaction`. It is extended so that, for the duration of a case, it also replays plain commits (`WriteBatch.prototype.commit`).
- Against today's plain `set`, the credit case therefore goes red.
- Against the weaker variant (increment inside a transaction but no marker), the `runTransaction` replay also double-counts, so that goes red too. This is the "red-check against the weaker variant" rule.
- Only the marker version passes.

**Alternatives considered:**
- (a) Accept at-least-once and document it. Rejected: `summary` and the usage report are what the operator sizes credit from.
- (b) A batched `create(marker)` plus `set(increment)` with no read, treating `ALREADY_EXISTS` as already applied. Cheaper by one read, but it introduces a second idempotency pattern, and the store would have to map an SDK error code to success.
- (c) A `credited` flag on `requests/{id}`. Rejected: credit call sites have no request id (research.md §1, and `resolve.ts` passes `''`), and one request credits several times.

### D2. #119: two attempts inside the unchanged deadline
- `ModelContentPolicy.check` gets an overall deadline signal, `WHIM_POLICY_TIMEOUT_MS` (10000, unchanged), combined with the request signal.
- Each attempt gets `min(WHIM_POLICY_ATTEMPT_TIMEOUT_MS, remaining)`. The attempt timeout defaults to 4500.
- A second attempt runs only after an unable-to-verdict result, with at least 1000 ms left and the request not aborted. Auth errors are never retried, because a retry cannot fix them.
- Usage and generation ids from both attempts flow through the existing `PolicyUnavailableError`/verdict carriers, and are credited and attributed as today.
- The `content policy check` log line gains `attempts`.
- The worst-case latency stays at 10 s. The common failure case (one hung call, median 1.3 s otherwise, per #119) recovers within about 6 s.
- The 4500 ms default is provisional. Attended task 7.1 measures the classifier's p99 from production logs before rollout and sets the env value if needed. `deploy/cloudrun/deploy.sh` forwards the variable as an optional key.

**Alternatives considered:**
- Raise the timeout. That makes the tail slower and does not fix a hung connection.
- Retry without an overall deadline. That would break the documented bound.
- Hedged parallel requests. They double classifier spend on every call.

### D3. #120: a `policy-check` ledger row for generations waiting in line
In the line path (`admitIntoLine`), the steps are:
1. The credit check and the `generate` `unitAvailable` check run as today, with no write.
2. The server `admit`s a row of the new `RequestKind` `policy-check` with id `<requestId>:policy-check`, against the new device and global daily limits.
3. It runs `checkPolicy`.
4. It settles the row: allow → `ok`, refuse → `refused`/`content_policy`, unavailable → `unavailable`/`policy_unavailable`.
5. It attributes tokens and generation ids, then resolves cost through the existing `resolveRequestUsage` with that row id.

The unit is never refunded, because it meters classifier spend rather than the user's allowance. `recordLineRefusal`'s admit-then-refund of a `generate` row is replaced by the settled `policy-check` row. With that, both paths ledger a `policy_unavailable`, the cost lands on a row, and no generation unit is spent before a slot. That honours beta-1's line requirement and #120's symmetry comment.

**Why this works:**
- Fresh device ids defeat a per-device bound alone, and the global ceiling (800 a day) is what caps spend. That is at most about $0.40 a day at roughly $0.0005 per classifier call.
- The per-device limit (30, twice the generation limit) stops one device from monopolising the global ceiling.

**Id and contention:**
- The suffixed id keeps the ledger's one-row-per-id rule without a schema change. The operator's usage report groups the row with its request by prefix.
- The new kind's global counter is written only on line entries, which are rare and happen only when every slot is busy, so it adds no measurable hot-document load (#143).

**Alternatives considered:**
- Spend and refund a `generate` unit. Net zero, so the abort loop stays unbounded.
- Refuse devices that abandon the line repeatedly. Fresh ids defeat it.
- A per-IP cap. `x-forwarded-for` on Cloud Run is spoofable unless the right hop is trusted, and `/v1` has no IP plumbing.
- Meter every classifier call on all routes. That adds a hot-counter write to every request.

### D4. #139: same-option launch retry plus a host record
- `SynthRunSession`'s single launch call site (`startBrowser`) loops up to three attempts, with 500 ms between them, calling the same `browserLaunchOptions()` result object each time.
- Because the call site stays single, the `synthrun/test/isolation.ts` scan still holds.
- Boot and relaunch share the loop.
- The test injects a launcher that records options. It fails twice and then succeeds, and asserts that the options are deep-equal on every attempt with `chromiumSandbox: true`.
- Boot logs `boot host` from `/proc/cpuinfo` (`model name`, `pku`/`ospke` flags) and `os.release()`. Off Linux the fields are `unknown`.
- The cold-start cost of a crash drops from a new instance (about 2× boot) to one extra launch of about 1 s.
- The boot-host logs from production collect evidence for #139's open root cause at no cost.

**Alternatives considered:**
- Drop `--cpu-boost`. That is unmeasured, and the experiment would need throwaway deploys.
- `--no-sandbox`. Forbidden.
- A startup probe. It does not prevent the crash.

### D5. #138: Cloud Run filters, applied by the Cloud Run deploy
- Every filter becomes `resource.type="cloud_run_revision" AND resource.labels.service_name="whim-server" AND logName:"run.googleapis.com%2Fstdout"` plus the existing `jsonPayload.*` predicates. Pino emits `msg`, not `message`, so Cloud Run keeps it under `jsonPayload.msg`.
- The terminal-failures threshold policy watches the metric on `cloud_run_revision`.
- The fingerprint render/apply helpers that `provision.sh` uses move into `deploy/lib.sh`, so `deploy.sh` and `provision.sh` share one implementation. `apply_purge_alert` generalises to "apply all monitoring" on plain deploys.
- A `--tag` deploy (rollback or config) does not touch monitoring.
- The VM alert variants are not kept. A return to a VM would retarget them, and the runbook says so. Keeping both doubles untested surface.

**Live verification is attended** (task 7.5, read-only `gcloud logging read` per filter).
- Each filter must match at least one real entry in the last 30 days, where one exists.
- A filter with no history (for example `report accepted`) is recorded as unverified rather than proven by writing synthetic production log entries.

### D6. #146: `deploy/cloudrun/smoke.sh`
- The checks are listed in specs/server-deployment. Readiness comes from `gcloud run domain-mappings describe` and `gcloud run services describe` (latest ready revision, 100% traffic). These are read-only and IP-free.
- The shared HTTP checks (`/health` parsing, pages, association files compared against the site build's own output directory, SSE spacing, `426`) are factored out of `deploy/smoke.sh` into `deploy/lib.sh` helpers, so the VM smoke and the Cloud Run smoke share them and do not drift. The VM smoke keeps its VM-only checks.
- The live clarify:
  - It uses the fixed device id `5e0ce000-0000-4000-8000-00000000c1a1` and the benign prompt `smoke: a checklist with one item`.
  - Both are documented in the runbook, so the operator's usage report can filter them out.
  - `--no-live` skips it.
- `deploy.sh` runs the full smoke after `--tag` and plain deploys, and the pages-only smoke after `--site-only`. On failure it prints `deploy/cloudrun/deploy.sh --tag <previous sha>`, with the sha read from the revision it replaced.
- The beta signup trap is checked only for its `303` on a honeypot field, which writes nothing (research.md §6). The implementer confirms that it writes nothing, and drops the check if it does.

### D7. #143: emulator-first harness, opt-in throwaway database
- The harness lives in test code (`server/test/`), because it is never production code. It reuses `openFirestoreClient` and `FirestoreUsageStore`.
- It counts attempts by wrapping `runTransaction`'s update function, the same proxy technique as `losingCommitReplies`. No product seam is added.
- `deploy/loadtest/firestore-admission.sh` runs it under the pinned `firebase-tools` `emulators:exec`. The command line is copied from `stores:firestore:test` and avoids the knip/`npx --ignore-scripts` parsing trap. No npm script is added.
- `--database whim-loadtest-<suffix>` switches to real Firestore with the owner's ADC:
  - It refuses the reserved names.
  - It caps operations: 5,000 admissions by default, with a hard ceiling of 20,000, at roughly $0.02–$0.10.
  - It prints the estimate and requires `--confirm-spend`.
  - It creates the database in `WHIM_GCP_REGION` and deletes it in an `EXIT` trap.
- The emulator does not model Firestore's per-document write-rate limit. So the emulator run proves correctness and gives a baseline of attempts. Only the real-database run gives production-like p99s, and that run is the product owner's call (Open Questions).
- If contention shows, the follow-up is an in-process per-kind admission queue (`max-instances` is 1) or sharded counters. Neither is in this change.

### Chain layout and file ownership
No `CONFIG_SET` edits, so there is no HUMAN-BOOTSTRAP chain.

Files shared between chains are ordered with `after:`:
- `server/src/firestore/usage-store.ts` and `server/test/firestore-conformance.ts`: chain-1, then chain-2 and chain-5.
- `server/src/lifecycle.ts`/`config.ts`: chain-2, then chain-3.
- `deploy/cloudrun/deploy.sh`: chain-4 only. chain-2's env keys reach it through a contract.
- `docs/deploy.md`, `docs/decisions.md`, `docs/capabilities.md`: chain-6 only.

## Risks / Trade-offs

- [The credit transaction adds a read and a write per credit, and contends on `usage/{device}` under concurrent credits] → Admit's retry budget applies, and the five-concurrent-credits conformance case must still pass. Cost is about $0.24 per million credits.
- [The `WriteBatch.prototype` patch in the test depends on SDK internals] → Scope it to the case, and restore it in `finally`. The case asserts that the patch was hit (it counts replays), so an SDK change that bypasses it fails loudly instead of passing vacuously.
- [Base specs live in unarchived changes] → `public-generation-server`, `beta-1` and `durable-server-stores` must archive before this change. The MODIFIED header was copied verbatim from `public-generation-server`.
- [The smoke's live clarify spends a fraction of a cent and writes a ledger row per deploy] → Fixed documented device id and `--no-live`. It is the one sanctioned production write.
- [Retrying the Chromium launch could hide a host that never works] → The bound is three attempts, after which boot exits as today. Each failure is logged.
- [Filters are verified only against history] → An alert with no matching entry in 30 days is reported as unverified, not silently assumed to work.
- [The uptime check (`/health` every 5 min from 3 regions, `deploy/monitoring/uptime-healthz.env`) probably keeps the instance warm, so the service rarely actually scales to zero] → Out of scope here. Under request-based billing idle time is not charged, but this needs checking. Flagged for the product owner.

## Migration Plan

1. Merge on the run's staging branch. The gate covers SQLite and Firestore conformance, the deploy-config fakes and the boot suite.
2. Attended pre-deploy, task 7.1: measure classifier latency in production logs (read-only), and set `WHIM_POLICY_ATTEMPT_TIMEOUT_MS` in the operator values file if the 4500 default is wrong.
3. Run `deploy/cloudrun/deploy.sh` (plain). It applies indexes, the server, the purge job, all monitoring and the site, then runs the smoke with its one live clarify.
4. Attended verification: task 7.5 (alert filters against real logs) and task 7.2 (emulator load test). Task 7.3 (throwaway database) runs only on explicit approval.
5. Rollback: `deploy/cloudrun/deploy.sh --tag <previous sha>`. Credit markers left behind are inert, and the purge removes them. A `policy-check` row is ignored by the older image's report, apart from an unknown kind in the summary. The implementer confirms that the older `summary` tolerates an unknown kind.

## Open Questions

1. Approve the throwaway-database Firestore run (task 7.3, cents, attended), or accept emulator-only evidence for #143?
2. Should the smoke's live clarify be on by default for every deploy (current design), or only for plain deploys?
3. Defaults for `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY`/`_PER_DAY` (30/800), and whether a refusal in line should also spend a `generate` unit as a free-slot refusal does. The current design spends only the check unit.
4. Does the 5-minute, three-region uptime check keep `whim-server` warm, and is that acceptable? This is a separate issue if so.
