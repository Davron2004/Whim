# c8f1 — CI run 1 fixes (knip pin, server bundle placement)

STATUS: complete. Branch chain/upgrade-to-latest-dependencies-c8f1, BASE 80bb3656, code tip c6ff4da3
(0424fb16 workflow + npx tripwire; 77d5918d bundle placement + test; c6ff4da3 red cases append a step);
this report is the last commit. No package.json / lockfile / eslint change.

## Reproduction (ci-repro at 80bb3656: own `npm ci`, no node_modules in any parent)
- `npx --ignore-scripts --package=knip@6.16.1 knip` → exit 1, `Unlisted dependencies (9)`: `vc-sdk` in
  evals/test/fixtures/candidates/*.app.tsx (2) and fixtures/adversarial/*.app.tsx (7). Same as CI.
- `npm run server:test` → exit 1, `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pino' imported from
  …/ci-repro/.tmp-bundles/server-acceptance.99577.mjs`. Same as CI.

## Fix 1: CI runs the lockfile's tools (.github/workflows/invariants.yml:39-47)
`run: node_modules/.bin/knip` and `run: node_modules/.bin/openspec validate --all --strict`: the binaries
`npm ci` installed from the lockfile, the ones every local gate runs. Chosen over re-pinning: a pin is a
second copy of the version that drifts on the next bump. `npx --no` was tried and rejected: it still ran
the stale knip@6.16.1 because that version sat in the npx cache. No npx means no install for Sonar's
`--ignore-scripts` rule to flag; knip 6.47 parses the path form cleanly (exit 0) and is non-vacuous (a
planted unused file → `Unused files (1)`, exit 1). Playwright's install keeps its pin (the cache key needs
the version; already tripwired).
Tripwire: server/test/deploy-config.suite.ts:3787 `workflowNpxProblems`, :3807 `toolingNpxPinTests`
(called :4693). Every `npx` line in `.github/workflows/*.yml` must carry `--package=<pkg>@<version>` equal
to package-lock.json's `node_modules/<pkg>`. An npx with no pinned package, a versionless pin or a package
the lockfile lacks fails closed. 6 planted cases. Red-check (ci-repro @c6ff4da3): `git diff --stat` → invariants.yml 1+/1- (knip line back to
`npx --ignore-scripts --package=knip@6.16.1 knip`); `server:test --only deploy-config` exit 1:
`XX every npx in a CI workflow pins the version package-lock.json resolves — .github/workflows/
invariants.yml:45: npx installs knip@6.16.1, the lockfile resolves 6.47.0`. Reverted; status clean.

## Fix 2: server bundles resolve from the server workspace
Cause: the bundle sat in `<root>/.tmp-bundles/`. npm puts pino, pino-pretty and @google-cloud/firestore
only in server/node_modules. Node walked root/node_modules, then the PARENT dirs (the primary tree's stale
install). Fix: every runner whose externals are `devBundleExternals(serverDir)` now writes its bundle with
`tmpBundlePath(name, serverDir)` → `server/.tmp-bundles/`. Lookup then goes server/node_modules → root
node_modules, as production resolves from /app/server. It does not depend on hoisting: whichever level npm
picks for a server dep, the walk from server/ reaches it. Sites: server/test/run.mjs:47, e2e.run.mjs:25,
e2e.ts:567, firestore.run.mjs:30, firestore-admission.run.mjs:20, evals/cli.mjs:176. The `root` param is
documented in scripts/lib/tmp-bundle.mjs:4-14, and .gitignore:99 adds `/server/.tmp-bundles/`. The cleanup
guarantees are unchanged: same helper, the tmp-bundle suite passes, both .tmp-bundles dirs end up empty.
server/*.mjs CLIs already bundle into server/. No server externals (all deps installed at the root) in
checks, synthrun, launcher, bridge, storage, vstore, sdk, evals/test, netdeny, release, design-tokens or build/build.mjs.
Test: server/test/prod-build.suite.ts:900 `testSuiteBundleResolvesLikeTheServer` (helpers :70, :87). The
suite's own bundle (`import.meta.url`) must load every devBundleExternals package from the server
workspace's directory, inside the checkout. A fixture (outer/ stale install around an outer/wt checkout)
adds 3 red cases that hold on any install layout.
Red-checks, with the old placement restored in run.mjs and then reverted. Worktree (parent fallback present):
`XX this suite's own bundle loads …` with `pino loads from /Users/…/Whim/node_modules/pino in the bundle,
from …/c8f1/server/node_modules/pino in the server workspace` (+ @google-cloud/firestore). ci-repro:
`ERR_MODULE_NOT_FOUND … 'pino' … ci-repro/.tmp-bundles/server-acceptance.69509.mjs`.

## Full CI sequence in ci-repro @77d5918d (each step run directly, in workflow order, no gate scripts)
quality-gate: build 0 · typecheck 0 · lint 0 · knip 0 · openspec validate 0 (67 items) · tripwires 0.
isolation-suite: build 0 · server:test 0 (5660 passed) · guard:metro 0 (4008015 bytes) ·
stores:firestore:test 0 (62 passed; Java 21 + emulator, local) · storage 0 (313) · bridge 0 (85) ·
launcher 0 · checks 0 (498) · playwright install chromium 0 · build 0 · invariants 0 (22) ·
bridge:invariants 0 (14). ENV: `--with-deps` and the apparmor sysctl are Linux-only, not run.
Extra steps CI doesn't run, covering the runners I moved, ci-repro @c6ff4da3: server:e2e 0 (75) · firestore-admission
load on emulator 0 · synthrun:test 0 (547) · evals:test 0 (243) · evals CLI facade loads (exit 2
"Eval set location does not exist", the contracted config error). No further hidden failures.

## Gates
- Fix worktree @c6ff4da3: typecheck 0; `GATE_BASE=fa6a8972 ./scripts/gate.sh` → FAST GATE PASSED.
- Hermetic: scratch worktree scratchpad/c8f1/green (no parent node_modules, own `npm ci`), with the
  worktree.sh patch committed on the throwaway branch scratch/c8f1-worktree-check: gate.sh FAST GATE PASSED at
  e5b4ef95 (77d5918d+patch) and FAST GATE PASSED at a5f90654 (c6ff4da3+patch).

## worktree.sh check proposal (not committed): scratchpad/c8f1/worktree-check.patch (+50/-2)
Every name declared (deps, devDeps, optionalDeps) by root, server or contract is looked up with Node's
walk from the root and from each workspace dir. The walk is by hand because `resolve.paths` returns null
for `buffer`. A lookup may land inside the checkout or nowhere, never above it; a failure names the
package, the origin dir and the resolved path. A workspace's own non-optional declaration must resolve.
A missing optional dep (fsevents off macOS) is fine, and so is a name only another workspace declares.
Cross-workspace lookups are deliberate. The brief says pino falls through from server/, but this worktree
has server/node_modules/pino. pino escapes from the ROOT and contract/, which is the c8f1 bug itself, so
a check of each workspace's own declarations only would pass.
(a) Red, fix worktree (package.json files and lockfile identical to BASE): exit 1, `6 declared package
lookup(s) resolve to a node_modules above this checkout … pino from the root -> /Users/davrondjabborov/
Work/other/Whim/node_modules/pino` (+ firestore, pino-pretty, from root and contract/). Undone with
`git checkout -- scripts/worktree.sh`; status clean. (b) Green: gates above (the only *.test.sh,
fixloop-preflight, PASSes inside gate.sh), via `git -C <c8f1> worktree add --detach <green> <sha>`; `npm ci`;
`git apply <patch>`; `git switch -C scratch/c8f1-worktree-check <sha>`; `git commit -am …`;
`GATE_BASE=<that sha> ./scripts/gate.sh`. Added runtime ≈10-20 ms (0.06-0.09 s vs 0.05-0.06 s, 5 runs).
CAVEAT: the check flags lookups no code performs. Landed as is, it refuses EVERY nested worktree until the
primary tree is `npm ci`'d on the staging lockfile, because its main-era install still hoists pino to the root.
## Hermetic-gate proposal (control plane; dispatcher decides)
gate.sh exports `NODE_OPTIONS=--import=<checkout>/scripts/lib/hermetic-resolve.mjs`, a
`module.registerHooks({ resolve })` hook that throws when a resolved file:// URL is outside the checkout.
It catches exactly the imports suites perform (child processes inherit it), with no false positives.
Bundle-time resolution by esbuild and tsc is outside it, and the worktree.sh check covers that.
## Class A/B
- A: worktree.sh spec extended to cross-workspace lookups (reason above).
- For chain-9 (flat config): flat config doesn't ignore dot-dirs as ESLint 8 did, so `.tmp-bundles/`,
  `server/.tmp-bundles/` and server/.*.tmp.mjs need an ignore, or a lint during a live suite run lints bundles.
## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: the isolated ci-repro reproduced both CI failures that every worktree gate hid.
- DRAWBACK: worktree gates aren't hermetic; Node walks into the primary tree's node_modules (root cause).
- DRAWBACK: the brief's mechanism (pino from server/) was wrong; checking it first changed the patch design.
- ENV: emulator, Chromium suites and synthrun all ran locally; only the Linux apt deps and sysctl are untested.
  Node 26's npm skipped re2's install script in `npm ci` ("install-scripts approve"); nothing failed.
- NEUTRAL: `npx --no` is not a fail-closed guard (the npx cache satisfies it).

## Fix round 1 (review findings; code commit 6447922f)
- Bundle placement: `serverBundleTarget(name, serverDir)` (server/build.mjs, typed in build.d.mts) returns
  `{ outfile, external }`; all six sites spread it (`...serverBundle`): server/test/run.mjs, e2e.run.mjs, e2e.ts,
  firestore.run.mjs, firestore-admission.run.mjs, evals/cli.mjs. server/test/prod-build.suite.ts
  `bundleExternals` now classifies every esbuild `build()`: a bundle with `devBundleExternals` externals must take
  its outfile from the helper (or be a `server/*.mjs` CLI writing `path.join(here, …)`); an override of the
  helper's outfile/external, a hand-placed outfile and an unreadable `build(options)` all fail. The six sites are
  asserted to use the helper. Live `.tmp-bundles/` dirs are skipped by the scan. The inlined-build test's own
  bundle also goes through the helper. Planted: root-placed outfile, hand-placed under server/test, unreadable
  options, helper override (4 red), 1 green. Real-site red-check: evals/cli.mjs reverted to root placement -> RED.
- npx tripwire (deploy-config.suite.ts): `PACKAGE_RUNNER` covers npx, bunx, npm exec, npm x, pnpm dlx, yarn dlx,
  after whitespace, `:;&|(`, backtick or quote, and at end of line; `-p` pins read like `--package`. 11 new cases,
  each red-checked by restoring the old regex (9 failed) or dropping `-p` (1 failed). Doc comment says it reads
  only `.github/workflows/*.yml` and that the Playwright npx pins in the Dockerfiles are `toolingPlaywrightTests`.
- `.dockerignore`: `**/.tmp-bundles`; its existing required-lines assertion extended with it (red-checked).
- ENV: this worktree's ESLint 8 finds the PRIMARY tree's eslint.config.mjs (chain-9, flat) by walking up and
  ignores every file; gate lint passes with `ESLINT_USE_FLAT_CONFIG=false`.
