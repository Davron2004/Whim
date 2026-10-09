# Research digest: what does moving the server's usage, reports and waitlist stores off instance-local SQLite touch?

## Relevant files
- `server/src/usage-store.ts`: `UsageStore`, `UsageRecordKeeping`, `InMemoryUsageStore`, `NodeSqliteUsageStore` (l.609), `scheduleUsagePurge` (l.989).
- `server/src/reports/store.ts`: `ReportStore`, `ReportRecordKeeping`, `InMemoryReportStore`, `NodeSqliteReportStore` (l.200), `schedulePurge`.
- `server/src/waitlist/store.ts`: `WaitlistStore`, `InMemoryWaitlistStore`, `NodeSqliteWaitlistStore` (l.147), `scheduleWaitlistPurge`.
- `server/src/lifecycle.ts`: composition (l.354-375). `Opened` (l.198) and `scheduleCostSweep` (l.164) are typed to the concrete SQLite classes.
- `server/src/admin/{main,cli}.ts`, `server/src/waitlist/cli.ts`: operator CLIs. `server/build.mjs` (l.89-91) emits their bundles.
- `server/src/routes/{generate,clarify,rewrite,report,usage,beta-signup}.ts`, `server/src/usage/resolve.ts`: callers.
- `server/src/config.ts` (l.91-95, 147-149, 163, 288, 330-332): retention config, `dataDir`, keep-period check.
- `contract/src/disclosure-manifest.ts` (`keepLimit` l.522; waitlist max 730 days l.423).
- `server/test/*.suite.ts` (11 suites build `NodeSqlite*` stores, 15 use `InMemory*`), `server/test/route-doubles.ts`.
- Specs: `openspec/specs/generation-server/spec.md` (l.194-209, live). The rest exist only under in-flight `openspec/changes/{public-generation-server,legal-surface-v2,beta-waitlist}/specs/`.
- Docs: `docs/deploy.md` l.32-36 and 352-381; `docs/decisions.md` #71 (l.1296).

## Current behavior
**Waitlist** is the only synchronous store.
- Interface: `upsert(signup): 'stored'|'updated'`, `export(filter?): WaitlistRow[]`, `remove(email): boolean`, `purge(now): number`.
- Schema: `waitlist(email PK, platform, updates_opt_out, notice_id, created_at, updated_at)`, index on `updated_at`.
- `upsert` does a `SELECT 1`, then `INSERT ... ON CONFLICT(email) DO UPDATE`. On conflict it keeps `created_at`. The two statements are not in one transaction.
- Dedupe key is `normalizeEmail` (trim, lowercase), applied inside the store. `export` selects all rows and filters in JS.
- Callers: `routes/beta-signup.ts:108` `upsert` (request path, behind an in-memory per-instance rate limiter); `lifecycle.ts:369` purge timer; `waitlist/cli.ts` export and remove.

**Reports** have async signatures over synchronous node:sqlite calls.
- Interface: `insert(params): Promise<string>` (id is `randomUUID` minted in the store), `list`, `get`, `purgeOlderThan(cutoffMs)`, plus `ReportRecordKeeping.listByDevice` and `deleteByDevice`.
- Schema: `reports(id PK, device_id, reason, received_at, note, app_name, prompt, source)`. Optional text is stored as `''`. Index on `received_at`.
- `list` returns items with `promptBytes` and `sourceBytes`, newest first, default limit 50.
- Callers: `routes/report.ts:92` `insert` (request path); `lifecycle.ts:362` purge timer; `admin/cli.ts` device export and delete, reports list, show and purge.

**Usage and ledger** also have async signatures over synchronous bodies.
- Interface: `credit, read, admit, unitAvailable, refund, settle, recordCost, listUnresolvedCostRows, summary, purgeLedger`, plus `UsageRecordKeeping` (`purgeIdleUsage, deviceRecords, deleteDeviceRecords`).
- `admit` returns `{ok:true; requestId} | {ok:false; reason:'device'|'global'; retryAfterSec}`.
- Tables: `usage(device_id PK, prompt/completion/total_tokens, last_credited_day)`, and `requests(id PK, device_id, kind, utc_day, started_at, ended_at, outcome, prompt/completion_tokens, cost_usd, cost_state CHECK pending/resolved/unresolved, generation_ids JSON text, refunded, failure_reason)`. The only ledger index is `(utc_day, kind, device_id)`.
- The constructor runs two additive migrations (`failure_reason`; a `last_credited_day` backfill driven by `usageIdleDays` and `MANIFESTS[1]`), each in `BEGIN IMMEDIATE`.
- Request-path callers:
  - `generate.ts:342/393/433/621`: `admit` or `unitAvailable`.
  - `generate.ts:359-415`: policy-token `credit`.
  - `generate.ts:360-536`: `settle`.
  - `generate.ts:361/445`: `refund`.
  - `generate.ts:551`: pipeline `credit`.
  - `clarify.ts:334` and `rewrite.ts:202/334`: unary `admit`, `credit`, `settle` (the two routes share one admission).
  - `report.ts:75/101`: `admit` and `settle`.
  - `usage.ts:15`: `read`.
