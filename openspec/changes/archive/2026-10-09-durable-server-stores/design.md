## Context

Production moved to Cloud Run with zero minimum instances (decision #71). The server's three stores are `node:sqlite` files under `WHIM_DATA_DIR=/tmp/whim-data`, so they live and die with the instance (research.md, "Current behavior"). Each store already sits behind an interface with an in-memory twin. Routes, `runAdminCli` and `runWaitlistCli` take the interfaces. Only boot (`lifecycle.ts` `atStep('stores')`, `Opened`, `scheduleCostSweep`) and the two CLI entries construct SQLite classes directly (research.md, "Integration points").

The Firestore database exists: `(default)`, Native mode, `northamerica-northeast1` (matching the published "Canada (Montreal)" processor location in `deploy/site/legal-identity.json`), on the free tier with delete protection. The runtime service account `whim-run` holds `roles/datastore.user`. Spend constraint from the owner: nothing billed while idle.

## Goals / Non-Goals

**Goals:**
- Usage ledger, lifetime usage, reports and waitlist survive restarts and scale-to-zero in production.
- Store semantics are identical on every backend. One conformance suite is the definition, and it runs on in-memory, SQLite and the Firestore emulator.
- Admission stays atomic: no two concurrent requests can both take the last device or global unit.
- Operators run `whim-admin` and `whim-waitlist` against production from a laptop.
- The VM backup (2026-10-07) is imported, and the import is reusable by self-hosters.

**Non-Goals:**
- More than one Cloud Run instance. Concurrency slots, the line, per-device exclusivity and the beta limiter stay per-process; `max-instances` stays 1.
- Firestore TTL policies, PITR or scheduled backups. These are billed or extra machinery; the hourly purges stay the retention mechanism.
- Changing any keep period, the disclosure manifest, the wire contract or the privacy text.
- Retiring SQLite or the VM deploy path.

## Decisions

### D1. One backend switch, SQLite stays the default
`WHIM_STORE_BACKEND` = `sqlite` (default) | `firestore`. With `firestore`, the database is `WHIM_FIRESTORE_DATABASE` (default `(default)`) and the project comes from `GOOGLE_CLOUD_PROJECT` or Application Default Credentials. Any other value fails boot, naming the variable. A single factory, `openStores(config) → {usage, reports, waitlist, close}`, is the only constructor of store classes outside tests. Boot, `whim-admin` and `whim-waitlist` all call it.
*Alternatives:* Firestore-only. Rejected because it breaks self-hosting (decision #70) and the SQLite-shaped suites. Per-store switches were rejected as configuration nobody needs.

### D2. Admission uses counter documents inside a transaction
Today `admit` is two COUNTs plus an INSERT under `BEGIN IMMEDIATE` (research.md, "Constraints"). On Firestore, `admit` runs one `runTransaction` that:
- reads the device counter doc `admission/{utcDay}:{kind}:{deviceId}`;
- reads the global counter doc `admission/{utcDay}:global:{sorted globalKinds joined by +}` when a global limit applies;
- checks the device limit first (preserving the "over both refuses as `device`" order), then the global limit;
- increments both counters and `create()`s `requests/{requestId}`, so a reused id fails the transaction.

`refund` runs a transaction that flips `refunded` once and decrements the same counters. `unitAvailable` reads the counters without a transaction. Firestore transactions are serializable on the documents they read, so the last-unit race is rejected and retried by the SDK.
*Alternatives:* aggregation `count()` queries inside the transaction. Rejected: the query-read contention semantics are weaker and less obvious than document locks, and each count bills per 1,000 index entries. A single global counter for all kinds was rejected because clarify and rewrite share a ceiling separate from generate's.

### D3. Document model mirrors the tables
- `usage/{deviceId}`: counters plus `lastCreditedDay`. `credit` is `set(..., {merge: true})` with `FieldValue.increment`, which is atomic without a transaction.
- `requests/{requestId}`: the ledger row's fields. `generationIds` is a native array, not JSON text.
- `reports/{reportId}`: the row's fields, with optional text as `''` exactly as SQLite stores it.
- `waitlist/{sha256(normalizedEmail)}`: email kept as a field. `upsert` is a transaction (read, then set or create) so `stored`/`updated` is exact. That is stricter than SQLite's two separate statements.
- `admission/{…}`: counters only, deleted with the ledger day they belong to.

Purges are batched query-and-delete (500 per batch). Composite indexes live in `deploy/firestore/indexes.json` and are applied by the deploy script. The required indexes are ledger by (`utcDay`, `kind`, `deviceId`), the cost sweep's filter, and reports by `receivedAt`.

### D4. All store interfaces are asynchronous; `close()` joins them
`WaitlistStore` becomes `Promise`-returning (research.md, open question 5). `close(): Promise<void>` is added to all three interfaces, and `Opened` and `scheduleCostSweep` take interfaces. The boot `stores` step becomes async. With Firestore, boot also does one probe read so a misconfigured project or missing permission fails boot instead of the first request.

### D5. Conformance suite over every backend, emulator in the full gate
`server/test/store-conformance.suite.ts` runs the store contracts (admission race, refund, settle-first-wins, the `recordCost` state machine, credit increments, retention cutoffs, waitlist upsert/order/remove, report list order and limit, device export and delete) against a factory parameter.
- The fast gate covers the in-memory and SQLite backends.
- `npm run stores:firestore:test` starts the Firestore emulator (Java 21 is present locally; CI installs it) and runs the same suite against `FirestoreStores`. `gate-full.sh` runs that suite.
- The existing SQLite-shaped suites are unchanged.

### D6. Operator commands run from a laptop
With `WHIM_STORE_BACKEND=firestore`, `node server/admin.mjs …` and `node server/waitlist.mjs …` reach production through ADC (`gcloud auth application-default login` as the project owner). The runbook documents the exact invocations. No HTTP admin route is added: such a route would be new attack surface, and the database's IAM already is the access control.

### D7. Import from SQLite
`whim-admin import-sqlite --data-dir <dir>` reads the three SQLite files directly. It writes Firestore documents with their original ids and timestamps, idempotently (set by id). It rebuilds the admission counters from the imported ledger days that are still inside retention. It prints per-store counts and is run once against the VM backup.

### D8. Deletion semantics
SQLite's `secure_delete=ON` overwrites purged pages. Firestore has no equivalent: a deleted document leaves Google's storage under its standard deletion timeline, and with PITR off the database's version retention is 1 hour. The published maximum keep periods are about our retention, and they hold. This is recorded, not hidden.

## Risks / Trade-offs

- **Hot-path latency:** about 4 Firestore round trips per generation at 15–40 ms each (Cloud Run in `us-east4` → Firestore in Montreal, decision #72). That is under 200 ms against a run that takes minutes. Clarify and rewrite add about 80 ms. → Accepted; measure on the first production run.
- **Transaction contention on the global counter under bursts.** At one instance and current traffic this is negligible, and the SDK retries. → Revisit if multi-instance ever lands.
- **Emulator drift from production Firestore.** → The deploy smoke runs one real admission round trip, and boot does a probe read.
- **Archive ordering:** the unarchived `public-generation-server` change also modifies "Token metering — the only server state". → Whichever change archives second must reconcile. This change's delta keeps the counter wording and only lifts the backend pin.
- **Free-tier limits** (20k writes a day ≈ 2,500 generations a day at about 8 writes each). That is above today's global ceiling of 400 generations a day. → The budget alert already exists.

## Migration Plan

1. Land code with SQLite as the default. Nothing changes for self-hosters or tests.
2. `deploy/cloudrun/deploy.sh` sets `WHIM_STORE_BACKEND=firestore` and applies the indexes, then deploys.
3. Run `import-sqlite` against `~/.config/whim/vm-backup-2026-10-07`, then verify the counts with `whim-waitlist export` and `whim-admin reports list` from the laptop.
4. Rollback: redeploy with `WHIM_STORE_BACKEND=sqlite` (the ephemeral state from before). The Firestore data stays untouched for the next attempt.

## Open Questions

- None blocking. Whether a single run can emit more than one `usage` event (research.md, "Risks") only changes write counts, not correctness.
