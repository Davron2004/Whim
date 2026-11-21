# chain-1 builder report

CHAIN: chain-1
STATUS: complete
TASKS: 5/5 done (1.1, 1.2, 1.3, 1.4, 1.5)
GATE: not run by the builder (runner gates the committed tip); targeted checks below all exit 0
COMMIT: see the branch tip (four task commits plus this handoff commit)
WORKTREE: /Users/davrondjabborov/Work/other/Whim/.claude/worktrees/upgrade-to-latest-dependencies-chain-1 · BRANCH: chain/upgrade-to-latest-dependencies-chain-1
DEVIATIONS:
- [A] 1.3: two of the eight knip findings were not dead code. Their consumers are invisible to knip (evals/cli.mjs bundles a facade held in a string; server/flowbench.mjs bundles `src/flowbench/drive.ts` by path and dynamic-imports it). I declared both modules as knip `entry` files, following the existing precedents (`evals/tiers/case.ts` for the facade, `src/loadtest/drive.ts` for the drive). No `ignore*` setting was added.
- [A] 1.1: two env.d.ts comments that quoted `types: ["jest"]` now say `types: []`.
- [A] 1.2: `npm update zod` was also run so the hoisted transitive zod (openspec, firebase-tools, eslint-plugin-react-hooks) dedupes to 4.6.7 instead of keeping a second 4.4.3 copy next to contract's.
CONTRACT: openspec/changes/upgrade-to-latest-dependencies/handoff/pin-register.md
FILES TOUCHED: package.json, package-lock.json, contract/package.json, server/package.json, tsconfig.json, knip.json, scripts/release/env.d.ts, src/host/version-store/env.d.ts, src/host/version-store/fs/kv-fs.ts, src/host/ui/tokens.ts, checks/index.ts, checks/test/acceptance.ts, checks/test/repo/dependency-pins.suite.ts, checks/test/repo/deps-audit.suite.ts, dependency-pins.json, scripts/deps-audit.mjs, scripts/lib/dependency-pins.mjs, scripts/lib/dependency-pins.d.mts, handoff/pin-register.md, handoff/chain-1-report.md
MEMORY: none
NOTES FOR DISPATCHER:
- CLAUDE.md line "`npm test` is the untouched RN template jest script" is now stale (the script is gone). I did not edit CLAUDE.md (that needs an owner or orchestrator edit).
- `@babel/core`/`@babel/runtime` resolve 7.29.7 while the `v7` dist-tag is 7.29.13. The pin covers them, so deps:audit shows them without flagging the lag; a later chain may want to move to the newest 7.x.
- Root `overrides` (basic-ftp, firebase-tools→gaxios→uuid) were left as they were. Whether they are still needed after firebase-tools 15.37.0 was not checked.

## Versions moved

| Package | Workspace | From | To |
|---|---|---|---|
| zod | contract | ^4.4.3 (4.4.3) | ^4.6.7 (4.6.7) |
| hono | server | ^4.6.0 (4.13.13) | ^4.13.19 (4.13.19) |
| @hono/node-server | server | ^2.0.5 (2.1.0) | ^2.1.11 (2.1.11) |
| pino | server | 10.3.1 | 10.4.0 |
| pino-pretty | server (dev) | 13.1.3 | 13.2.0 |
| @google-cloud/firestore | server | 9.3.1 | 9.4.1 |
| firebase-tools | root (dev) | 15.32.1 | 15.37.0 |
| react-error-boundary | root | 6.1.2 | 6.1.6 |
| eslint-plugin-sonarjs | root (dev) | ^4.1.0 (4.1.0) | ^4.2.2 (4.2.2) |
| knip | root (dev) | ^6.16.1 (6.16.1) | ^6.47.0 (6.47.0) |

All targets are the `latest` dist-tag, re-queried 2026-11-20 with `npm view <pkg> dist-tags --json`. Exact pins stayed exact, carets stayed carets. Nothing was held: sonarjs 4.2.2 peers `eslint ^8 || ^9 || ^10`, which covers the repo's ESLint 8.

Removed (1.1): jest, @types/jest, @react-native/jest-preset, pako, @babel/preset-env, @react-native/new-app-screen (`git grep` found no import), the `test` script, and `types: ["jest"]` (now `[]`). knip.json lost pako, @babel/preset-env and @react-native/new-app-screen from `ignoreDependencies`.

## knip 6.47 findings (1.3), all fixed at the cause

