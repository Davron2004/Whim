# handoff: waitlist-store (chain-2 → chain-3, chain-4, chain-7, rollout §8)

Module `server/src/waitlist/store.ts` unless noted. Firestore: `server/src/firestore/waitlist-store.ts`.

## Interface (verbatim)

```ts
export interface WaitlistConsent {
  readonly updatesOptIn: boolean;                 // news may be sent now
  readonly updatesConsentAt: number | null;       // latest consent; kept as its record after a withdrawal
  readonly updatesConsentNoticeId: string | null; // a notice id, or 'written-request'
  readonly updatesWithdrawnAt: number | null;     // while set, no signup changes any of the four
}
export interface WaitlistSignup { readonly email: string; readonly platform: WaitlistPlatform; readonly updatesOptIn: boolean; readonly noticeId: string; readonly now: number }
export interface WaitlistRow extends WaitlistConsent { readonly email: string; readonly platform: WaitlistPlatform; readonly noticeId: string; readonly createdAt: number; readonly updatedAt: number }
export interface LegacyWaitlistRow { readonly email: string; readonly platform: WaitlistPlatform; readonly updatesOptOut: boolean; readonly noticeId: string; readonly createdAt: number; readonly updatedAt: number }
export interface WaitlistFilter { readonly platform?: WaitlistPlatform; readonly updatesOk?: boolean /* rows with updatesOptIn */ }
export type UpsertOutcome = 'stored' | 'updated' | 'suppressed';
export interface WaitlistPurgeCounts { readonly rows: number; readonly fingerprints: number }
export interface WaitlistStoreOptions { readonly fingerprintKey: string }

export interface WaitlistStore {
  upsert(signup: WaitlistSignup): Promise<UpsertOutcome>;
  export(filter?: WaitlistFilter): Promise<WaitlistRow[]>;          // oldest signup first
  remove(email: string, now: number): Promise<boolean>;             // whether a row existed; fingerprint ALWAYS kept (at now)
  setUpdates(email: string, on: boolean, now: number): Promise<boolean>; // whether a row existed; updated_at untouched
  restore(email: string): Promise<boolean>;                         // whether a fingerprint was kept
  purge(now: number): Promise<WaitlistPurgeCounts>;
  close(): Promise<void>;
}
```

Constructors: `new InMemoryWaitlistStore(options?: Partial<WaitlistStoreOptions>)` (random per-instance key
when absent; `insertLegacyRow(row: LegacyWaitlistRow)` holds an opt-out-model row, tests only),
`new NodeSqliteWaitlistStore(dbPath, options: WaitlistStoreOptions)`,
`new FirestoreWaitlistStore(db, root, options: WaitlistStoreOptions)`. A key shorter than
`WAITLIST_FINGERPRINT_KEY_MIN_LENGTH` (32) throws, without echoing it.

## Rules (shared pure functions)

- `consentAfterSignup(current | undefined, signup)` — new row: ticked → consent now under the
  signup's notice id, else none. Existing: ticked + (consented or withdrawn) → unchanged; ticked +
  neither → consent now; unticked + consented → withdrawn now (consent record kept); unticked +
  no consent → unchanged.
- `consentAfterOperator(current, on, now)` — on: `{true, now, 'written-request', null}`; off:
  `updatesOptIn=false`, `updatesWithdrawnAt` = existing ?? now.
- **Legacy mapping:** `waitlistRowFromLegacy(row: LegacyWaitlistRow): WaitlistRow` — no consent;
  `updatesOptOut` true → `updatesWithdrawnAt = updatedAt`; email, platform, noticeId, createdAt,
  updatedAt unchanged. Every backend's read and the migration use this one function.
- Constants: `WRITTEN_REQUEST_NOTICE_ID = 'written-request'`, `WAITLIST_RETENTION_DAYS = 730`,
  `WAITLIST_FINGERPRINT_RETENTION_DAYS = 730`. Cutoffs strict `<`: `purgeCutoff(now)` on
  `updatedAt`, `fingerprintPurgeCutoff(now)` on the fingerprint's kept time.

## Fingerprint (ruling 5)

`waitlistFingerprint(key, email)` = hex HMAC-SHA-256(key, `normalizeEmail(email)`). The key lives
only in a closure, never in a stored record, log or export. Firestore row doc id stays
`waitlistDocId(email)` = unkeyed hex SHA-256 of the normalized email (unchanged); only fingerprints
are keyed. A fingerprint written under one key never matches under another; rotating the key
orphans every kept fingerprint (they expire at 730 days).

## Storage names

