# Pending Class-2 edits — eval-harness (chain-G, task 7.1)

**RECORD ONLY. No chain applies any of this.** These four files are protected by
`.claude/hooks/protect-harness.sh` and can only be changed by an attended human (or the
one-shot Codex protected-patch path in `docs/harness.md` §Class 2). Until a human applies
them, the corpus-eval suite is **not** wired into `npm run` or the gate — every chain that
needs to run it invokes it directly as `node evals/test/run.mjs`, so no chain is blocked
on this task landing.

## Dependency map — what breaks if you apply a subset

- **(a) `package.json`** is the root prerequisite: without it, `npm run evals:test` and
  `npm run evals` do not exist as commands at all — (c)'s `gate.sh` line would fail
  immediately with "missing script" if applied without (a).
- **(b) `tsconfig.json`** is independent of the others: without it, `npm run typecheck`
  (which `gate.sh` already runs) will attempt to type-check `evals/test/**` as ordinary
  app code and fail on its `process`/dynamic-import usage.
- **(c) `scripts/gate.sh`** depends on (a) (see above). Without (c) alone, (a)/(b)/(d)
  can be applied safely, but the corpus-eval suite still never runs automatically — the
  fast gate (and `gate-full.sh`, which is `gate.sh` plus more) has no line invoking it, so
  a regression in `evals/test` would go undetected by the harness.
- **(d) `knip.json`** is independent of the others: without it, knip's workspace map for
  `"."` silently skips `evals/`, so unused-export/dependency findings under `evals/` never
  surface in `gate-full.sh`'s knip check (they aren't a false negative that fails anything
  today — they are a silent gap, since knip only checks what's listed).

Apply order does not matter functionally (each edit is additive to a different file), but
apply **(a) before (c)** or `gate.sh`'s new line will reference a script that doesn't exist
yet if the gate happens to run mid-application.

---

## (a) `package.json` — add two scripts

Current context (the tail of the `"scripts"` block, lines 22–28 of `package.json` at
BASE `336daa7`):

```json
    "sdk:test": "node src/sdk/test/run.mjs",
    "checks:test": "node checks/test/run.mjs",
    "invariants": "node invariants/sandbox-isolation/run-against-build.mjs",
    "bridge:invariants": "node invariants/sandbox-isolation/bridge/runner.mjs",
    "server:dev": "node server/dev.mjs",
    "server:test": "node server/test/run.mjs",
    "guard:metro": "node server/guard-metro.mjs"
```

Resulting lines — insert the two new scripts immediately after `"checks:test"` (grouping
with the other Node-acceptance-suite scripts, before the invariants/server group):

```json
    "sdk:test": "node src/sdk/test/run.mjs",
    "checks:test": "node checks/test/run.mjs",
    "evals:test": "node evals/test/run.mjs",
    "evals": "node evals/cli.mjs",
    "invariants": "node invariants/sandbox-isolation/run-against-build.mjs",
    "bridge:invariants": "node invariants/sandbox-isolation/bridge/runner.mjs",
    "server:dev": "node server/dev.mjs",
    "server:test": "node server/test/run.mjs",
    "guard:metro": "node server/guard-metro.mjs"
```

Only two lines are new (`"evals:test"` and `"evals"`); everything else shown is existing,
unmodified context to locate the insertion point.

---

## (b) `tsconfig.json` — add `evals/test` to `exclude`

Current context (part of the `"exclude"` array, lines 33–41 of `tsconfig.json` at BASE
`336daa7`):

```json
    // And the launcher Node suite (back-policy / app-index / store-access / seed; uses
    // `process`, run via esbuild). The launcher MODULES themselves stay type-checked.
    "src/host/launcher/test",
    // Same idiom for the static-check pipeline's Node acceptance runner (esbuild-bundled,
    // run via `npm run checks:test`, not shipped). The checker MODULES stay type-checked.
    "checks/test",
    // The server-lane workspaces are Node-flavored (their own tsconfigs, moduleResolution
    // bundler, node types). They are type-checked by `npm run server:test` (tsc --noEmit over
    // both), NOT by the RN root config — which would mis-apply react-jsx/RN lib settings.
    "contract",
```

