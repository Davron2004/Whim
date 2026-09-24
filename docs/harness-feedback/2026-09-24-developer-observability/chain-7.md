# developer-observability chain-7 (implementer) — harness feedback

- **What:** The plan assumed knip would see the new devDependency once a script imported it; knip never reads `scripts/`. **Mechanism:** chain block + knip config. **Verdict:** DRAWBACK. **Cost:** ~6 calls, ~12 min. **Evidence:** `knip.json` `project` has no `scripts/**`; four import forms all gave `Unused devDependencies (1) metro-symbolicate`.
- **What:** No-`&&` rule vs the chain block's `cd <wt> && …`. **Verdict:** NEUTRAL (T2).
- **What:** zsh `nomatch` on `grep --include=*.ts`; no `timeout` on macOS. **Mechanism:** tooling. **Verdict:** ENV. **Cost:** 2 calls.
- **What:** Self-gate caught a module-file `declare module 'node:module'` (augmentation-only) and an unused eslint-disable. **Mechanism:** typecheck, lint. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 1 iteration.

**What helped:** the dispatcher supplied a real release map, so the fixture came from real build output (trimmed vs full map give byte-identical symbolication); the bucket name was pinned; `release-tag.ts`'s injected runner and the deploy suite's stubbed tools meant no new design.

**What the harness should change:**
1. When a chain block requires "knip clean" for a dependency, check at planning time that the consuming file is inside knip's `project` globs (or add `scripts/**` once and clear the 6 unused exports it surfaces).
2. Resolve the no-`&&` vs `cd <wt> && …` contradiction (T2).
