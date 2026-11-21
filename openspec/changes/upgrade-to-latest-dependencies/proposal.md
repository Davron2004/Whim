## Why

Whim is three React Native releases behind (0.85.3 against 0.88.1) and about 50 packages behind across the app, `contract/` and `server/`. Some of those gaps have deadlines. Node 22 reaches end of life on 2027-04-30. Playwright 1.60 already forced a CI runner pin (ffb704a0). The planned RN-side WebView provenance fix (docs/security/2026-11-19-verdict-channel.md, "Device") should be built once, against final versions.

The owner's standing policy is that every dependency sits on its latest stable release. A dependency stays older only when a written reason exists, together with the condition that would lift it. This change brings the repo to that state and makes the policy checkable.

## What Changes

- **React Native platform:** move `react-native` from 0.85.3 to the newest 0.88.x patch.
  - Move every `@react-native/*` tooling package with it, along with React, `react-dom` and `react-test-renderer` 19.3.x. React must be exactly 19.3.x because RN 0.88 peers `^19.3.0`.
  - Move each RN-coupled native library to the version that supports 0.88. That includes Reanimated 4.8 with Worklets 0.14, which the RN move requires.
  - Bring Android to the 0.88 template toolchain: Gradle 9.4.1, AGP 9.2.1, Kotlin 2.2.0, compile SDK 37 and the template's `gradle.properties` opt-outs.
  - Apply the iOS template changes.
- **BREAKING (dev environment):** the Node floor becomes Node 26 (the active LTS) everywhere: `engines`, `.nvmrc`, CI, the devcontainer and the server's production image.
- **Non-RN majors that can move:**
  - esbuild 0.28, with the generated runtime artifacts rebuilt.
  - Playwright 1.65 and the Chromium it bundles. The CI runner returns to the newest Ubuntu image if Chromium installs there.
  - isomorphic-git 1.44.
  - op-sqlite 19. It is verified against a database written by 16.2.0.
  - prettier 3, knip 6.47 (its new findings fixed), and every minor and patch bump in the server and contract workspaces.
- **Tooling that cannot reach latest is pinned with a written reason:**
  - TypeScript 6.0.x. TypeScript 7.0 ships no compiler API, and the server's static checker, `checks/` and typescript-eslint all need one.
  - ESLint 9.x, with a rewrite from `.eslintrc.js` to flat config. `@react-native/eslint-config` 0.88 peers `^8 || ^9`.
  - Babel 7. RN's Babel preset and Metro require `^7`.
  - `metro-symbolicate` on RN 0.88's Metro line.
  - `@react-native-community/cli` 20.2.x, the version the 0.88 template pins.
  - `@fission-ai/openspec` 1.x. Moving to 2.x is a rewrite of the spec corpus, deferred to its own change.
- **Removals:** jest, `@types/jest`, `@react-native/jest-preset`, the jest `types` entry and the broken `npm test` script. Also `pako` (never imported) and `@babel/preset-env` (never referenced).
- **New `dependency-currency` capability:**
  - A committed pin register with a reason and a revisit condition for each pin.
  - An offline gate check that keeps the register well-formed.
  - A networked `npm run deps:audit` that reports any dependency behind its npm `latest` tag with no pin entry.
- **Out of scope:**
  - The WebView provenance fix. It lands in a follow-up change against the final versions.
  - A native CI build job.

## Capabilities

### New Capabilities
- `dependency-currency`: every dependency is on its latest stable release, or listed in a pin register that gives the reason and the condition for lifting the pin. An offline check validates the register and a networked audit finds undeclared lag.

### Modified Capabilities
- `generation-server`: the server workspace is a Node 26 service; it was Node 22. The rest of the "Server workspace and runtime" requirement is unchanged.
- `server-deployment`: the runtime container image is built on a Node 26 base; it was Node 22.
- `app-links`: on iOS the SceneDelegate's scene callbacks forward links to React Native, because RN 0.88 ignores the AppDelegate forwards in a scene-based app.
- `capability-bridge`: the Playwright-binding check's requirement names `eslint.config.mjs`'s `ignores` as where `invariants/` is excluded from lint; it was `.eslintignore`.
- `sonar-recurrence-tracking`: a promotion edits `eslint.config.mjs`; it was `.eslintrc.js`.

## Impact

- **Dependency and config files:** root `package.json` and `package-lock.json`, `server/package.json`, `contract/package.json`, `.nvmrc`, `tsconfig*.json`, `.eslintrc.js` → `eslint.config.*`, `knip.json`, `babel.config.js`, `metro.config.js`. These are all in the gate's `CONFIG_SET`, so each dependency wave is applied as an attended bootstrap commit before its implementer chain runs (see chains.md).
- **Android:** the Gradle wrapper, `build.gradle` ext values, `gradle.properties`, `app/build.gradle`, `MainApplication.kt`, `MainActivity.kt` (it uses RN internals) and `NetworkDeniedWebViewManager` (the fourth containment leg).
- **iOS:** `Podfile`, `Podfile.lock`, `Gemfile`, `project.pbxproj`, `Info.plist`, `AppDelegate.swift`, `SceneDelegate.swift`, the `WhimStatusBar` swizzles, `WhimWebViewNetworkDeny.m` and the five `.mm` TurboModules.
- **Sandbox runtime:** React 19.3 reaches the iframe through H1b (`build/build.mjs`), so the containment invariants and the on-device verdict are re-run. esbuild 0.28 changes the mini-app bundle output.
- **Tests:** the launcher-suite native stubs (`src/host/launcher/test/native-*.tsx`) and the 9 `checks/test/{release,repo}` suites that read native source.
- **Server:** the Dockerfile base image, the pinned Playwright version wherever it is hard-coded (7 files, including the seccomp profile names), and CI (`.github/workflows/invariants.yml`).
- **Docs:** CLAUDE.md (RN version, Node version, `npm test`, the ESLint config name), `docs/release/mobile.md`, `docs/harness.md` and a new decision-log entry.
