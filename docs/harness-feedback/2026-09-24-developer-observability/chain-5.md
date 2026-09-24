# developer-observability chain-5 (implementer) — harness feedback

- **What:** No-`&&` rule vs the dispatch's `cd <worktree> && …`. **Verdict:** NEUTRAL (T2).
- **What:** The red-check task 5.2 names (remove the iOS entry) already failed before the change, so it couldn't show the new check works; had to design the discriminating variant (manifest + every declaration dropping diagnostics together). **Mechanism:** chain block / tasks.md. **Verdict:** DRAWBACK. **Cost:** ~5 min.
- **What:** Hand-built red-checks with scratch backups + `sed`; one replacement silently didn't match, found only by diffing against the backup. **Mechanism:** no red-check helper (T6). **Verdict:** DRAWBACK. **Cost:** ~3 min.
- **What:** zsh `nomatch` on `grep --include=*.ts`. **Verdict:** ENV.
- **What:** tasks.md says "record in progress.md", dispatch says "in your report". **Verdict:** NEUTRAL.

**What helped:** `handoff/disclosure-manifest.md` (exact store mapping, category ids, where checks are wired); the existing checker's per-declaration readers; the dispatch settling the detection rule for chain-4's transport.

**What the harness should change:**
1. At plan time, verify each named red-check actually fails on the base branch; otherwise name the weaker variant the new check must catch.
2. A red-check helper that refuses a mutation that didn't change the file and records each variant with its failing test.
3. Reconcile the one-command rule with `cd <wt> && …` (T2).
