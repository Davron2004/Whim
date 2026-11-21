# Whim dependency refresh: non-RN tooling research (2026-11-20)

Read-only. Probes run: `npx` of new versions against the repo (tsc 7.0.2, openspec 2.1.1, knip 6.47.0), scratch configs only (in this scratchpad dir), no repo file modified. Installed today: node 22.23.5, TS 5.9.3, ESLint 8.57.1, RN 0.85.3.

## typescript 5.9.3 -> 7.0.2
- Upstream (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/): native Go compiler. 7.0 ships NO programmatic API (7.1 adds a different one). Removed: `baseUrl`, `moduleResolution node10/classic`, `target es5`, etc. Defaults: `strict` true, `types` [], `rootDir` ./. Compat package `@typescript/typescript6` 6.0.2 re-exports the 6.0 API + `tsc6` bin; recommended alias `"typescript": "npm:@typescript/typescript6@^6.0.2"` plus `"@typescript/native": "npm:typescript@^7.0.2"` for the 7.0 `tsc`.
- 7.1 beta exists (dist-tag `beta` 7.1.0-beta); restores API as `typescript/sync|async|fs|ast` entry points; stable "tentatively late Nov", no firm date (https://infoq.com/news/2026/11/typescript-7-1-beta). Unverified whether any consumer has adopted it.
- Ecosystem: typescript-eslint 8.73.0 peer `typescript >=4.8.4 <6.1.0` (fails ERESOLVE on 7); eslint-plugin-sonarjs 4.2.2 depends on `typescript >=5 <6.1.0`; knip 6.47 has no typescript dep (oxc-parser), so it is unaffected.
- In-repo: compiler API is a library dependency in 20+ files: checks/internal/{manifest,parse,scope}.ts, checks/passes/*.ts (8), checks/storage-surface.ts, checks/test/{release/hermes-entry,repo/binding-provenance,repo/design-system,repo/webview-floor}.suite.ts, scripts/{removal-ratchet,typecheck-tests}.mjs, scripts/lib/only-filter.mjs, server/test/{device-text,prod-build,prompts}.suite.ts, synthrun/test/isolation.ts. Also `external: ['typescript']` in build/build.mjs, checks/test/run.mjs, synthrun/test/run.mjs, scripts/netdeny/run.mjs, launcher run.mjs; and the prod server treats `typescript` as a runtime tool package (server/build.mjs TOOL_PACKAGES, server/src/runtime-assets.ts PREFLIGHT_PACKAGES, deploy image). All of these need the 6.x API.
- Probe: `tsc 7.0.2 --noEmit` on server/tsconfig.json passes unchanged. Root tsconfig.json fails only on `baseUrl` (TS5102). With a scratch config dropping `baseUrl` and making `paths` absolute/relative: same 375 files, 0 errors. `types: []` (no jest) also passes under 5.9.3.
- Verdict: **upgrade-with-migration**. (1) alias `typescript` -> `@typescript/typescript6@^6.0.2` (library users, typescript-eslint, sonarjs, server prod); (2) add `@typescript/native` (7.0.2) for `tsc` in `npm run typecheck` + server:test; (3) drop `baseUrl` from root tsconfig, make `paths` `"vc-sdk": ["./src/sdk"]`; (4) check `scripts/typecheck-tests.mjs` (uses createProgram) stays on 6.x API. Alternative: wait for 7.1 stable and port checks/ to the new API (larger). Intermediate TS 6.0.2 as `typescript` is the zero-risk first step.

## eslint 8.57.1 -> 10.15.0 (+ eslint-plugin-sonarjs 4.1.0 -> 4.2.2)
- Upstream: v10 removes eslintrc entirely, drops Node <20.19, context.getFilename etc, JSX scope tracking, new recommended rules (https://eslint.org/docs/latest/use/migrate-to-10.0.0). v9 makes flat config default (https://eslint.org/docs/latest/use/migrate-to-9.0.0). Latest 9.x = 9.39.5.
- Ecosystem: `@react-native/eslint-config@0.88.1` peer `eslint ^8||^9` (NO 10), ships `./flat` export (flat.js, "Flat Config for ESLint 9+"), engines node ^22.13. `eslint-plugin-react-native@5.0.0` peer up to ^9. typescript-eslint 8.73 and sonarjs 4.2.2 accept ^10; react-hooks 7.1.1 accepts ^10.
- In-repo: `.eslintrc.js` (root:true, `extends: ['@react-native','plugin:sonarjs/recommended-legacy']`, 8 `overrides` incl. `excludedFiles`, per-file `no-restricted-syntax` with `:has()`/`:not()` selectors, `@typescript-eslint/no-restricted-imports`), `.eslintignore` (flat config ignores it). `npm run lint` = `eslint .`.
- Verdict: ESLint 10 = **blocked** (@react-native/eslint-config peer ^8||^9, eslint-plugin-react-native <=9). ESLint 9.39.5 = **upgrade-with-migration**: rewrite `.eslintrc.js` as `eslint.config.js` using `@react-native/eslint-config/flat` + `sonarjs.configs.recommended`; `.eslintignore` -> `ignores`; `overrides/files/excludedFiles` -> flat entries (`files`/`ignores`, glob forms `**/*.mjs`); `env` -> `languageOptions.globals`; re-verify the custom `no-restricted-syntax` rules still fire (red-check each) and that the lint violation count is unchanged. sonarjs 4.2.2 itself: **upgrade** (peer covers 8/9/10; on 4.2.x S2699 behavior for checks/test harness should be re-verified per CLAUDE.md test-assertion rules).

## @babel/core, preset-env, runtime 7.29.x -> 8.x
- Upstream: Babel 8.0.0 2026-06-16 (latest core 8.1.3): ESM-only, Node ^22.18||>=24.11, no ES5 default output, many plugin removals (https://babeljs.io/docs/v8-migration, https://babeljs.io/blog/2026/06/16/8.0.0).
- Ecosystem: `@react-native/babel-preset@0.88.1` depends on `@babel/core ^7.25.2` and ~30 `@babel/plugin-*` `^7`; Metro 0.88.0 depends on `@babel/core ^7.25.2`, `@babel/traverse/types/parser/generator ^7`. preset-env 8 peers `@babel/core ^8`.
- In-repo: babel.config.js = `presets: ['module:@react-native/babel-preset']`, `plugins: ['react-native-worklets/plugin']` only. `@babel/preset-env` is referenced nowhere (not in babel.config.js; only knip.json ignoreDependencies + package.json): `git grep` over all tracked files + `npm ls` (nothing but root requires it). `@babel/runtime` is resolved at bundle time by plugin-transform-runtime; also required by metro-runtime.
- Verdicts: @babel/core **blocked** (RN preset + Metro pin ^7; keep `^7`). @babel/runtime **blocked** at 7.x (must match transform-runtime 7). @babel/preset-env **remove-candidate** (unused RN-template leftover; also drop from knip.json ignoreDependencies).

## prettier 2.8.8 -> 3.10.1
- Upstream 3.0 breaks (https://prettier.io/blog/2023/07/05/3.0.0.html): default `trailingComma` all, async APIs, plugin loading, gitignored files ignored by CLI. Engines node >=14.
- In-repo: `.prettierrc.js` (arrowParens avoid, singleQuote, trailingComma all) only; no script, hook, gate or CI step invokes prettier (grep: only package.json + the config). It is just a peer of `@react-native/eslint-config` (peer `prettier >=2`, so 3.x is fine). Formatting is not enforced anywhere.
- Verdict: **upgrade** (nothing consumes the API); 3.0's default already equals the repo's `trailingComma: 'all'`. Could even be dropped if the peer is auto-installed, but keep for the RN config's peer.

## jest 29.7.0 -> 30.5.2, @types/jest 29 -> 30
- Upstream v30 (https://github.com/jestjs/jest/releases/tag/v30.0.0): drops Node 14/16/19/21/23, TS <5.4, jsdom 26. `@react-native/jest-preset@0.88.1` still depends on `babel-jest ^29.7`, `jest-environment-node ^29.7` (so jest 30 would mismatch it).
- In-repo: no jest config anywhere; `"test": "jest"`. I ran `npm test`: **already fails today** (6 suites of evals/test/*.test.ts, Node-style suites, "Cannot use import statement outside a module"; 0 tests). Nothing invokes `npm test` (no CI/gate/script reference; only a settings allowlist). No jest globals/`jest.` calls in any tracked .ts/.tsx. `tsconfig.json` has `types: ["jest"]` solely inherited from the RN template; scratch tsc with `types: []` passes (0 errors, 375 files).
- Verdict: **remove-candidate**: `jest`, `@types/jest`, `@react-native/jest-preset`, the `test` script, and `types: ["jest"]` (set to `[]`; the env.d.ts files already declare the Node globals). Do not upgrade to 30.

## esbuild 0.25.12 -> 0.28.2 (root `^0.25.0`, server exact `0.25.12`)
- Upstream (https://github.com/evanw/esbuild/releases): 0.27.0 "deliberately backwards-incompatible" (Go 1.25: macOS >=12, Linux kernel >=3.2; `binary` loader uses `Uint8Array.fromBase64` when target allows); 0.27.1-0.27.7 are minifier/bundler bug fixes, 0.27.5 "use define semantics for TS parameter properties" (output change); 0.28.0 text imports, Go 1.26, integrity checks; 0.28.1 two security fixes (dev-server `\`, Deno API); 0.28.2 tree-shaking/TLA/logical-assignment fixes, refuses to overwrite inputs without `--allow-overwrite`.
- In-repo: 37 files import esbuild. Load-bearing: build/build.mjs bundles the mini-app IIFE at `target: 'es2019'` with `tsconfigRaw: '{}'` and the source-map round-trip; server/build.mjs target node22 + metafile; synthrun/builder.ts builds candidate apps (security-relevant: the verdict channel). Caret `^0.25.0` and exact `0.25.12` do not accept 0.26+, so ranges must be edited in both package.json files and lockstep (server pins exact on purpose).
- Verdict: **upgrade** to 0.28.2, then `npm run build`, `invariants`, `bridge:invariants`, `synthrun:test`, `checks:test`, `server:test`; generated artifacts (build/generated, src/runtime/generated) will diff and the source-map round-trip + any pinned bundle byte/hash assertions need re-baselining (unverified which exist). The 0.28.1 security fixes favor not waiting.

## playwright 1.60.0 -> 1.65.1 (root `^1.49.0`, server exact `1.60.0`)
- Upstream (https://github.com/microsoft/playwright/releases): 1.61 adds Ubuntu 26.04 support (this removes the reason for commit ffb704a0's 24.04 pin; verify before unpinning); 1.63 drops Ubuntu 20.04, Linux arm64 uses Chrome for Testing; 1.64 breaking: device-descriptor `screen` forwarded, JSX follows tsconfig, "elements inside hidden iframes are hidden" (affects actionability/visibility in iframe-heavy tests); 1.65 drops Node 20 testing (22/24/26 OK), Docker images use Node 26. Chromium 149->158 across the span (WebKit 27.2): the containment suites then run against a much newer Chromium (a plus, but a CSP/sandbox behaviour change is a possible new red).
- In-repo: library users only (chromium.launch, exposeBinding, CDPSession) in invariants/sandbox-isolation/*.mjs, synthrun/{session,observe,sweep,capability,contract}.ts + tests, src/sdk/test/motion.desktop.mjs, src/host/launcher/test/deliver-by-source.desktop.mjs; `@playwright/test` not used. 1.60.0 is hard-coded in 7 places: server/package.json, .github/workflows/invariants.yml (cache key + `npx --package`), .devcontainer/Dockerfile, deploy/Dockerfile, and the seccomp profile filenames `deploy/seccomp/chromium-playwright-1.60.0.json` (devcontainer.json, run-loop.sh, deploy/compose.yaml). Whether the seccomp profile needs regenerating for Chromium 158: unverified.
- Verdict: **upgrade** (single lockstep bump of all 7 sites + root range). Run all three Chromium suites; the synthrun `sweep.ts` locator visibility is the likeliest behavioral diff.

## isomorphic-git 1.38.4 -> 1.44.17 (exact pin; Hermes on device)
- Upstream (compare https://github.com/isomorphic-git/isomorphic-git/compare/v1.38.4...v1.44.17; no breaking-change notes found). Mostly fixes: global lock acquire, recursive mkdir, "sort paths by UTF-8 bytes like git does", validate readObject format, match filepaths on path boundaries, index written once per walk, peel annotated tags, NTFS/symlink/prototype-pollution hardening, AbortSignal, `readable-stream` dependency dropped; deps otherwise same (still `pako ^1.0.10` nested).
- In-repo: only src/host/version-store/{engine,compaction,device-acceptance}.ts + launcher saved-data test; runs on MemoryFs shim (fs/memory-fs.ts) that mimics fs.promises error codes; polyfills must load first (hermes-polyfills.ts, TextDecoder at module load).
- Verdict: **upgrade** with gates: `vstore:test`, `launcher:test`, then the on-device `RUN_VSTORE_PROBE`. Specific risks: "sort by UTF-8 bytes" can change tree hashes for non-ASCII names (existing snapshots unaffected but new IDs differ); lock/mkdir/index changes touch MemoryFs assumptions; Hermes load-time behavior of 1.44 unverified.

## @op-engineering/op-sqlite 16.2.0 -> 19.0.5
- Upstream (https://github.com/OP-Engineering/op-sqlite/releases): 17.0 `executeRaw` now returns column names (shape change); 17.1 read-only DBs, perf work incl. "fix returns for RETURNING statements"; 17.2 `failOnCreate`; 18.0 removes crsqlite, patches async work, binds hooks/promisify tasks to runtime generation (bridgeless reload safety), configurable Storage db name; 18.1 SwiftPM + RN 0.87 compat; 18.2 prepared-statement `executeSync`; 19.0 `executeBatchSync`, exposed error codes, better rollbacks, JS token generator in all build tools; 19.0.2 Node ESM package; 19.0.4 OpenSSL bump. peers `react, react-native, @sqlite.org/sqlite-wasm` all `*`. 19.0.5 has no GitHub release body (unverified content). RN-version compatibility with 0.88 not stated in notes (RN agent's area; 18.1 notes mention 0.87).
- On-disk format: no migration or file-format change found in any release note (plain SQLite files, same `open({name,location:'storage'})`); bundled SQLite amalgamation version bump not stated -> unverified. DB-file semantics (rollback-journal mode, `busy_timeout`) are the repo's own PRAGMAs.
- In-repo: only src/host/storage-engine/bindings/op-sqlite.ts (+ bridge/device-acceptance.ts, copy-device-acceptance.ts `getDbPath`, async `execute`) uses `open`, `executeSync`, `close`; result read tolerantly (`rows` array or `rows._array`). No `executeRaw`, no crsqlite, no hooks. launcher test shim aliases the module (native-storage.ts). ios/Podfile.lock pins op-sqlite 16.2.0 (pod install needed); knip does not list it.
- Verdict: **upgrade-with-migration** (low code risk, high verification need): confirm `executeSync` result shape (`rows`/`insertId`/`rowsAffected`) after the 17.x perf refactor on device; run `RUN_STORAGE_PROBE`, `RUN_BRIDGE_PROBE`, the data-copy probe on iOS + Android, and reopen a store written by 16.2.0 (upgrade path with real on-disk data). Must be validated against the final RN version.

## pako ^2.1.0 -> 3.0.3
- In-repo: root dep is not imported by any source (`git grep pako`: only package.json, knip.json `ignoreDependencies`, esbuild `external` lists, and a comment); docs/decisions.md #36 notes pako is just the transitive zlib of isomorphic-git. isomorphic-git (old and 1.44.17) depends on `pako ^1.0.10` and resolves its own nested copy (node_modules/isomorphic-git/node_modules/pako); the hoisted root 2.1.0 is not what it uses.
- Verdict: **remove-candidate** (drop from package.json and knip ignoreDependencies; keep it in the esbuild external lists, harmless). Do not bump to 3.x.

## @fission-ai/openspec 1.4.1 -> 2.1.1
- Upstream (https://github.com/Fission-AI/OpenSpec/releases): 2.0.0 skills move to `.agents/skills/`, `/opsx:*` slash commands removed from generated delivery, Amazon Q dropped; 2.1.0 `init --tools` installs skills globally unless `--scope project`; 1.14.1+ validate warns on requirements >500 chars (fails `--strict`), 1.16.0 more validation warnings + invalid config.yaml fails, 1.16.1 unrecognised delta sections fail; npm install needs Node >=22.20 (2.1.x). Local node 22.23.5 is fine; CI `node-version: 22` resolves latest 22.x (fine).
- In-repo: devDep 1.4.1 (`npx openspec validate --all --strict` in scripts/gate-full.sh; CI `npx --package=@fission-ai/openspec@1.4.1`). Machine drift already exists: global Homebrew `openspec` = 1.14.1 while node_modules = 1.4.1 (gate-full.sh insists on the global one existing). Custom schemas openspec/schemas/{whim-harness,whim-fixloop}; repo-owned `.claude/commands/opsx/*.md` and `.claude/skills/openspec-*` (hand-customized).
- Probes with 2.1.1: `openspec schemas --json` and `openspec status --change upgrade-to-latest-dependencies --json` load the whim-harness schema fine. `validate --all --strict`: **66 of 67 items fail** (302 "Requirement text >500 chars" + 46 "Purpose is a placeholder" warnings across specs; 1.4.1 passes 66/66). Without `--strict`: 66 pass; the one fail is the untracked WIP change (no deltas; needs `skip_specs: true` in its `.openspec.yaml` or a delta). `openspec instructions` / `new change` not exercised: unverified.
- Verdict: **upgrade-with-migration**: either (a) keep `--strict` and rewrite ~300 long requirements + 46 purposes (or accept as intentional), or (b) change the gate to non-strict (loses the "SHALL on line 1" strictness the project relies on; strictness semantics in 2.x should be re-checked). Never run `openspec update`/`init` (would overwrite the customized skills/commands and change delivery layout). Align CI pin, devDep, and the global binary to one version.

## metro-symbolicate 0.84.4 -> 0.88.0
- RN 0.88.1 depends on `metro-*` **^0.87.1** (@react-native/metro-config 0.88.1 -> metro-config ^0.87.1; react-native -> metro-runtime/source-map ^0.87.1); 0.88.0 requires Node ^22.13 and is newer than what RN 0.88 ships. Versions available: 0.87.0-0.87.3, 0.88.0.
- In-repo: used only by scripts/release/lib/source-map.ts via `createRequire(...).resolve('metro-symbolicate')` (CLI) and checks/test/release/source-maps.suite.ts comparing output; knip ignores it.
- Verdict: **upgrade** but to **0.87.3** (match the Metro that RN 0.88 resolves, so Hermes maps and symbolicator agree); 0.88.0 compatibility with Metro-0.87 maps: unverified. Re-run source-maps.suite.

## firebase-tools 15.32.1 -> 15.37.0
- Changelog (15.33-15.37, https://github.com/firebase/firebase-tools/releases): hosting API fixes, chokidar/undici/MCP-sdk security bumps, emulator fixes; no breaking changes found. engines >=20||>=22||>=24. Used for the Firestore emulator test (scripts/firestore-emulator-test.mjs) and deploys; root `overrides` pins basic-ftp and nested gaxios uuid, re-check they still apply (overrides may now be redundant: unverified).
- Verdict: **upgrade**.

## knip 6.16.1 -> 6.47.0
- Release notes (https://github.com/webpro-nl/knip/releases, only 6.43-6.47 readable): new reports for unused subpath imports/exports, duplicate default-only exports, unresolvable alias imports; ESLint plugin/config deps now attributed; engines ^20.19||>=22.12.
- Probe: `knip@6.47.0` on the repo exits 1 with **8 new findings** (5 unused exports: SynthRunSession/createRunCandidate in evals/adapters/synthetic-run.ts:18, formatMarkdownReport in server/src/flowbench/drive.ts:24, makeStyles in src/host/ui/tokens.ts:17, dirnameOf in src/host/version-store/fs/kv-fs.ts:143; 3 unused types StorageReference/DynamicStorageSite/StorageFacade in checks/index.ts:32); 6.16.1 is clean (exit 0). Gate is `npx knip`.
- Verdict: **upgrade-with-migration**: fix or deliberately accept those 8 (never silence via knip.json per project memory). Also re-check knip.json `ignoreDependencies` after removing pako/@babel/preset-env/metro-symbolicate decisions.

## react-test-renderer 19.2.3, @types/react-test-renderer
- Latest react-test-renderer 19.3.1 (peer `react ^19.3.1`); `@types/react-test-renderer` 19.3.1 (no peers... listed `{}`); react-native 0.88.1 peers `react ^19.3.0`. react, react-dom, react-test-renderer are exact-pinned 19.2.3 and must move in lockstep with RN 0.88's react requirement (RN agent owns react; coordinate).
- In-repo: used by ~dozen launcher suites (src/host/launcher/test/*.suite.tsx) via `TestRenderer`. React 19 deprecates test-renderer upstream (unverified deprecation flag in npm metadata: none seen).
- Verdict: **upgrade** to 19.3.1 together with react/react-dom; @types stays `^19`.

## zod ^4.4.3 (contract) -> 4.6.7
- Changelog 4.5/4.6 (https://github.com/colinhacks/zod/releases): additive (`z.compile`, `z.validate`, new formats/locales, 9x memory cut, `fromJSONSchema` now enforces six previously-ignored keywords, 4.6 fixes a 4.5 recursive-schema OOM regression). No breaking changes found. Repo does not use `fromJSONSchema`/`toJSONSchema` (grep). zod stays out of Metro (type-only contract imports).
- Verdict: **upgrade** (skip 4.5.x; 4.6.7 includes the OOM fix). Re-run server:test/contract suites.

## server minors: hono 4.13.13 -> 4.13.19, @hono/node-server 2.1.0 -> 2.1.11, pino 10.3.1 -> 10.4.0 (pino-pretty 13.2.0), @google-cloud/firestore 9.3.1 -> 9.4.1
- hono/node-server: patch fixes (request drain, bytes(), HTTP/2 reset, hono v5 peer); no breaking. pino 10.4: warning on incompatible formatters.level with multi-target transports (check server logging config for `formatters.level` + multi-target: unverified), `util.getCallSites` change. Firestore 9.4.1: pipeline-API GA/DML stages only, no breaking, engines >=22 (matches repo).
- Verdicts: all **upgrade** (hono and node-server are within the existing caret ranges; pino/firestore are exact pins).

## Node.js (https://github.com/nodejs/Release/blob/main/schedule.json, https://nodejs.org/en/about/previous-releases)
- As of 2026-11-20: Node 26 "Lithium" is **Active LTS** (since 2026-10-28, EOL 2029-04-30; latest 26.13.1); Node 24 "Krypton" Maintenance (since 2026-10-20, EOL 2028-04-30; 24.22.3); Node 22 "Jod" Maintenance, **EOL 2027-04-30** (22.23.5). Node 27 is alpha. 20/25 are EOL.
- Requirements: RN 0.88.1, Metro 0.88, @react-native/eslint-config 0.88.1, eslint-config etc: `^22.13||^24.3||>=26`; ESLint 10 `^20.19||^22.13||>=24`; Babel 8 `^22.18||>=24.11`; openspec 2.1.1 npm install `>=22.20`; Playwright 1.65 supports 22/24/26 (Docker now Node 26); firestore >=22. So **Node 22 still satisfies everything**, but its EOL is 5 months out. Repo pins: `.nvmrc` 22, `engines >=22.11` (root, server), CI `node-version: 22`, deploy/Dockerfile `node:22.23.2-bookworm-slim@sha256:...` (4 stages + loadtest), `.devcontainer` `node:22-bookworm`.
- Recommendation: stay on 22 for this refresh (raise `engines` floor to `>=22.20` if openspec 2.x or Babel 8 is adopted); schedule a separate move to 24 or 26 before 2027-04-30. Node 26 compatibility of `node:sqlite` test usage, esbuild target `node22`/`node20`, and the RN toolchain: unverified.

## Summary

| package | current -> latest | verdict | reason |
|---|---|---|---|
| typescript | 5.9.3 -> 7.0.2 | upgrade-with-migration | no compiler API in 7.0; alias typescript->@typescript/typescript6 + @typescript/native for tsc; drop `baseUrl` |
| eslint | 8.57.1 -> 10.15.0 | blocked (10) / upgrade-with-migration (9.39.5) | RN eslint-config peer ^8\|\|^9; v9 needs flat config rewrite |
| eslint-plugin-sonarjs | 4.1.0 -> 4.2.2 | upgrade | peer covers ESLint 8/9/10 |
| @babel/core | 7.29.7 -> 8.1.3 | blocked | RN babel-preset 0.88.1 and Metro pin ^7 |
| @babel/runtime | 7.29.7 -> 8.1.3 | blocked | must match plugin-transform-runtime 7 |
| @babel/preset-env | 7.29.7 -> 8.0.7 | remove-candidate | referenced nowhere (RN template leftover) |
| prettier | 2.8.8 -> 3.10.1 | upgrade | never invoked; only an RN eslint-config peer |
| jest | 29.7.0 -> 30.5.2 | remove-candidate | `npm test` already fails, unused; jest-preset pins 29 |
| @types/jest | 29.5 -> 30.0.0 | remove-candidate | no jest globals; tsc passes with `types: []` |
| esbuild | 0.25.12 -> 0.28.2 | upgrade | ranges are 0.25-only; rebuild artifacts, rerun invariants |
| playwright | 1.60.0 -> 1.65.1 | upgrade | bump 7 hard-coded sites in lockstep; newer Chromium |
| isomorphic-git | 1.38.4 -> 1.44.17 | upgrade | many fixes; vstore tests + on-device probe required |
| @op-engineering/op-sqlite | 16.2.0 -> 19.0.5 | upgrade-with-migration | no format change found; verify executeSync shape on device |
| pako | 2.1.0 -> 3.0.3 | remove-candidate | never imported; isomorphic-git uses its own nested 1.x |
| @fission-ai/openspec | 1.4.1 -> 2.1.1 | upgrade-with-migration | `validate --strict` fails 66/67 on new length/purpose warnings |
| metro-symbolicate | 0.84.4 -> 0.88.0 | upgrade (to 0.87.3) | RN 0.88 ships Metro 0.87.x |
| firebase-tools | 15.32.1 -> 15.37.0 | upgrade | fixes/security bumps only |
| knip | 6.16.1 -> 6.47.0 | upgrade-with-migration | 8 new findings to fix |
| react-test-renderer / @types | 19.2.3 -> 19.3.1 | upgrade | lockstep with react (RN 0.88 peers react ^19.3.0) |
| zod | 4.4.3 -> 4.6.7 | upgrade | additive; 4.6 includes 4.5 OOM fix |
| hono / @hono/node-server | 4.13.13 / 2.1.0 -> 4.13.19 / 2.1.11 | upgrade | patch fixes |
| pino / pino-pretty | 10.3.1 / 13.1.3 -> 10.4.0 / 13.2.0 | upgrade | check formatters.level with multi-target transport |
| @google-cloud/firestore | 9.3.1 -> 9.4.1 | upgrade | no breaking |
| Node.js | 22.23.5 | stay on 22 now | 22 EOL 2027-04-30; 26 is Active LTS, 24 Maintenance |

## Highest-risk items
1. TypeScript 7: 20+ files use the compiler API as a library and 7.0 has none; needs the `@typescript/typescript6` alias split (typescript-eslint, sonarjs, prod server preflight, checks/ pipeline all depend on `typescript` resolving to a 6.x API). `tsc` itself is fine (verified: 375 files, 0 errors after dropping `baseUrl`).
2. ESLint: v10 is blocked by @react-native/eslint-config; even v9 means rewriting a large, rule-dense `.eslintrc.js` to flat config and re-red-checking the custom `no-restricted-syntax` guards.
3. op-sqlite 16 -> 19: three majors on the user-data engine; release notes show no format change but the 17.x perf refactor/"RETURNING" fix and 18.x async rework touch result handling; needs device probes and a reopen of a 16.2.0-written DB, on top of RN 0.88.
4. OpenSpec 2.1.1: `--strict` gate fails 66/67 (302 long-requirement + 46 placeholder-purpose warnings) and 2.x changes skill/command delivery; `openspec update` must never be run over the customized `.claude/` skills.
5. esbuild + Playwright + isomorphic-git together change the security-critical build/containment chain (mini-app bundle output, Chromium 149 -> 158 for the isolation suites, version-store hashing/locking): upgrade each in its own gated step and re-baseline generated artifacts; the 1.60.0 pin lives in 7 files including seccomp profile names (profile validity for new Chromium unverified).
