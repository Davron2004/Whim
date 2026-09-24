# developer-observability chain-4 (implementer) — harness feedback

- **What:** No-chaining rule vs `cd <wt> && …`. **Verdict:** DRAWBACK (T2). **Cost:** ~1 min.
- **What:** zsh `nomatch` on `grep --include=*.ts`. **Verdict:** ENV. **Cost:** 2 calls.
- **What:** Own test fixtures misread the dedup key (records differing only by `stage` merged). **Mechanism:** self-gate (launcher suite). **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 1 iteration. **Evidence:** "fill the session's 50 (got 2, want 50)".
- **What:** `sonarjs/no-extra-arguments` false positive on a reassigned `let` handler; `--max-warnings 0` refused a deep import. **Mechanism:** gate lint. **Verdict:** DRAWBACK / NEUTRAL. **Cost:** ~4 min.
- **What:** No single-suite mode; every iteration ran 12.4k checks. **Verdict:** DRAWBACK (T10). **Cost:** 4 full runs.
- **What:** Red-checks needed hand backups of untracked files (`git restore` can't). **Verdict:** NEUTRAL (T6).

**What helped:** the server-diagnostics contract's caps and `.strict()` note; the privacy-settings contract's "read at each decision" rule; the chain block naming the existing consent gate and the real loader frame shape; the memory that repo-wide scans hang off `checks/test/acceptance.ts`.

**What the harness should change:**
1. `LAUNCHER_ONLY=<suite>` for `launcher:test`.
2. Settle the cd-and-chain rule in the implementer prompt.
3. A red-check helper that snapshots named files, untracked included.
