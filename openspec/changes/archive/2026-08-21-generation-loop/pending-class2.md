# Pending Class-2 edits: generation-loop (chain 6, task 6.5)

Chain 6 (`chain-6`) cannot edit `package.json` or `scripts/gate-full.sh` (both hard-blocked for
subagents). The browser-backed suite is fully written and green (`node server/test/e2e.run.mjs` —
31 checks) and is runnable directly meanwhile. Two exact one-line additions are needed for a
human/attended session to apply, mirroring the existing suite pattern
(`openspec/changes/synthetic-run-harness/pending-class2.md`'s own `synthrun:test` wiring):

## 1. `package.json` — add a `scripts` entry

Insert after the existing `"server:test": "node server/test/run.mjs",` line:

```json
    "server:e2e": "node server/test/e2e.run.mjs",
```

## 2. `scripts/gate-full.sh` — add a `check` line

Insert after the existing `check "bridge-invariants" npm run -s bridge:invariants` line:

```sh
check "generation-e2e"    npm run -s server:e2e
```

(Alignment of the `check "..."` column is cosmetic — match the surrounding lines' spacing when
applying.)

Once both land, `./scripts/gate-full.sh` exercises `server/test/e2e.ts` (Chromium via
`synthrun`'s real check/build/run stages) on every full-gate run, alongside `invariants` and
`bridge-invariants` — never in the fast gate, matching `specs/generation-server/spec.md`'s
"Blocking server suite in CI" requirement that the browser-backed suite runs only in the full
gate.