- Post-response callers: `resolve.ts:228-257` `recordCost` (1-3 calls per request) and a possible `credit`. These are tracked and drained at shutdown.
- Background callers:
  - `resolve.ts:330` `listUnresolvedCostRows` every 5 minutes (`lifecycle.ts:185-187`).
  - Hourly `purgeLedger` and `purgeIdleUsage` (`lifecycle.ts:363`).
  - `admin/cli.ts:122/130/187` `deviceRecords`, `deleteDeviceRecords`, `summary`.
- `summary()` selects every `requests` row with no WHERE and filters the window in JS (`computeSummary`).

**Credit count per generate stream:** `credit` fires once per `usage` event, not once per run. `forwardEvents` (`generate.ts:735-758`) calls `await credit(event.usage)` inside the `for await` loop on each `type === 'usage'` event and sets `ending.creditOwned = true`. The header comment (l.27) says `creditOwned` stops a run being counted twice.

**Hot-path store calls per request (all awaited serially):**
- Generate on a free slot: `admit` (2 COUNTs + INSERT), policy `credit`, at least one pipeline `credit`, `settle` at teardown (one retry on failure). After the response come 1-3 `recordCost` calls.
- Queued generate: adds `unitAvailable` (2 COUNTs) before the wait and a second `admit` when a slot frees. A queued policy refusal adds `admit`, `settle` and `refund`.
- Clarify and rewrite: `admit`, policy `credit`, `credit` per model attempt, `settle`.
- Report: `admit`, `reportStore.insert`, `settle`. Beta signup: 1 read and 1 write. `/v1/usage`: 1 `read`.
- No store read gates admission other than `admit` and `unitAvailable`. The provider-credit check is a cached transport (`checkCredit`, `generate.ts:269`), not a store read.

