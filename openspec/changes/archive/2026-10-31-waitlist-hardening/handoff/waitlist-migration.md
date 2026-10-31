# handoff: waitlist-migration (chain-3 → chain-7 docs, rollout §8)

Module `server/src/admin/migrate-waitlist.ts`; routed by `server/src/admin/main.ts` (opens no store,
like `import-sqlite`). Import: `server/src/admin/import-sqlite.ts`.

## Command line

```
whim-admin migrate-waitlist            # dry run: reads only, writes nothing
whim-admin migrate-waitlist --apply    # writes
```

Any other argument → exit 1, output exactly `Usage: migrate-waitlist [--apply]\n`, nothing read.
Backend = `WHIM_STORE_BACKEND` (config loads as for every admin command; on `firestore` the
`WHIM_WAITLIST_FINGERPRINT_KEY` is required, see handoff/waitlist-store.md).

```ts
export type MigrateConfig = Pick<ServerConfig, 'storeBackend' | 'firestoreDatabase' | 'dataDir' | 'waitlistFingerprintKey'>;
export interface MigrateDeps { readonly openFirestore?: (database: string) => Promise<Firestore>; readonly root?: (db: Firestore) => FirestoreRoot }
export function runMigrateWaitlist(argv: readonly string[], config: MigrateConfig, deps?: MigrateDeps): Promise<AdminCliResult>;
```

## Output (stdout; never an address)

Line 1: `migrate-waitlist dry run on <target>: nothing is written (--apply writes)` or
`migrate-waitlist --apply on <target>`; `<target>` = `firestore database <id>` | `sqlite <path>`.

One line per row, oldest signup first, single-space separated:

```
<outcome> <fp12> platform=<p> noticeId=<id> createdAt=<ms> updatedAt=<ms> updatesOptIn=<bool> updatesConsentAt=<ms|null> updatesConsentNoticeId=<id|null> updatesWithdrawnAt=<ms|null>
```

- `<fp12>` = first 12 hex of `waitlistFingerprint(WHIM_WAITLIST_FINGERPRINT_KEY, email)` (keyed; the
  same key gives the same prefix across runs, so outputs diff per row).
- Consent fields are what the row reads as: for a legacy row, the planned mapping
  (`waitlistRowFromLegacy`: no consent; ticked opt-out → `updatesWithdrawnAt = updatedAt`).
- `<outcome>`: dry run `planned` | `already-migrated`; apply `migrated` | `already-migrated` |
  `gone` (removed between the read and its rewrite) | `not-migrated`.
- `cut -d' ' -f2-` of a `planned`, `migrated`, `already-migrated` or `read-back` line is the same
  text for the same row whenever the row is unchanged.

Totals line (always exactly one):
- dry run: `totals: <P> planned, <A> already migrated, <T> total`
- apply: `totals: <M> migrated, <A> already migrated, <T> total`

Apply only, after the totals:
- `gone: <G> row(s) removed between the read and their rewrite` (only when G > 0)
- `nothing to migrate: every row is already in the opt-in model; nothing was written` (no legacy
  row at the read; nothing is written on either backend)
- the verification read: one `read-back <fp12> …` line per row now stored, then either
  `verified: <N> row(s) read back, none in the opt-out model, every earlier row unchanged`
  or one `VERIFY FAILED <fp12>: <reason>` line per problem.

**"Already migrated"** = the row was stored in the opt-in model at the first read (Firestore: a
boolean `updatesOptIn` field; SQLite: non-NULL `updates_opt_in`), or (apply) a server rewrote it
between the read and its own transaction. A migrated row is never rewritten again.

## Exit codes

| code | meaning |
|---|---|
| 0 | dry run done; or apply done and verified |
| 1 | usage error, or SQLite `waitlist.db` absent (`no waitlist at <path>; nothing was read or written`); nothing read |
| 2 | a row is unreadable (field missing / wrong type / platform outside the set): every row listed, `unreadable <fp12> (<field>)`, then `refused: <U> row(s) cannot be read; nothing was written`; or the verification read failed |

A failed read or write rejects (non-zero exit with the error), as `import-sqlite` does.

## Guarantees (tested, SQLite and Firestore emulator, legacy rows from BASE's own write code)

- Dry run writes nothing: Firestore documents deep-equal; SQLite `waitlist.db` byte-identical
  (read-only connection; it may leave SQLite's `-shm` and an empty `-wal` beside a WAL file).
- Firestore apply: per legacy row, one transaction that re-reads the doc and writes only if still
  legacy; it `update`s only `updatesOptIn, updatesConsentAt, updatesConsentNoticeId,
  updatesWithdrawnAt, updatesOptOut` (shadow `true`), so email, platform, noticeId, createdAt,
  updatedAt are never written. SQLite apply: opens `NodeSqliteWaitlistStore` once (its open-time
  `BEGIN IMMEDIATE` conversion of `updates_opt_in IS NULL` rows), only when a legacy row was read.
- Verification: every row of the first read (not `gone`) reads back deep-equal (preserved and
  consent fields) and no row is still legacy. Rows are never deleted.
- Idempotent: a second apply reports `0 migrated, <T> already migrated` and changes nothing,
  including consent given after the first run.

## import-sqlite additions

- New line after `waitlist:`: `waitlist fingerprints: <I> imported, <K> kept as found[ (no waitlist.db)]`
  (copies `waitlist_suppressed` → `waitlistSuppressed/{fingerprint}` `{ suppressedAt }`; a file
  without the table imports 0). Fingerprints only block under the same key the SQLite server used.
- An opt-out-model `waitlist.db` imports rows in the opt-in model via `readWaitlistFile`; reruns
  change nothing. `export function readWaitlistFingerprints(dbPath): StoredFingerprint[]`
  (`{ fingerprint, suppressedAt }`, read-only).

## Production commands (task 8.x, laptop, attended)

```sh
gcloud auth application-default login
export WHIM_STORE_BACKEND=firestore GOOGLE_CLOUD_PROJECT=anycognition-whim
export WHIM_WAITLIST_FINGERPRINT_KEY="$(gcloud secrets versions access latest --secret whim-waitlist-fingerprint-key)"
node server/admin.mjs migrate-waitlist > "$SCRATCH/migrate-1-dry.txt"            # expect totals: 5 planned, 0 already migrated, 5 total
node server/admin.mjs migrate-waitlist --apply > "$SCRATCH/migrate-2-apply.txt"  # expect 5 migrated + verified:, exit 0
node server/admin.mjs migrate-waitlist > "$SCRATCH/migrate-3-dry.txt"            # expect totals: 0 planned, 5 already migrated, 5 total
diff <(grep -E '^planned ' "$SCRATCH/migrate-1-dry.txt" | cut -d' ' -f2- | sort) \
     <(grep -E '^already-migrated ' "$SCRATCH/migrate-3-dry.txt" | cut -d' ' -f2- | sort)   # expect no output
```

`$SCRATCH` = the session scratchpad, never `~/.config/whim/`. The Firestore backend refuses to load
without the key, so the secret must exist before the first (pre-deploy) dry run; export the same
key for every run so the prefixes match across the saved outputs.