| Finding | Fix |
|---|---|
| `makeStyles` re-export in src/host/ui/tokens.ts | Deleted. Every caller imports it from tokens-pure. |
| `dirnameOf` re-export in src/host/version-store/fs/kv-fs.ts | Deleted, with its comment. No importer. |
| `StorageReference`/`DynamicStorageSite`/`StorageFacade` type re-exports in checks/index.ts | Removed from the re-export. No importer; `StorageSurface` stays. |
| `SynthRunSession`/`createRunCandidate` in evals/adapters/synthetic-run.ts | Real consumer is evals/cli.mjs's string facade. Added the file to knip root `entry`. |
| `formatMarkdownReport` in server/src/flowbench/drive.ts | Real consumer is server/flowbench.mjs, which bundles drive.ts as an esbuild entry. Added `src/flowbench/drive.ts` to the server `entry`. |

`npx knip` exits 0 and prints no configuration hints.

## Red-check evidence

### 1.4: pin check (`--only dependency-pins`)

Each mutation was applied to `scripts/lib/dependency-pins.mjs` or to the real `dependency-pins.json`, confirmed applied (the file differs from the backup), run, and restored (`cmp` against the backup at the end).

| # | Weakening | Result |
|---|---|---|
| R1 | `reason` not required | exit 1: "missing reason: expected one finding naming typescript + "reason", got []" |
| R2 | `lift` not required | exit 1: missing lift scenario fails |
| R3 | `range` not required | exit 1: missing range scenario fails |
| R4 | duplicates ignored | exit 1: duplicate scenario fails |
| R5 | stale entries ignored | exit 1: stale scenario fails ("left-pad + stale, got []") |
| R6 | lockfile range not checked | exit 1: drift scenario and the nested-copy scenario fail |
| R7 | hoisted copy read before the workspace's own | exit 1: the valid control repo fails (server esbuild 0.28.2 outside ~0.25.12) |
| R8 | unknown fields accepted | exit 1: unknown-field scenario fails |
| R9 | caret below 1.0.0 widened to the next major | exit 1: "0.88.0 should not satisfy ^0.87.1; 0.0.4 should not satisfy ^0.0.3" |
| R10 | unreadable range not reported | exit 1: the check throws on "latest-ish" instead of reporting it |
| R11 | real register: openspec entry without `reason` | exit 1: committed-register test names `@fission-ai/openspec: missing or empty "reason"` |
| R12 | real register: openspec `lift` empty | exit 1: names `"lift"` |
| R13 | real register: openspec entry without `range` | exit 1: names `"range"` |
| R14 | real register: openspec range `^2` | exit 1: "the lockfile resolves 1.4.1 (workspace .), outside the pinned range ^2" |

The first run of R9 was vacuous: the sed pattern did not match, and the suite passed. The scripts were then changed to refuse a mutation that did not apply, and R9 was rerun as shown.

### 1.5: deps:audit (`--only deps-audit`)

| # | Weakening of scripts/deps-audit.mjs (or the lib) | Result |
|---|---|---|
| A1 | lag never reported | exit 1: lag scenario "expected exit 1, got 0" |
| A2 | `next` dist-tag read before `latest` | exit 1: three scenarios fail (hono 5.0.0-rc.1 counted as the target) |
| A3 | pins ignored | exit 1: fully-current scenario "expected exit 0, got 1" |
| A4 | lift condition not printed | exit 1: pin-listing scenario fails |
| A5 | workspace packages kept as dependencies | exit 1: four scenarios fail |
| A6 | registry non-2xx swallowed | exit 1: registry-failure scenario fails (message lacks the 404) |

## Targeted commands run (final state)

| Command | Exit |
|---|---|
| `npm install` (after 1.1; after 1.2), `npm update zod` | 0 |
| `npm run typecheck` | 0 (175 suite files) |
| `npm run lint` | 0 |
| `npx knip` | 0 |
| `npm run checks:test` | 0 (PASS 476, FAIL 0) |
| `npm run checks:test -- --only deps-audit,dependency-pins` | 0 (14 tests) |
| `npm run server:test` (server deps moved) | 0 (5575 passed) |
| `npm run launcher:test` (react-error-boundary moved) | 0 (20354 checks) |
| `npm run vstore:test` (kv-fs edited) | 0 (120 checks) |
| `grep -c 'deps:audit\|deps-audit' scripts/gate.sh scripts/gate-full.sh` | 0 matches in both |
| `npm run deps:audit` (real registry, once) | 1, as expected |

### Real `npm run deps:audit` summary (2026-11-20)

