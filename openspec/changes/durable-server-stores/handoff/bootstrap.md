# handoff: bootstrap (chain-0)

## Command

`npm run stores:firestore:test` — runs from the repo root, is a `gate-full.sh` step
(`firestore-stores`), and runs in CI's `isolation-suite` job after Java 21 is installed.

It expands to:

```
npx --ignore-scripts --package=firebase-tools@15.32.1 firebase emulators:exec \
  --config server/test/firebase.json --only firestore --project demo-whim-conformance \
  "node server/test/firestore.run.mjs"
```

`firebase-tools@15.32.1` is an exact root devDependency, so `npx` resolves it locally (no download).
`@google-cloud/firestore@9.3.1` is an exact `server` workspace dependency (ships in the
Dockerfile's `npm ci --omit=dev --workspace server` stage).

## Conformance entry

- Path: `server/test/firestore.run.mjs` (plain Node ESM, run directly — not bundled by
  `server/test/run.mjs`). Chains that need TS must have this entry bundle a TS suite the same way
  `run.mjs` does; it must keep exiting non-zero on any failure.
- Today: zero conformance cases plus one emulator write/read round-trip. Chains 2–3 replace the
  body with the shared cases from `server/test/store-conformance.suite.ts` (chain-1's export).
- Keep the 30 s ref'd watchdog (or an equivalent per-case timeout): the Firestore client retries
  an unreachable emulator forever, which would otherwise hang the gate unnamed.

## Environment the entry sees

| var | value | set by |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8085` | `emulators:exec` |
| `GCLOUD_PROJECT` | `demo-whim-conformance` | `emulators:exec` |

The entry refuses to run (exit 1) when `FIRESTORE_EMULATOR_HOST` is unset.

## Invariants

- Project id MUST keep the `demo-` prefix: the emulator then runs fully offline with no
  credentials and refuses non-emulated Google calls. (tasks.md 1.2 said `whim-conformance`;
  the prefix is the deviation.)
- One emulator process per run; data is in-memory and discarded at exit. Isolate cases with
  per-case collection prefixes or doc ids, not a fresh emulator.
- The emulator supports only the `(default)` database ("does not support multiple databases
  yet"). Tests of `WHIM_FIRESTORE_DATABASE` against the emulator must use `(default)`; a named
  database is a production-only path.
- Port 8085 is fixed in `server/test/firebase.json`; UI disabled. Two concurrent runs on one host
  collide — `gate-full.sh` already requires an exclusive tree.
- `firestore-debug.log` is written to the repo root and is gitignored.