**Firestore:** `WAITLIST_COLLECTION = 'waitlist'`, doc fields `email, platform, noticeId, createdAt,
updatedAt, updatesOptIn, updatesConsentAt, updatesConsentNoticeId, updatesWithdrawnAt` + shadow
`updatesOptOut` (= `!updatesOptIn`, written on every write, never read). Legacy doc = no
`updatesOptIn` field (typeof not boolean); rewritten whole by its first write.
`WAITLIST_SUPPRESSED_COLLECTION = 'waitlistSuppressed'`, doc id = fingerprint, data exactly
`{ suppressedAt: number }`. `waitlistDocOf(row: WaitlistRow)` builds the stored doc (with shadow).
upsert reads row + fingerprint in one transaction; remove deletes row + sets fingerprint in one.
Purge: `where('updatedAt','<',…)` and `where('suppressedAt','<',…)`, single-field (no index needed).

**SQLite** (`waitlist.db`): table `waitlist(email PK, platform, updates_opt_out INTEGER NOT NULL
/* shadow */, notice_id, created_at, updated_at, updates_opt_in INTEGER /* NULL = legacy */,
updates_consent_at INTEGER, updates_consent_notice_id TEXT, updates_withdrawn_at INTEGER)`; table
`WAITLIST_SUPPRESSED_TABLE = 'waitlist_suppressed'(fingerprint TEXT PK, suppressed_at INTEGER NOT NULL)`.
Opening a store migrates in one `BEGIN IMMEDIATE` transaction: adds missing columns and the table,
converts rows with `updates_opt_in IS NULL` (shadow becomes 1 for all of them), idempotent; WAL and
`secure_delete` stay. So **opening the store writes the file**: a byte-identical dry run must read
through `readWaitlistFile(dbPath)` (read-only, either schema, legacy rows mapped) instead. Rows a
rolled-back revision inserts later (NULL `updates_opt_in`) still read through the mapping.

## Config and deploy

- `ServerConfig.waitlistFingerprintKey` from `WHIM_WAITLIST_FINGERPRINT_KEY` (≥ 32 chars, else
  `ServerConfigError` naming it). Unset → `DEV_WAITLIST_FINGERPRINT_KEY` only on SQLite outside
  production; `NODE_ENV=production` **or** `WHIM_STORE_BACKEND=firestore` with no key (or the dev
  key) refuses to load. `openStores` passes it to both durable stores.
- **Laptop operator commands on Firestore** (`node server/waitlist.mjs …`, `node server/admin.mjs …`)
  therefore need the key exported, e.g.
  `export WHIM_WAITLIST_FINGERPRINT_KEY="$(gcloud secrets versions access latest --secret whim-waitlist-fingerprint-key)"`.
- `deploy/cloudrun/deploy.sh` mounts `--set-secrets "OPENROUTER_API_KEY=…:latest,WHIM_WAITLIST_FINGERPRINT_KEY=<id>:latest"`
  on the server (plain and `--tag`) and the `whim-purge` job (deploy and update). `<id>` =
  `WHIM_WAITLIST_FINGERPRINT_SECRET` (a `WHIM_VALUE_KEYS` entry in `deploy/lib.sh`), default
  `whim-waitlist-fingerprint-key`; an id outside `[A-Za-z0-9_-]+` is refused before any gcloud call.
- **Rollout (chain-7 docs, tasks §8):** create the secret, add one version (a random value of at least
  32 characters, e.g. `openssl rand -hex 32`, piped, never echoed or saved), and grant `whim-run`
  `roles/secretmanager.secretAccessor` on it, all **before** the first deploy of this code. Without it
  the deploy's revision and the purge job fail closed at boot. That is intended. No script adds a
  secret version (the deploy-config tripwire forbids it).
- The retired VM path (`deploy/deploy.sh`) does not pass the key, so a production container there
  would also refuse to boot.

## Purge output

`whim-admin purge` waitlist line: `waitlist: <rows+fingerprints> purged (rows <R>, fingerprints <F>)`.
The other lines are unchanged (`reports: N purged`, …). The hourly in-process purge ignores the counts.

## Interim state left for chain-3/4 (compile-only edits)

- Route: `updatesOptIn: false` on every signup (still validates `updates_opt_out`); `SignupOutcome`
  gained `'suppressed'` (→ thanks).
- CLI: column `updates_opt_out` prints `!updatesOptIn`; `remove` passes `Date.now()` and still exits 1
  when no row existed.
- `import-sqlite` writes `waitlistDocOf(row)`; fingerprints are not imported yet.
