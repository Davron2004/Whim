# Progress ledger: platform-release-readiness

Staging branch: integration/store-launch (shared launch run; MAIN_TIP 3a66cca)

- 18:20 dispatched chain-1 BASE 5b74787
- 18:39 chain-1 report: complete, GATE PASS, class-A (scripts/release/env.d.ts ambient shim) · integrity OK · merged · regate-pass
- 18:39 dispatched chain-2 BASE 5b85113
- 18:39 dispatched chain-3 BASE 5b85113
- 18:52 chain-2 report: complete, GATE PASS · integrity OK · merged · regate-pass. Discrimination is unit-level (bare global lacks TextDecoder, install provides it); the load-order proof is on-device in chain-12. Fix batch: stale "see ./polyfills" comment in src/host/version-store/env.d.ts.
- 18:52 dispatched chain-4 BASE 4be36ba
- 19:05 chain-3 report: complete, GATE PASS, class-A x2 (RCTLinkingManager via React umbrella; worktree xcodebuild stops at Metro bundling through symlinked node_modules, compile+link and resolved entitlements verified) · integrity OK · merged · regate-pass. Full simulator Release build + probes delegated to a clean-clone verifier.
- 19:05 dispatched chain-6 BASE e7dd788
- 19:12 clean-clone iOS verification at 3823440: Release simulator BUILD SUCCEEDED (com.anycognition.whim, 1.0.0, ITSAppUsesNonExemptEncryption false, privacy manifest bundled); launch PASS, no crash; RUN_STORAGE_PROBE PASS and RUN_BRIDGE_PROBE PASS (the TextDecoder crash is gone end to end). Not covered: WebKit containment 49/49 (no tap driver in the verifier; carry to chain-12 or a Maestro iOS flow); simulator codesign shows empty entitlements (normal for simulator builds, check associated domains on the device build in chain-12).
- 19:14 plan amendment merged: fourth containment leg (native network deny-all), chains 14-18, chain-12 extended · dispatched chain-14 BASE 7c2f8ce
- 22:55 RESUME (fresh orchestrator after the usage cutoff at ~19:19): chain-4 worktree held ~300 lines of uncommitted work, handoff/android-build.md written, self-gate never returned → re-dispatched into the same worktree (BASE 4be36ba) to continue from the diff. chain-6 and chain-14 had no work (agents were still reading) → worktrees removed and recreated. Carry: the chain-4 handoff claims the offline build type breaks assembleDebug/assembleOffline at native link (ShadowNode::getDebugName) — verify against BASE before merge.
- 22:55 dispatched chain-6 BASE 99ed045 (fresh worktree)
- 23:10 dispatched chain-8 BASE 96b59c2. Owner decisions passed in: App Store and Play listing name "Whim: Small Apps You Describe"; home-screen name stays "Whim"; domain anycognition.ca (URLs derived at upload time, never committed).
