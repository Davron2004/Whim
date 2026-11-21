# chain-10 report (tasks 10.1-10.3)

STATUS: complete (gate result at the end of this file's commit message trail: see GATE)

## Commits (on chain/upgrade-to-latest-dependencies-chain-10)
- docs: refresh stale versions and commands (CLAUDE.md, DEVLOG.md, docs/harness.md)
- docs: decision 88
- chore(deps): isomorphic-git 1.44.18
- this report

## 10.1 doc edits
CLAUDE.md bytes: before 14817, after 14801 (shrank 16).
- CLAUDE.md:49 `# eslint` -> `# eslint 9 (flat eslint.config.mjs)`
- CLAUDE.md:54 "`npm test` is the untouched RN template jest script..." -> "There is no `npm test` or jest;..."
- CLAUDE.md:66 Node 22 / `engines >=22.11` / `nvm use 22` -> Node 26 / `engines >=26`, `.nvmrc` / `nvm use`
- CLAUDE.md:69 RN 0.85 bridgeless -> RN 0.88
- CLAUDE.md JDK line checked against android/gradle.properties: still JDK 21, unchanged.
- docs/harness.md:110 CI row: knip/openspec now named as `node_modules/.bin/knip` / `node_modules/.bin/openspec` (lockfile binaries, never npx). Line 108 already described the flat config: verified, not duplicated.
- DEVLOG.md:42 appended "(Superseded: decision #88, Node 26.)". Nothing else in DEVLOG touched.
- docs/release/mobile.md: already says RN 0.88 (line 167); no stale Node/RN/ESLint/Playwright/Chromium/jest names found, no edit.

## 10.2
Decision #88 appended to docs/decisions.md (~45 lines incl. blank lines): policy, W1-W7 as run (W4 op-sqlite 19.0.5 folded into W3), the 8 pin entries (7 rows, the two community-cli packages share one), and the 3 npm overrides.

## 10.3
isomorphic-git 1.44.17 -> 1.44.18 (exact pin, as before). Lockfile diff: only the isomorphic-git root dependency line and its node_modules entry (version, resolved, integrity); no transitive change. `npm ls isomorphic-git` -> 1.44.18. `npm run vstore:test`: 120 checks passed, 0 failed.

Final `npm run deps:audit`: exit 0.
```
deps:audit: 53 declared dependencies across 3 workspaces, 8 pins

Undeclared lag: none

Pins (8): range, resolved, latest, lift condition
  @fission-ai/openspec  range ^1  resolved 1.4.1 [.]  latest 2.1.1
  @babel/core  range ^7  resolved 7.29.7 [.]  latest 8.1.3
  @babel/runtime  range ^7  resolved 7.29.7 [.]  latest 8.1.3
  typescript  range ^6.0.3  resolved 6.0.3 [.], 6.0.3 [server]  latest 7.0.2
  metro-symbolicate  range ^0.87  resolved 0.87.3 [.]  latest 0.88.0
  @react-native-community/cli  range ~20.2.0  resolved 20.2.0 [.]  latest 21.0.0
  @react-native-community/cli-platform-android  range ~20.2.0  resolved 20.2.0 [.]  latest 21.0.0
  eslint  range ^9.39  resolved 9.39.5 [.]  latest 10.15.0
```
(each pin also prints its lift line, same text as dependency-pins.json)

## Pin lift status (npm, 2026-11-21)
| Pin | npm latest | Evidence | Lift met? |
|---|---|---|---|
| @fission-ai/openspec ^1 | 2.1.1 | no spec-corpus migration change exists | no |
| @babel/core ^7 | 8.1.3 | react-native 0.88.1 (latest) and @react-native/babel-preset 0.88.1 depend on @babel/core ^7.25.2 | no |
| @babel/runtime ^7 | 8.1.3 | moves with @babel/core | no |
| typescript ^6.0.3 | 7.0.2 | typescript-eslint 8.73.0 (latest) peers typescript >=4.8.4 <6.1.0 | no |
| metro-symbolicate ^0.87 | 0.88.0 | react-native latest is 0.88.1 (next 0.89.0-rc.2); 0.88.1 still on Metro ^0.87.1 | no |
| @react-native-community/cli ^20.2 | 21.0.0 | RN 0.88.1 template still 20.2.0 (per pin register); no RN release on CLI 21 | no |
| cli-platform-android ~20.2.0 | 21.0.0 | lockstep with cli | no |
| eslint ^9.39 | 10.15.0 | @react-native/eslint-config 0.88.1 peers ^8 \|\| ^9; eslint-plugin-react-native 5.0.0 (latest) peers up to ^9; eslint-plugin-react 7.37.5 (latest) peers ^9.7 max | no |

No pins file change.

## Deviations
none (class A: isomorphic-git saved with --save-exact to keep the existing exact-pin style).