51 declared dependencies across 3 workspaces, 3 pins. Undeclared lag: 33 rows, all owned by later waves: react-native 0.85.3→0.88.1 and the five @react-native/* packages, react/react-dom/react-test-renderer 19.2.3→19.3.1, typescript 5.9.3→7.0.2 (root + server), eslint 8.57.1→10.15.0, esbuild 0.25.12→0.28.2 (root + server), playwright 1.60.0→1.65.1 (root + server), op-sqlite 16.2.0→19.0.5, isomorphic-git 1.38.4→1.44.17, prettier 2.8.8→3.10.1, metro-symbolicate 0.84.4→0.88.0, @react-native-community/cli{,-platform-android} 20.1.0→21.0.0, and native libraries (reanimated 4.6.0→4.8.0, worklets 0.12.2→0.14.0, screens 4.28.0→4.30.1, webview 13.16.1→14.0.1, nitro-modules 0.35.9→0.37.2, gesture-handler, keyboard-controller, mmkv, safe-area-context, svg), @types/react, @types/react-test-renderer. Pins: @fission-ai/openspec ^1 (1.4.1, latest 2.1.1); @babel/core ^7 and @babel/runtime ^7 (7.29.7, latest 8.1.3), each printed with its lift condition.

## HARNESS FEEDBACK

- DRAWBACK: red-check scripts that sed-mutate code fail silently when a pattern misses, which makes the red-check vacuous (R9 first run: suite passed, and I almost recorded it as evidence). Cost: one rerun. Fix: every mutation step now refuses to run when the file is unchanged ("MUTATION DID NOT APPLY"). Proposed: the red-check guidance (docs/harness.md / implementer brief) should require proof that the mutation applied.
- CAUGHT-REAL-MISTAKE: sonarjs lint (cognitive complexity, regex complexity, an unbound catch) rejected the first range matcher. The refactor into a per-operator table is easier to read. Cost: one lint loop.
- NEUTRAL: the brief's knip prediction (8 findings, exact files) matched the real run, which saved the investigation. Two findings were false positives caused by consumers knip cannot see (string facade, esbuild-by-path). The established fix in this repo is a knip `entry`. The brief's "no relaxation" rule doesn't say whether an entry counts, so a reviewer may still question it.
- NEUTRAL: gate.sh lists `scripts/test/*.test.mjs` one by one and is control plane. A new script test can only reach the gate through `checks/test/acceptance.ts`, so the deps:audit tests live there, not next to the script.
- ENV: the `npm view`/registry probes and the one real deps:audit run needed network. Everything else ran offline. No CAPPED results.
- Helped: the pinned knip/jest/pako/babel research and the "re-query dist-tags now" instruction. zod, pino and the others had not moved since research. The brief's override list (which config files are editable) prevented a needless class-B stop.

## Fix round 1

1. **jest left in the lockfile (MED).** Cause as reviewed: npm kept jest and `@react-native/jest-preset` as satisfied optional peers. A plain `npm install` after deleting their node_modules dirs reinstalled them from the lockfile, so I removed the two top-level lockfile entries (`node_modules/jest`, `node_modules/@react-native/jest-preset`), deleted the two directories, and ran `npm install`; npm then pruned the rest ("removed 122 packages"). Lockfile diff against the pre-fix lock: 124 entries removed, 0 added, 0 version changes, 11 entries only lost their `peer` flag (still needed by metro/babel/eslint). `npm ls jest @react-native/jest-preset` prints `(empty)`. Remaining `jest-*` names (`jest-util`, `jest-validate`, `jest-worker`, `jest-get-type`, `@jest/types`, `@jest/schemas`) are real dependencies of metro/eslint-config, not the jest runner. Lint passes without jest (eslint-plugin-jest needs no jest install).
2. **Unbounded pin ranges (LOW).** `scripts/lib/dependency-pins.mjs`: `hasUpperBound` + `rangeFindingFor`; a range with any `||` alternative lacking `<`, `<=` or an exact version is a finding naming the package ("has no upper bound"). Scenario test added in `checks/test/repo/dependency-pins.suite.ts` (`*`, `x`, `>=0`, `>=6`, `^6 || >=8`, `>=6 || ^5` fail; `^6`, `>=6 <7`, `6.0.3`, `<=6.9.0`, `^5 || ^6` draw none). Red-check: adding `'>='` to the accepted upper-bound operators (mutation confirmed in the diff) turned the test RED (`unbounded >=0: expected one finding ..., got []`, PASS 9 FAIL 1); restored.
3. **Matcher gaps (LOW).** Known-answer cases for `^0`, `^0.0`, `>1.2`, `<=1.2`, each with a satisfying and a non-satisfying version, added to the matcher test; all pass.

Commands (all exit 0): `npm install`, `npm run lint`, `npm run typecheck`, `npx knip` (run after the lockfile change), `npm run checks:test -- --only dependency-pins,deps-audit` (15 pass), full `npm run checks:test` (477 pass). First lint run flagged cognitive complexity 16 in `pinRegisterFindings`; fixed by extracting `rangeFindingFor`.
