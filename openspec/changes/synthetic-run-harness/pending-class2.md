# Pending Class-2 edits: synthetic-run-harness (chain 5, task 5.3)

Chain 5 (`chain-5`) cannot edit `package.json` or `scripts/gate.sh` (both hard-blocked for
subagents). The suite is fully written and green (`node synthrun/test/run.mjs` — 75 checks) and
is runnable directly meanwhile. Two exact one-line additions are needed for a human/attended
session to apply, mirroring the existing suite pattern (`checks:test`/`bridge:test`'s own
wiring):

## 1. `package.json` — add a `scripts` entry

Insert after the existing `"checks:test"` line (`node checks/test/run.mjs`):

```json
    "synthrun:test": "node synthrun/test/run.mjs",
```

## 2. `scripts/gate.sh` — add a `check` line

Insert after the existing `check "static-checks"     npm run -s checks:test` line:

```sh
check "synthetic-run"     npm run -s synthrun:test
```

(Alignment of the `check "..."` column is cosmetic — match the surrounding lines' spacing when
applying.)

Once both land, `./scripts/gate.sh` exercises `synthrun/test/run.mjs` on every fast-gate run,
same as every other subsystem's Node acceptance suite.
