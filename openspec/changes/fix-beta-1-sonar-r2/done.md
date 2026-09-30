# DONE: retry terminal persistence

Fix R2 S3 (and reopened R1 S75) only. Planning severity HIGH. This is behavioral; reproduce the user flow before fixing it. Own only the two allowlisted files. Use the existing shared MMKV write-fault seam; do not add a storage abstraction, dependency or checker change.

Follow the real rendered Retry → consent → Agree path against the existing streaming test server. Let retry setup succeed, then persistently reject terminal writes and close the stream without a terminal event. BASE must fail for the real rejected/stranded continuation, not a compile error.

Required behavior:

1. The consent-resumed retry settles without an unhandled rejection when terminal persistence fails.
2. A finished retry cannot stay falsely building. Preserve the prior pending/journal pair when the new terminal state cannot be written; do not fabricate a terminal journal or payload. If restoration itself fails, handle siblings independently and show only a state supported by persisted data.
3. Show the established generic, content-free failure surface, with exactly one request. Do not expose storage errors, prompts, diagnostic internals or start another request.
4. Preserve normal retry identity, cancellation, delivery, ordinary terminal failure and the existing pre-request rollback.

Run `npm run -s launcher:test` for the rendered acceptance. No single-suite selector exists. Additional assertions must target a distinct boundary, not repeat implementation literals. No void, dummy/empty catch, suppression, transitional flag, constant branch or checker/config change.

Read docs/capabilities.md and its pending-builds/prompt-flow/generation-run-journal specs, plus relevant launcher/storage decisions before editing. Use research.md for the reconciled producer graph and evidence.txt for root-verified live statements. Root stale check initially returned 7 for an inexact standalone brace, then returned 0 on corrected exact statements; no dispatch occurred on 7.

Worktree, immutable BASE and branch are supplied by root. First pin the worktree with an untracked .gitkeep. Every Git mutation uses `git -C <your absolute worktree>`. Bootstrap only ignored dependencies, resolving @whim/contract to your own contract workspace; do not alter main node_modules or tracked config. Own the sole source gate lease; no native jobs run concurrently. Self-gate with scripts/gate.sh, commit only allowlisted paths, report actual exits and source SHA. Root performs independent RED/integrity/review/full gate/merge/regate. Do not merge or publish.
