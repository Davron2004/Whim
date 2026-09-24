# developer-observability — orchestrator (2026-09-24) — harness feedback

- **What:** Ran this change in parallel with legal-surface-v2 from lsv2's staging tip; lsv2's history rewrite then forced a re-apply of this change's diff onto main (3 real conflicts, ~30 min). **Verdict:** DRAWBACK (see lsv2 orchestrator.md proposal 2).
- **What:** gate-full caught a real regression the fast gate can't see (synthrun lost message-bearing errors after the loader change). **Mechanism:** gate-full (Chromium suites). **Verdict:** CAUGHT-REAL-MISTAKE.
- **What:** The whole-change reviewer caught privacy leaks four chains and all gates missed: model-written plan text in an allowlisted field; Caddy error lines shipping device IDs (confirmed live, purged); classifier text in a log field; fatal render crashes bypassing the handler. **Verdict:** CAUGHT-REAL-MISTAKE ×4.
- **What:** A cross-change interaction (log-age-cap truncation × Ops Agent tail) was found only by the re-apply agent reading both diffs. **Verdict:** CAUGHT-REAL-MISTAKE (T14).
- **What:** Production `provision.sh` failed on a Cloud Monitoring shape rule; fixed via a post-merge PR. **Verdict:** DRAWBACK.
- **What:** Two chain blocks named interfaces that didn't exist ("the terminal event has a `code`", "the list is in `server/src/policy/`"), and one told a chain to log a field the logger redacts. **Mechanism:** chain block written without grep-verification. **Verdict:** DRAWBACK (T1) — the orchestrator's own mistakes.
- **What:** Parallel agents shared one scratchpad and overwrote each other's gate logs. **Verdict:** DRAWBACK (T7); later dispatches prefixed log names.
- **What:** Token-bearing `curl` to the Monitoring API is refused by the auto-mode classifier, so the uptime alert's firing couldn't be read programmatically; left to the owner's inbox. **Verdict:** ENV.

**What helped:** separately-authored `invariants/` cases gave chain-3 a red-first target; per-chain scope fences produced zero merge conflicts across 9 merges; the reviewer's per-field provenance tracing.

**What the harness should change:**
1. Grep-verify every interface a chain block names (fields, files, codes) before dispatch, and check logged field names against the logger's redaction list.
2. Per-agent scratchpad subdirectories (T7).
3. Structural checks for cloud config shape limits; a mocked `gcloud` isn't enough.
