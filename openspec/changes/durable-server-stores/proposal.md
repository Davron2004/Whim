## Why

Since decision #71, production runs on Cloud Run scaled to zero. The server's three SQLite stores (usage ledger, reports, beta waitlist) now live in instance memory and vanish whenever the instance stops. That loses beta signups and user reports, and resets the daily spending ceilings. The owner wants that data in a database that exists independently of the backend: it stays alive with zero instances running and is never erased by an instance stopping.

## What Changes

- Add a **Firestore backend** for all three stores (`UsageStore` + `UsageRecordKeeping`, `ReportStore` + `ReportRecordKeeping`, `WaitlistStore`). It targets the `(default)` Native-mode database in `northamerica-northeast1`, which already exists (free tier, delete protection on).
- Keep **node:sqlite as a selectable backend**. Self-hosters (decision #70) and the existing suites keep it unchanged. One operator setting chooses the backend, and SQLite stays the default.
- **Atomic admission on Firestore.** The daily device and global ceilings are enforced inside one Firestore transaction, so two concurrent requests still cannot both take the last unit, and the counts now survive restarts and scale-to-zero.
- **BREAKING (internal API):** `WaitlistStore` becomes asynchronous like the other two stores. Its callers (`/beta/signup`, the waitlist CLI, purge timer, suites) await it. There is no wire change.
- Store construction moves behind one factory used by boot, the admin CLI and the waitlist CLI. `close()` joins the store interfaces, and the cost sweep takes the interface instead of the SQLite class.
- **Operator commands work against Firestore from a laptop.** `whim-admin` and `whim-waitlist` reach the production database with the operator's Application Default Credentials. They replace `docker compose exec`, which has no Cloud Run equivalent.
- **One-off import.** A command copies an existing SQLite data directory into Firestore idempotently, starting with the VM backup of 2026-10-07 (5 waitlist rows, 11 reports, the ledger).
- Retention purges keep their periods, timers and manifest ceilings on both backends.
- `deploy/cloudrun/deploy.sh` selects the Firestore backend and applies the composite indexes the queries need. The runbook, decision log and capability map describe the new state.

## Capabilities

### New Capabilities
- `server-storage-backends`: where the server's durable records live. It covers the two selectable backends with identical store semantics, atomic admission on each, durability across restarts and scale-to-zero, retention parity, operator access from outside the instance, and the SQLite-to-Firestore import.

### Modified Capabilities
- `generation-server`: the requirement "Token metering — the only server state" stops pinning the store to `node:sqlite` under `WHIM_DATA_DIR`. The counter lives in whichever durable backend is configured, and Model 1 (no prompts, source or bundles stored outside the report exception) is unchanged.

## Impact

- **Code:** `server/src/usage-store.ts`, `server/src/reports/store.ts` and `server/src/waitlist/store.ts`, plus new Firestore implementations and a store factory. Also `server/src/lifecycle.ts` (boot step, `Opened`, cost sweep), `server/src/routes/beta-signup.ts`, `server/src/admin/main.ts`, `server/src/waitlist/cli.ts` and `server/src/config.ts` (backend settings).
- **Dependencies:** `@google-cloud/firestore` in the server workspace only (Metro must stay unaffected: `guard:metro`). The Firestore emulator, which needs Java, is used for the backend's acceptance suite.
- **Tests:** a backend conformance suite runs every store contract against SQLite, in-memory and the Firestore emulator. The existing SQLite-shaped suites stay.
- **Deploy and ops:** `deploy/cloudrun/deploy.sh` (env and indexes), `docs/deploy.md` (Cloud Run section, operator commands), `docs/decisions.md` (#72) and `docs/capabilities.md`.
- **Spend:** Firestore's free tier (1 GiB, 50k reads and 20k writes a day) covers expected volume, and nothing is billed while idle.
