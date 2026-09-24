# developer-observability chain-1 (implementer) — harness feedback

- **What:** Fast gate failed at BASE on the emoji static check in a launcher file no chain owns. **Mechanism:** gate check (`checks/test/repo/source-scans.suite.ts`), run-start state. **Verdict:** DRAWBACK. **Cost:** ~4 calls, ~5 min. **Evidence:** `orb-actions.ts:39, :42` at `ef2e063` (only under Node v22.20.0, the version the chain block named; #87).
- **What:** Secret-name scan flagged fluent-bit's `time_key` in a config that had to stay byte-for-byte. **Mechanism:** deploy-config secret scan vs a contract requirement. **Verdict:** NEUTRAL (needed a narrow exemption). **Cost:** 1 gate iteration. **Evidence:** `deploy/vm/ops-agent.yaml:12 sets secret-named time_key`.
- **What:** Injected co-author reminder contradicted the user's CLAUDE.md; committed then amended. **Mechanism:** conflicting instructions (T11). **Verdict:** DRAWBACK. **Cost:** 1 call.
- **What:** Red-checks by hand with backups and full-suite reruns (~40 s each). **Mechanism:** tooling (T6, T10). **Verdict:** DRAWBACK. **Cost:** 3 full server:test runs.
- **What:** zsh `nomatch` on `grep --include=*.ts`. **Mechanism:** shell. **Verdict:** ENV. **Cost:** 2 calls.

**What helped:** the handoff's load-bearing notes (string-only `map_values`) became a faithful emulation and a meaningful red case; prepared worktree; chain block naming owned files.

**What the harness should change:**
1. Run `gate.sh` on the staging tip at run start and stop if red, so chains don't each rediscover the same BASE failure.
2. A single-suite mode for `server/test/run.mjs` (`--only logging,deploy-config`).
3. Drop the co-author reminder from implementer contexts when the user's CLAUDE.md forbids it.
