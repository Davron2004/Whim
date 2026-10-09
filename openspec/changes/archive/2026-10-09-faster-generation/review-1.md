# Review 1: whole-change audit (b7b04f5..b7ff2b7)

Reviewer subagent (sonnet), 2026-09-22. Verdict: changes requested. Every finding is folded into chain-3 (tasks 3.1–3.4).

1. **medium** · `server/src/lifecycle.ts:346-354`, `server/src/generation/model.ts:134-163`. A malformed `WHIM_*_REASONING` fails boot only when `WHIM_PIPELINE` is not `stub`: the stub-mode `catch` around `buildModelDepsFromEnv` swallows every error, including `ModelRosterReasoningError`. That contradicts the scenario "A misspelled setting fails at boot". `WHIM_PROVIDER_SORT` is validated unconditionally in `loadServerConfig` and does fail in every mode. → task 3.1.
2. **medium** · `server/test/flowbench.suite.ts:186-243`, `server/flowbench.mjs:20-34`. Exit codes `1` and `2` are only tested through the library (`parseArgs` throwing in-process); only exit `0` runs the real CLI process. The entry's own wiring for the failure and bad-argument paths is untested, and that is the seam chain-2b had to fix. → task 3.3.
3. **medium** · `server/src/config.ts:38-45,143-150,168-175`. Eight new `ServerConfig` fields are read from env unvalidated and never used anywhere; they exist only so `deploy-config.suite.ts`'s runbook check accepts the documented names. → task 3.2, which makes the names real deploy inputs instead (design D6).
4. **low** · `server/src/loadtest/replay-model.ts:8-11`. The module comment still describes plan/clarify/summary as fixed aliases of `roster.engineer`/`roster.rewrite`. Behavior is unaffected. → task 3.4.

Checked and clean: behavioral regressions (thinking events, the classifier's 48-token cap, rewrite retry, summary timeout, loadtest replay, ledger accounting), robustness (all six `ReasoningSetting` values on the wire; a provider rejecting `enabled: false` surfaces as the existing typed error; exactly one `model call` line on completed, failed and aborted paths, per-call state, no content leak), test quality, docs accuracy, and the flowbench entry's exports after chain-2b.

The orchestrator found a fifth gap while adjudicating finding 3: `deploy/lib.sh`'s `WHIM_VALUE_KEYS` and `deploy/deploy.sh`'s `stage_server_files` whitelist what reaches the production container, so none of the new knobs could be set in production. → task 3.2, design D6.
