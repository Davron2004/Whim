## Context

This change rests on three research digests in this folder:
- `research.md`: the in-repo terrain coupled to the RN version.
- `research-upstream.md`: RN 0.86–0.88 release notes, the template diff and native-library compatibility.
- `research-tooling.md`: the non-RN majors, each checked against this repo.

Terrain claims below cite them.

Whim runs RN 0.85.3 with React 19.2.3 on Node 22 and is about 50 packages behind. The coupling is wide (research.md §1–§6):
- **Native code reaches into RN internals.** `MainActivity.kt` uses `ReactModalHostView.dialog` and `NativeDeviceInfoSpec`. The iOS `WhimStatusBar` swizzles RN classes by name.
- **The fourth containment leg subclasses a library class.** It extends react-native-webview's `RNCWebViewManager` (#74).
- **React reaches the sandbox.** React is injected into the iframe through H1b (`build/build.mjs`), so a React bump changes the sandbox runtime too.
- **The launcher suites stub RN.** They alias every native library to hand-written stubs.
- **Every dependency and lint/type config file is in the gate's `CONFIG_SET`.** The gate refuses to run while any of them differs from the pinned base commit.

Upstream, 0.87 is the breaking release (research-upstream.md §1):
- the Strict TS API by default;
- removed `InteractionManager`, `Modal.animated` and the StatusBar `backgroundColor`/`translucent` props;
- AGP 9.

0.88 requires React `^19.3.0` and Node `^22.13 || ^24.3 || >=26`. On iOS, Xcode 27 builds need the UIScene lifecycle, which Whim already has (research.md §3).

