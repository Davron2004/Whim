# fix-4 (keyboard iOS + Android 15+, Settings, sheet), implementer, Opus. Resumed from an orchestrator-saved WIP (the first agent died at the usage limit)

- **What:** resuming from a WIP commit. **Mechanism:** running the gate first, then reading the diff against BASE. **Verdict:** NEUTRAL (worked). **Cost:** low; the gate passed on the WIP, so the review could focus on the design and the device. **Evidence:** gate1 log; WIP commit 785114f6.
- **What:** device checks from a worktree. **Mechanism:** a JS-swap repack (Metro bundle with watchFolders on the primary node_modules → hermesc → zip -0 into the pulled APK → zipalign + debug sign) instead of `android:release`, which can't resolve `node_modules` from a worktree. **Verdict:** NEUTRAL (worked well). **Cost:** about 90 seconds per build. **Evidence:** 11 emulator screenshots; this is how the Modal keyboard-event question was answered.
- **What:** red-check attribution. **Mechanism:** the launcher runner prints a test's name after its checks, so reading the preceding bullet named the wrong test. **Verdict:** DRAWBACK. **Cost:** one rerun. **Evidence:** my first red-check output named the wrong test.

Proposals:
1. An `apk-swap` helper under scripts/ that pulls the installed APK, swaps in the worktree's Hermes bundle, re-signs and installs it on a named emulator, so chains can check on a device without the main tree.
2. `run.mjs` prints each test's name before its checks, or prefixes each failure with its test name.
