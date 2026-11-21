# Context chains: upgrade-to-latest-dependencies

<!--
  All chains are SEQUENTIAL: every wave edits package.json/package-lock.json, so no two chains may
  run in parallel. Each chain makes its own dependency and config edits (design D2) in a worktree
  created by `scripts/worktree.sh create` from the staging tip; after its lockfile changes it runs
  `npm install` in that worktree (never in the primary tree). Edits to `build/` or `invariants/`
  (control plane) are committed onto the staging branch by the orchestrator before the chain gates.
-->

## chain-1: deps-w1-cleanup-and-pin-register

- tasks: 1.1–1.5
- edits: `package.json`, `server/package.json`, `contract/package.json`, `package-lock.json`, `tsconfig.json` (`types`) and `knip.json`, exactly as listed in those tasks.
- rationale: everything here is repo-level JS tooling. One vocabulary covers it (knip, the checks/ extension point, npm registry queries).
- reads: specs/dependency-currency/spec.md (all requirements); design.md D4, D5; research-tooling.md (knip, pako, jest, preset-env); handoff: none
- writes-contract: handoff/pin-register.md (the `dependency-pins.json` entry shape and the check's entry point, for chains 3 and 6, which add entries)

## chain-2: deps-w2-node-26

- tasks: 2.1–2.4
- edits: `engines` in the three `package.json` files, `.nvmrc` and `package-lock.json`. The worktree must run on Node 26 (`node -v`; Homebrew node can shadow nvm).
- rationale: one runtime switch across CI, devcontainer, server image and specs. Verified once.
- reads: specs/generation-server/spec.md §Server workspace and runtime; specs/server-deployment/spec.md §The container image is pinned…; design.md D6; handoff: none
- writes-contract: none
- after: chain-1

## chain-3: rn-w3a-js-side

- tasks: 3.1–3.5
- edits: `package.json`, `package-lock.json`, `metro.config.js`, `babel.config.js`, `tsconfig.json` (drop `baseUrl`) and `dependency-pins.json` (typescript, metro-symbolicate, CLI entries).
- rationale: everything on the TypeScript side of the RN move: types, removed APIs, launcher stubs, sandbox invariants, Metro.
- reads: design.md D3, D4, D7; research-upstream.md §1, §3; research.md §4–§6; handoff: handoff/pin-register.md
- writes-contract: handoff/rn-088-versions.md (the exact resolved versions of RN, React, and every RN-coupled library, plus any library that needed a pin and why, for chains 4–6)
- after: chain-2

## chain-4: rn-w3b-android

- tasks: 4.1–4.5
- edits: `android/gradle/wrapper/gradle-wrapper.properties`, `android/build.gradle`, `android/gradle.properties` and `android/app/build.gradle` per the 0.88 template diff (research-upstream.md §2).
- rationale: all Android native work, including the fourth containment leg. One toolchain and one emulator (Whim_Verify, emulator-5560 only).
- reads: design.md D7, D8; research.md §2 and §Constraints (fourth leg); research-upstream.md §2, §5; handoff: handoff/rn-088-versions.md
- writes-contract: none
- after: chain-3

## chain-5: rn-w3c-ios

- tasks: 5.1–5.4
- edits: `ios/Podfile`, `ios/Podfile.lock`, `ios/Whim/Info.plist`, `ios/Whim/AppDelegate.swift`/`SceneDelegate.swift` and `project.pbxproj` per the 0.88 template diff. `bundle exec pod install`.
- rationale: all iOS native work. One toolchain (Xcode 27, CocoaPods, simulator).
- reads: design.md D8; research.md §3; research-upstream.md §2; handoff: handoff/rn-088-versions.md
- writes-contract: none
- after: chain-4 (both need the machine's memory for native builds; never run the Gradle and Xcode builds at the same time)

## chain-6: rn-w3d-device-verification

- tasks: 6.1–6.5
- rationale: verification only, run by a small runner agent (Sonnet) per the build → gate → fix split. Findings go to the progress file and get a fresh fixer, not this agent.
- reads: design.md D7; research.md §5–§6 (probes, transport); handoff: handoff/rn-088-versions.md
- writes-contract: none
- after: chain-5

## chain-7: data-w4-op-sqlite-19

- tasks: 7.1–7.4
- edits: `package.json`, `package-lock.json` and `ios/Podfile.lock` (pod install). Task 7.1 (write the 16.2.0 fixture) runs BEFORE the bump, on the pre-bump build.
- rationale: the user-data engine binding and its upgrade proof. Isolated so a data regression has exactly one suspect.
- reads: design.md D7, Risks (op-sqlite); research-tooling.md (op-sqlite); research.md §5 (op-sqlite binding); handoff: none
- writes-contract: none
- after: chain-6

## chain-8: tooling-w5-esbuild-playwright-ci

- tasks: 8.1–8.5
- edits: `package.json`, `server/package.json`, `package-lock.json`, the seven hard-coded Playwright references (any under `invariants/` or `build/` is control plane: the orchestrator commits that part onto the staging branch first), the seccomp profiles and `server/Dockerfile`.
- rationale: the build and browser toolchain that the sandbox suites and the server's synthetic run share.
- reads: specs/server-deployment/spec.md §The container image is pinned…; specs/generation-server/spec.md §Server workspace and runtime; design.md Risks (Playwright); research-tooling.md (esbuild, playwright); handoff: none
- writes-contract: none
- after: chain-7

## chain-9: tooling-w6-eslint-flat

- tasks: 9.1–9.3
- edits: creates `eslint.config.mjs`, deletes `.eslintrc.js` and `.eslintignore`, edits `package.json`, `package-lock.json` and `dependency-pins.json` (eslint entry).
- rationale: lint configuration and the code it now flags.
- reads: design.md D4; research-tooling.md (eslint, sonarjs, prettier); handoff: handoff/pin-register.md
- writes-contract: none
- after: chain-8

## chain-10: closure-w7-docs-and-upgrade-check

- tasks: 10.1–10.5
- rationale: docs, decision log, the final audit and the release upgrade check across the whole move.
- reads: proposal.md; design.md (all decisions); specs/dependency-currency/spec.md §A networked audit…; handoff: handoff/rn-088-versions.md, handoff/pin-register.md
- writes-contract: none
- after: chain-9