`fetch` still has no streaming body and core still ships no `TextDecoder`, so the SSE transport (#58) and the Hermes prerequisites are unaffected in principle (research-upstream.md §1). Both are verified on device anyway.

## Goals / Non-Goals

**Goals:**
- Every dependency on its npm `latest` stable release, or pinned in `dependency-pins.json` with a named blocker and a lift condition (spec `dependency-currency`).
- RN on the newest 0.88.x patch, with all four containment legs, the SSE transport, the Hermes prerequisites and on-device data intact.
- Node 26 everywhere (specs `generation-server` and `server-deployment`).
- Unused dependencies removed instead of upgraded.
- Every step reversible on its own.

**Non-Goals:**
- The WebView provenance fix (docs/security/2026-11-19-verdict-channel.md "Device"). It is the next change, built against these versions.
- Moving `@fission-ai/openspec` to 2.x (D4).
- A native Android or iOS CI build job. Filed as a follow-up.
- Behavior changes. Anything an upgrade forces is the smallest change that restores today's behavior.

## Decisions

### D1. Sequential waves, each a gated commit on the staging branch

The upgrade lands in waves:

| Wave | Content | Device pass |
|---|---|---|
| W1 | Removals, minor and patch bumps, the pin register and audit | no |
| W2 | Node 26 | no |
| W3 | The RN platform: RN 0.88.x, `@react-native/*`, React 19.3, TypeScript 6, every RN-coupled native library, isomorphic-git, Android and iOS toolchains | yes |
| W4 | op-sqlite 19 | yes |
| W5 | esbuild 0.28, Playwright 1.65, CI runner | no |
| W6 | ESLint 9 flat config, prettier 3 | no |
| W7 | Docs and closure | final release upgrade check |

Each wave passes `gate.sh` then `gate-full.sh`. Waves that touch native code or data also pass a device check. Each wave is its own commit, so it can be bisected and reverted alone.

*Alternatives:*
- **A single bump of everything at once.** Failures would come from fifty sources with no attribution, and nothing could be rolled back alone.
- **One change per package.** That means about fifteen runs and fifteen PRs for what is a single coherent move. The owner wants one reviewable PR per run.

### D2. Each chain makes its own dependency and config edits

Since 2026-11-20 the gate's `CONFIG_SET` covers only the control plane: gate scripts, hooks, agent briefs, `build/` and `invariants/`. `package.json`, the lockfile, tsconfig, eslint, knip, babel and metro config are agent-editable (docs/harness.md §4). So each wave's implementer chain bumps its own packages, runs `npm install`, and fixes what broke, all in one worktree.

The reviewer's check-weakening scan is the control on those files. A config edit that relaxes a checker (a rule turned off, strictness loosened, a knip `ignore` added to silence a finding) is a HIGH finding.

A chain that must touch `build/` or `invariants/` (W5's Playwright references, if any live there) still needs its edit committed onto the staging branch by the orchestrator before the chain gates. The orchestrator does that as part of dispatching the chain.

### D3. The target is npm's `latest` dist-tag at implementation time, never a prerelease

Re-query each version when its wave starts, because releases land during the run; RN 0.88.2 is expected (research-upstream.md §4). That is why the tasks name a version line, not an exact version.

Prerelease channels are excluded (spec `dependency-currency`): react-native-webview 15–17 on `next`, react-native-screens 5.0 beta, the TypeScript 7.1 beta.

### D4. The initial pin register

Each entry has a blocker that research verified:

| Package | Allowed | Blocker | Lifts when |
|---|---|---|---|
| typescript | ^6.0.3 | 7.0 ships no compiler API. The server's static checker (spec `generation-server`), `checks/`, typescript-eslint and knip import `typescript` as a library (research-tooling.md). The 0.88 template pins ^6.0.3. | A stable 7.x with a compiler API that typescript-eslint supports |
| eslint | ^9.39 | `@react-native/eslint-config` 0.88.1 peers `^8 \|\| ^9` | An `@react-native/eslint-config` release that peers ESLint 10 |
| @babel/core, @babel/runtime | ^7 | `@react-native/babel-preset` 0.88.1 and Metro require `^7` | RN's preset and Metro support Babel 8 |
| metro-symbolicate | RN's Metro line (`^0.87`) | Must match the Metro version RN 0.88 resolves | RN moves to a newer Metro |
| @react-native-community/cli, cli-platform-android | 20.2.x | The 0.88 template pins 20.2.0. CLI 21 states no 0.88 support. | An RN release whose template pins CLI 21, or CLI release notes stating 0.88 support |
| @fission-ai/openspec | ^1 | Under 2.x, `validate --strict` fails 66 of 67 specs (302 over-long requirements, 46 placeholder Purposes), and 2.x changes how skills are delivered. Running `openspec update` would overwrite the repo's customized skills (research-tooling.md). | The follow-up change that migrates the spec corpus |

If a native library's `latest` fails to build or run on 0.88 during W3 (react-native-screens 4.30.1 is the unverified one), it gets a pin entry with the observed failure as its reason. It is not moved to a prerelease.

### D5. Removals

These go: jest, `@types/jest`, `@react-native/jest-preset`, the `types: ["jest"]` entry, and the `test` script. The script already fails because jest tries to parse the `evals/` Node suites, and nothing calls it (research-tooling.md). `pako` (never imported; isomorphic-git carries its own copy) and `@babel/preset-env` (never referenced) go too.

`@react-native/new-app-screen` goes if a grep confirms nothing imports it; research.md left that unverified. knip in `gate-full.sh` keeps future dead dependencies out.

### D6. Node 26, and early

Node 26 is the active LTS line; 22 reaches end of life on 2027-04-30 (research-tooling.md). Doing it in W2 means every later wave is verified on the final Node.

It covers `engines` (`>=26`), `.nvmrc`, CI `setup-node`, the devcontainer, and the server's runtime image base (the modified `server-deployment` requirement). Prod has no users before launch, so the image is redeployed and smoke-tested within the wave, under the existing deploy protocol.

### D7. A verification ladder sized to what each wave can break

| Wave | Verification |
|---|---|
| Every wave | `gate.sh` in the chain, `gate-full.sh` before merge |
| W3 | An offline Android build on Whim_Verify (emulator-5560) and an iOS simulator build |
| W3 | The on-device containment verdict (CONTAINED on the device WebView). React 19.3 entered the sandbox, which answers research.md open question 1. |
| W3 | `RUN_NETDENY_PROBE`, `RUN_VSTORE_PROBE` (isomorphic-git 1.44), `RUN_STORAGE_PROBE`, `RUN_BRIDGE_PROBE` and `RUN_DATA_COPY_PROBE` |
| W3 | Logcat shows the XHR SSE path was chosen (`fetchCanStream` false) |
| W3 | A generation streams end to end against a local stub server |
| W4 | `storage:test`, a device probe, and an op-sqlite 19 build opening a database written by 16.2.0 |
| W7 | The release upgrade check (spec `release-upgrade-check`) from the build testers have to the final candidate. Skipped, with a note, if no tester has a build. |

### D8. Brittle native seams are checked by symbol, not by behavior alone

The seams most likely to break silently get explicit checks in W3:
- `NetworkDeniedWebViewManager`'s superclass and `createViewInstance` signature, which `native-network-deny.suite.ts` checks by regex;
- `MainActivity`'s `ReactModalHostView.dialog` and `NativeDeviceInfoSpec` use;
- the `WhimStatusBar` swizzle targets;
- `WhimWebViewNetworkDeny.m`'s swizzle.

Each is re-read against the 0.88 sources, and each DEBUG-time "re-check after an RN upgrade" log line must stay silent on device.

The 0.88 template flips `UIViewControllerBasedStatusBarAppearance` to true. Whim keeps whatever value makes `WhimStatusBar` behave as today; the template is not authoritative over a deliberate swizzle.

## Risks / Trade-offs

- **[The Android toolchain jump (AGP 9.2.1, Gradle 9.4.1, Kotlin 2.2.0, compile SDK 37) breaks a library's Gradle script]** → Apply the template's `android.builtInKotlin=false` and `android.newDsl=false` opt-outs first (research-upstream.md §2). Fix by upgrading that library, not by patching its sources. A library with no compatible release gets a pin entry and the wave records it.
- **[A native library's `latest` doesn't support 0.88]** (screens 4.30.1, op-sqlite, mmkv and keyboard-controller are unverified) → Find out in the W3 build. Never fall back to a prerelease (D3). If op-sqlite 16.2 doesn't build on 0.88, fold W4 into W3.
- **[op-sqlite 16 → 19 corrupts or misreads existing user data]** → W4 opens a database written by 16.2.0, then runs the release upgrade check. No store build ships before W7.
- **[React 19.3 or esbuild 0.28 changes sandbox behavior]** → `npm run invariants` and `bridge:invariants` after the rebuild, plus the on-device verdict.
- **[0.88's Hermes ships a native `TextDecoder` and the fill-only-if-missing polyfill steps aside]** → The streaming decode path then runs on Hermes' implementation. W3's end-to-end generation on device covers it. A wrong decode shows up as a broken stream, not silent data loss.
- **[RN 0.88.1 has known iOS crashes waiting on 0.88.2, including `NativeDeviceInfo.getConstants`]** → D3 takes the newest patch at implementation time. If 0.88.2 hasn't shipped by W3, record whether the crash reproduces on the simulator.
- **[Playwright 1.65 changes the server's Chromium (149 → 158), and with it the probe surface]** → That is exactly what the invariants measure. A new failure is a finding, not something to suppress. The seccomp profile filenames embed `1.60.0` and are renamed in the same commit.
- **[The tooling waves take a while to review]** → Accepted. The commits are grouped per wave, and the PR description carries the wave table.

## Migration Plan

1. Run W1 through W7 in order on `integration/<run-id>`, one chain per wave part (D2).
2. Rollback within the run: revert the wave's commits. Waves are independent except that W3 assumes W2's Node and W6 assumes W3's `@react-native/eslint-config` 0.88.1.
3. Prod: W2 redeploys the server image on Node 26. Rolling back means redeploying the previous image tag.
4. Closure: one draft PR into `main`, the SonarCloud loop, `/git-cleanup`, then the merge. After that, the WebView provenance change is proposed against the merged versions.

## Open Questions

- **react-native-screens on 0.88.** Does 4.30.1 build and run on 0.88? Only 5.0.0-beta.1 states 0.88 support. W3 answers it.
- **Node 26 and the deploy toolchain.** Does it change anything the research didn't cover (Cloud Build images, the `firebase-tools` runtime)? W2 answers it during the redeploy.