Resulting lines — insert a new entry (with comment, matching the existing "Same idiom for
the X Node suite" style) immediately after `"checks/test",` and before the server-lane
comment block:

```json
    // And the launcher Node suite (back-policy / app-index / store-access / seed; uses
    // `process`, run via esbuild). The launcher MODULES themselves stay type-checked.
    "src/host/launcher/test",
    // Same idiom for the static-check pipeline's Node acceptance runner (esbuild-bundled,
    // run via `npm run checks:test`, not shipped). The checker MODULES stay type-checked.
    "checks/test",
    // Same idiom for the eval-harness's Node acceptance runner (uses `process`/dynamic
    // import). Validated by running it (`npm run evals:test`), not by tsc.
    "evals/test",
    // The server-lane workspaces are Node-flavored (their own tsconfigs, moduleResolution
    // bundler, node types). They are type-checked by `npm run server:test` (tsc --noEmit over
    // both), NOT by the RN root config — which would mis-apply react-jsx/RN lib settings.
    "contract",
```

Only the two new lines (comment + `"evals/test",`) are new.

---

## (c) `scripts/gate.sh` — add the `corpus-eval` check line

Current context (lines 62–64 of `scripts/gate.sh` at BASE `336daa7`, inside the sequence
of `check` invocations):

```bash
check "SDK"               npm run -s sdk:test
check "static-checks"     npm run -s checks:test
check "sonar ingestion"   node scripts/test/sonar-pr-issues.test.mjs
```

Resulting lines — insert the new line immediately after `"static-checks"` and before
`"sonar ingestion"`, i.e. at the end of the group of suite-`check` lines (vstore,
storage-engine, capability-bridge, launcher, server, SDK, static-checks) and before the
group of harness-self-test `check` lines (sonar ingestion, fixloop preflight, bash policy,
compound unroller, Codex hook adapters, Codex protected approval):

```bash
check "SDK"               npm run -s sdk:test
check "static-checks"     npm run -s checks:test
check "corpus-eval"       npm run -s evals:test
check "sonar ingestion"   node scripts/test/sonar-pr-issues.test.mjs
```

Only `check "corpus-eval"       npm run -s evals:test` is new. Column alignment matches
the existing lines (name column padded so the command starts at the same offset as the
surrounding `check` lines — count spaces to match, e.g. `"corpus-eval"` is 13 chars incl.
quotes, same width class as `"static-checks"` (16 chars) — pad with spaces so `npm` lines
up at column 27, same as the other entries).

---

## (d) `knip.json` — extend the `"."` workspace

Current context (the `"."` workspace block, lines 20–46 of `knip.json` at BASE
`336daa7`):

```json
    ".": {
      "entry": [
        "build/assemble.mjs",
        "build/react-inject.js",
        "build/react-inject-shim.ts",
        "build/vc-sdk-inject.ts",
        "src/sdk/index.tsx!",
        "src/sdk/test/*.acceptance.ts",
        "src/sdk/test/*.acceptance.tsx",
        "src/host/bridge/index.ts!",
        "src/host/storage-engine/index.ts!",
        "src/host/version-store/index.ts!",
        "src/host/launcher/index.ts!",
        "src/host/**/test/**",
        "src/host/**/device-acceptance.ts",
        "invariants/**/*.mjs",
        "fixtures/**/*.app.tsx",
        "checks/test/**"
      ],
      "project": [
        "App.tsx",
        "src/**/*.{ts,tsx,js}",
        "build/**/*.{ts,mjs,js}",
        "invariants/**/*.{mjs,js}",
        "fixtures/**/*.tsx",
        "checks/**/*.ts"
      ]
    },
```

Resulting lines — append `"evals/test/**"` and `"evals/cli.mjs"` to the `"entry"` array
(after `"checks/test/**"`, the last existing entry), and append `"evals/**/*.ts"` to the
`"project"` array (after `"checks/**/*.ts"`, the last existing entry):

```json
    ".": {
      "entry": [
        "build/assemble.mjs",
        "build/react-inject.js",
        "build/react-inject-shim.ts",
        "build/vc-sdk-inject.ts",
        "src/sdk/index.tsx!",
        "src/sdk/test/*.acceptance.ts",
        "src/sdk/test/*.acceptance.tsx",
        "src/host/bridge/index.ts!",
        "src/host/storage-engine/index.ts!",
        "src/host/version-store/index.ts!",
        "src/host/launcher/index.ts!",
        "src/host/**/test/**",
        "src/host/**/device-acceptance.ts",
        "invariants/**/*.mjs",
        "fixtures/**/*.app.tsx",
        "checks/test/**",
        "evals/test/**",
        "evals/cli.mjs"
      ],
      "project": [
        "App.tsx",
        "src/**/*.{ts,tsx,js}",
        "build/**/*.{ts,mjs,js}",
        "invariants/**/*.{mjs,js}",
        "fixtures/**/*.tsx",
        "checks/**/*.ts",
        "evals/**/*.ts"
      ]
    },
```

Only `"evals/test/**"`, `"evals/cli.mjs"` (entry) and `"evals/**/*.ts"` (project) are new;
note the trailing comma added to `"checks/test/**"` and `"checks/**/*.ts"` since they are
no longer the last element of their arrays. Indentation and double-quote style match the
rest of the file exactly (2-space nesting, no trailing commas on true last elements).