**Retention** (all four purges run at boot, then hourly, on unref'd timers; reports swallow errors, usage and waitlist go to `log.warn`):

| Data | Rule | Default |
|---|---|---|
| Reports | `received_at < now-days` | 90 days (`WHIM_REPORT_RETENTION_DAYS`) |
| Ledger | `utc_day < cutoff` | 90 days (`WHIM_LEDGER_RETENTION_DAYS`) |
| Lifetime usage | `last_credited_day < cutoff` | 365 days (`WHIM_USAGE_IDLE_DAYS`) |
| Waitlist | `updated_at < now-730d` | 730 days, hard-coded `WAITLIST_RETENTION_DAYS` |

Config refuses to boot when a keep exceeds the manifest maximum for its category (`config.ts:163`).

**Admin CLIs and laptop use:**
- `server/build.mjs:89-91` bundles `server/main.mjs`, `server/whim-admin.mjs` (from `admin/main.ts`) and `server/whim-waitlist.mjs` (from `waitlist/cli.ts`). `bundleServerEntry` (l.43-59) uses `platform:'node'`, `format:'esm'`, `target:'node22'`, a linked sourcemap and `external: declaredRuntimePackages()`. Repo TypeScript is bundled in.
- `admin/main.ts:15-17` loads config from `process.env` and constructs `NodeSqliteReportStore` and `NodeSqliteUsageStore` on `path.join(config.dataDir, '*.db')`. `waitlistMain` (`waitlist/cli.ts:81`) does the same for `waitlist.db`.
- Both CLIs are plain node scripts with no network client and no env switch for a remote backend. They need the files on the local filesystem.
- `runAdminCli(argv, deps)` and `runWaitlistCli(argv, store)` take interface types, so only the entry files pick the backend.
- Today operators run them with `docker compose exec` inside the VM container (`docs/deploy.md:352-365`). `docs/deploy.md` documents no Cloud Run admin procedure (I did not find one).

## Constraints and invariants
- `admit` is count-then-insert, atomic. The contract (`usage-store.ts` l.47-50) says implementations MUST do the count and insert with no `await` between them, so overlapping calls cannot both take the last unit.
  - The device limit is checked first, so a request over both limits refuses as `'device'`. A reused `requestId` rejects after the limit checks.
  - The global count runs across `globalKinds` (default `[kind]`). Clarify and rewrite share one ceiling via `['clarify','rewrite']`.
  - Refunded rows are excluded from counts. `retryAfterSec` is the seconds to the next UTC midnight, at least 1.
  - Spec (public-generation-server `server-admission-control` l.63, 88, 101): unit consumed atomically at admission; counts durable across restart.
- `settle` keeps the first outcome (`WHERE ended_at IS NULL`) and never changes `utc_day`. Failure reasons are validated against closed sets, so the ledger holds no free text. `refund` is idempotent.
- `recordCost` state machine (`costWriteLands`): pending accepts anything; unresolved accepts only the upgrade to resolved; resolved is final. `generation_ids` is cleared on resolve.
- `credit` is an increment-upsert that also stamps `last_credited_day`.
- `deleteDeviceRecords` removes ledger rows and the usage row in one transaction. `device export/delete` must cover every record keyed by a device id (legal-surface-v2 `device-records`).
- Waitlist is one row per normalized email, and a repeat signup keeps `created_at`. `export` is oldest first, ties by email.
- Reports are the only stored user content, in a store separate from the usage store (`content-reports` spec). The ledger holds no content. `secure_delete=ON` exists for reports and waitlist so purges overwrite pages.
- Keep periods may not exceed the manifest maximum. Tests tie policy text, manifest and config together (`web-site.suite.ts`, `prod-build.suite.ts:307-308/426`, `waitlist.suite.ts:101-105`).
- Cloud Run today (decision #71, `docs/deploy.md` l.23, 32-36): max one instance, concurrency 40, `WHIM_DATA_DIR=/tmp/whim-data`, drain budget 8000 ms, cold boot about 7-10 s. Boot preflight checks `WHIM_DATA_DIR` is writable (`server-deployment` spec l.17).
- Resolution never throws into a response.

## Integration points
- `lifecycle.ts:354-375` constructs all three stores in a synchronous `atStep('stores', ...)` callback and starts the three purge timers there. It passes them to `createApp` (`app.ts:72,119,122`). `app.ts:201-202` defaults reports and waitlist to the in-memory classes.
- `Opened` (`lifecycle.ts:198-220`) holds the concrete classes and calls `close()`, which is on no interface. `scheduleCostSweep` takes `NodeSqliteUsageStore`.
- Interfaces already act as ports. Routes, `runAdminCli`, `runWaitlistCli` and the purge schedulers take interfaces. `StartServerOptions.overrides` carries `model`, `statsTransport`, `creditTransport` and `wrapApp`, not stores.
- `admin/main.ts` and `waitlistMain` construct the SQLite classes directly. `server/build.mjs` l.89-91 is where the emitted entry set shows up.
- Test seams: `InMemory*` twins are in 15 suites. `route-doubles.ts:79` `RecordingUsageStore` wraps any `UsageStore`.

## Risks and unknowns
- I did not verify what Firestore offers for 2 COUNTs plus INSERT as one atomic step (the `admit` contract).
- I did not verify whether one run can emit more than one `usage` event. That would multiply `credit` writes.
- `credit` is a read-modify-write increment on a hot per-device row. Per-device write contention is unmeasured.
- `summary()` and waitlist `export` read all rows. `listUnresolvedCostRows` filters on `generation_ids`, `ended_at`, `cost_state` with no matching index. Query and index needs are not derivable from code.
- 11 suites read the SQLite files raw via `DatabaseSync` and assert schema or rows: `device-records` (migration and rollback), `ledger`, `admin` (a held-open transaction), `diagnostics`, `waitlist`, `routes-*`, `resolver`, `prod-build`, `e2e`. Those assertions are SQLite-shaped.
- `WaitlistStore` is synchronous, and `/beta` and `waitlist/cli.ts` rely on that. `NodeSqliteUsageStore`'s constructor runs migrations synchronously inside the `atStep('stores', ...)` boot callback.
- `server-admission-control`, `content-reports`, `server-deployment`, `device-records` and `beta-waitlist` are not in `openspec/specs/`, though `docs/capabilities.md` lists them as live. The live `generation-server` spec says "one durable store ... `node:sqlite`". The change-folder version says "exactly two durable stores ... both `node:sqlite` databases opened in WAL mode". I did not read the beta-waitlist spec in full.
- I found no `0600` or `0700` requirement in any server spec. The only `0600` hit is the VM `.env` (`docs/deploy.md:308`).
- I did not read `deploy/` (Dockerfile, Cloud Run files) or whether `whim-admin.mjs` ships in the Cloud Run image. I did not verify `declaredRuntimePackages()` contents.
- Stray `.server-acceptance.*.tmp.mjs` and `server/.dev-server.*.tmp.mjs` files at the repo root inflated grep counts and were ignored.

## Open questions for the planner
1. Operators cannot `exec` into a Cloud Run instance. Should the admin and waitlist commands keep their command surface, and where do they run (laptop, one-off job)?
2. `secure_delete` and the "own file" separation of reports and the ledger are SQLite properties with no Firestore equivalent. Which spec requirements become deltas and which are restated?
3. Is the "no `await` between count and insert" contract and the spec's atomic admission to stay strict, or may the spec change?
4. Where do the spec deltas land: the in-flight `public-generation-server`, `legal-surface-v2` and `beta-waitlist` change specs, or the live `generation-server` spec?
5. Is `waitlist` to stay synchronous, or may its interface become async like the other two?
