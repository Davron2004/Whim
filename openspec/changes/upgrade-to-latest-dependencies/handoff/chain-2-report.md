# chain-2 (deps-w2-node-26): builder report

NODE: v26.13.1 (npm 11.20.0, ICU 78.3, Unicode 17.0) for every command below.

## Files changed and why

Task 2.1 (commit 7c6127e9):
- `package.json`, `server/package.json`: `engines.node` `>= 22.11.0` / `>=22.11.0` → `>=26`.
- `contract/package.json`: had no `engines`; added `"node": ">=26"`.
- `.nvmrc`: `22` → `26`.
- `package-lock.json`: `npm install` on Node 26; the only diff is the three `engines` blocks (no package moved).

Task 2.2 (commit 7edd044c):
- `.github/workflows/invariants.yml`: both `setup-node` steps `node-version: 22` → `26` (the only workflow).
- `.devcontainer/Dockerfile`: `FROM node:22-bookworm` → `node:26-bookworm` (tag exists; kept the unpinned-tag style the file already used) and its toolchain comment. `.devcontainer/README.md:33` "Node 22" → "Node 26".
- `deploy/Dockerfile`: all three stages → `node:26.13.1-bookworm-slim@sha256:5df79989…b0f1`; the line-6 comment says Node 26.
- `deploy/loadtest/Dockerfile`: its build stage → the same pinned image, so prod and the load test run one major.
- `deploy/deploy.sh`: `preflight_node` refuses any major but 26 (both messages say "Node 26"); header comment updated. `deploy/lib.sh` and `deploy/cloudrun/*.sh` carry no Node-major check (checked).
- `server/test/deploy-config.suite.ts`: the node stub's default version `22.11.0` → `26.13.1` (so every deploy.sh scenario that reaches gcloud proves 26 is accepted); the refusal case now runs for `24.1.0` and `22.23.5` (the old accepted major), each asserting exit 1, `Node <v> is running` and `needs Node 26`, and no gcloud call.
- `scripts/release/lib/preflight.ts` + `checks/test/release/release-cli.suite.ts` (class A, not in the brief's list): the release preflight refused any Node major but 22, which would block every mobile release on the Node this change mandates. Moved to 26; the fixture's clean snapshot is 26 and a new case proves a Node 22 snapshot yields exactly one finding naming 22 with the Node 26 fix.
- `openspec/specs/generation-server/spec.md` line 4 (Purpose): "Node 22" → "Node 26". Line 16 (requirement) left to the delta spec.
- `README.md:138`, `demo/README.md:22`: required Node version → 26 (class A).
- Server esbuild targets (see decision): `server/{admin,build,config-check,dev,flowbench,loadtest,site,waitlist}.mjs`, `server/test/{run,e2e.run,firestore.run,firestore-admission.run}.mjs`, `server/test/e2e.ts`, `server/test/prod-build.suite.ts`: `target: 'node22'` → `'node26'`; `server/build.mjs` doc comment "ESM for Node 22" → 26; `server/test/run.mjs` trailing comment reworded (it justified node22 by node:sqlite).

## Image digest

`node:26.13.1-bookworm-slim` exists. Resolved with read-only `docker buildx imagetools inspect node:26.13.1-bookworm-slim`: OCI image index `sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1` (multi-arch: linux/amd64 `sha256:18a166e2…f079`, linux/arm64/v8 `sha256:8261241c…7768`, linux/ppc64le, plus attestations; created 2026-11-11). The index digest is what is pinned, as before. The image was not built (task 2.4 is the dispatcher's).

## esbuild-target decision

Rule: **every esbuild target in the `server/` workspace (its build, dev, ops entry points and test runners) names the Node major the server runs on, i.e. the `engines` floor: `node26`.** It is a syntax-lowering target, so node22 output would also run on 26; the point is one honest number that moves with `engines`. Not applied outside `server/`: `build/` is control plane (`node20`), and the other suites' runners (`checks/`, `src/host/*`, `synthrun/`, `scripts/`, `evals/test`) use `node20`, `evals/cli.mjs` and `evals/judge/live.ts` use `node22`; those are tooling, not the server, and were left as they were.

## Suites on Node 26 (worktree, after both commits' edits)

| command | exit | result |
|---|---|---|
| `npm install` | 0 | lockfile: engines only |
| `npm run build` | 0 | |
| `npm run typecheck` | 0 | tsc clean; typecheck:tests OK, 175 suite files |
| `npm run lint` | 0 | eslint clean |
| `npm run checks:test` | 0 | PASS 478 · FAIL 0 |
| `npm run server:test` | 0 | 5581 passed, 0 failed |
| `npm run launcher:test` | 0 | 20354 checks passed, 0 failed |
| `npm run sdk:test` | 0 | 15 suites PASS, 0 FAIL |
| `npm run vstore:test` | 0 | 120 checks passed, 0 failed |
| `npm run storage:test` | 0 | 313 checks passed |
| `npm run bridge:test` | 0 | 85 checks passed |
| `npm run synthrun:test` | 0 | 547 checks passed (first try CAPPED at the 180 s default wall cap, exit 137, mid-run with no failure printed; rerun once at 900 s) |
| `npm run evals:test` | 0 | 243 passed, 0 failed |

`node:sqlite` works unflagged on 26 (`DatabaseSync` is a function; storage:test and server:test, which use it, pass with no warning in the storage log). The Extended_Pictographic source scan is already Node-independent (its own Unicode 17 table, checks/test/repo/extended-pictographic.ts); it passes in checks:test; Node 26 ships Unicode 17.0 anyway.

## Failures found and root causes

None. No suite failed on Node 26. The only non-green run was synthrun:test killed by the watchdog's 180 s default wall cap (the suite drives headless Chromium and needs longer); it passed in full on the rerun. Not a Node-26 failure.

`npm install` printed npm 11's notice that five packages' install scripts are "not yet covered by allowScripts" (`@fission-ai/openspec`, `esbuild`, `fsevents`, `protobufjs`, `re2`). It is a warning; build and all suites ran. Worth tracking if a later npm turns it into a refusal.

## "Node 22" mentions deliberately left

- `CLAUDE.md:66` (Node 22 required, engines >=22.11): task 10.1 / decision log own it.
- `docs/decisions.md:436`, `:1203-1204`: append-only decision log; history.
- `docs/v1-roadmap.md:49, :74, :271`, `docs/demo/storyboard.md:62, :81`, `docs/handoff-2026-10-09.md:15`: narrative/historical docs.
- `openspec/specs/generation-server/spec.md:16`, `openspec/specs/server-deployment/spec.md:96`: requirement text; the change's delta specs carry the Node 26 wording and sync at archive.
- `checks/test/repo/extended-pictographic.ts:6-7`: historical account of why the table exists (Node 22.20 vs 22.23); accurate as written.
- `server/src/usage-store.ts:662`, `src/host/storage-engine/bindings/node-sqlite.ts:2`, `src/host/storage-engine/env.d.ts:2`: "Node 22+" — states when `node:sqlite` became built-in; still true.
- `evals/cli.mjs:182`, `evals/judge/live.ts:72`: esbuild `node22` targets outside the server workspace (see decision).
- `docs/release/mobile.md`, `docs/harness.md`: grep found no literal "Node 22" there; not touched.

## Report

CHAIN: chain-2 (deps-w2-node-26)
STATUS: complete
TASKS: 3/3 builder parts done (2.1, 2.2; 2.3's direct Node-suite runs). 2.3's gate.sh/gate-full.sh runs belong to the runner; 2.4 (deploy) belongs to the dispatcher.
GATE: not run by the builder (override 2); every listed Node suite + typecheck + lint + build green on v26.13.1
COMMIT: 7c6127e9 (2.1), 7edd044c (2.2), plus the commit adding this handoff
WORKTREE: .claude/worktrees/upgrade-to-latest-dependencies-chain-2 · BRANCH: chain/upgrade-to-latest-dependencies-chain-2
DEVIATIONS: [A] release preflight (scripts/release/lib/preflight.ts) moved from Node 22 to 26 with a new refusal test; it would otherwise refuse every release on the mandated Node. [A] added `engines` to contract/package.json (it had none). [A] README.md / demo/README.md Node line → 26.
CONTRACT: none
FILES TOUCHED: see "Files changed and why" (31 files + this handoff)

## HARNESS FEEDBACK

- ENV / DRAWBACK: the RSS watchdog's 180 s default wall cap killed synthrun:test mid-run (exit 137, no failure printed). Cost: one wasted ~3 min run. Evidence: c2-synthrun first run "CAPPED: exceeded 180 s wall time". The brief lists synthrun among the small suites; it drives Chromium and needs `--secs 900` like launcher/server. Proposal: list synthrun:test with the large-suite caps in the builder brief.
- NEUTRAL: background-agent waiting. With `sleep` blocked, waiting on a background suite worked as `timeout 170 grep -m1 -q EXIT <(tail -f <task output>)`; cheaper than repeated peeks.
- CAUGHT-REAL-MISTAKE (in the brief's grep, not in code): the brief's grep pattern missed `scripts/release/lib/preflight.ts`, which hard-refuses any Node major but 22 (`nodeMajorVersion !== 22`); a numeric comparison, not a "Node 22" string. Found by grepping `nodeMajorVersion|process.versions.node`. Proposal: future runtime-major moves grep for version comparisons, not only strings.
- What helped: the brief named the deploy-config test line and the digest-pinning style, so the change stayed mechanical; the node stub's default version (22.11.0) was the hidden coupling. Every deploy.sh scenario needed it moved, or the suite would have failed broadly.

## Fix round 1

All commands on Node v26.13.1 via the RSS watchdog.

1. @types/node (MED): added `"@types/node": "^26.6.6"` as a root devDependency (npm latest 26.6.6). Lockfile diff: root hoisted @types/node 25.9.2 -> 26.6.6, its dep undici-types 7.24.6 -> 8.9.0 (moved with it), plus the root devDependencies entry. No other version moved and no nested 25.x copy remains (`npm ls @types/node` shows 26.6.6 deduped everywhere). `npm install` exit 0; `npm run typecheck` exit 0 with no new type error; `npm run lint` exit 0; `npx knip` exit 0, no ignore added.
2. NODE_OPTIONS (LOW): removed `NODE_OPTIONS=--disable-warning=ExperimentalWarning` and its comment from deploy/Dockerfile. Grep of server/, deploy/, scripts/ found no other reference and no test pinning it; server/src uses only node:crypto/fs/http/module/net/os/path/sqlite/url/util, and Node 26.13.1 prints no node:sqlite warning (reviewer verified), so no replacement justification is needed.
3. Loadtest digest pin (LOW): server/test/deploy-config.suite.ts gains `loadtestDockerfileProblems` (reuses `fromProblems`, which now takes a set of external build args: a global ARG without a default may be named as `FROM ${ARG}` in place of a digest). Tests: clean real file; red: stripping the build-stage digest fails ("is not pinned by digest"); red: `ARG SERVER_IMAGE=node:latest` (default makes it a registry reference) fails. Red-check: replaced the check's FROM handling so it saw no FROM; `git diff --stat` showed the file modified, `npm run server:test -- --only deploy-config` exit 1 with both new red cases XX (`problems: []`); restored, the run passed (794 passed, 0 failed).
Full `npm run server:test`: exit 0, 5584 passed, 0 failed.
