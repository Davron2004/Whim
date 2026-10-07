# Orchestrator: health-probe-path (2026-10-07)

- **What:** chain-2 (app-only, no `contract/` or `server/` edits) failed its first self-gate on the `server` check until it added `node_modules/@whim` symlinks itself.
- **Mechanism:** worktree setup
- **Verdict:** DRAWBACK
- **Cost:** one extra gate run in chain-2
- **Evidence:** chain-2 report: "the `server` check (`@whim/contract is bundled into the entry`)". The dispatcher pre-created the symlinks only for the server chain, following memory that scoped them to chains touching `contract/`/`server/`.

- **What:** the runbook's "no other `integration/*` branch" precondition blocked a fresh staging branch; the change ran on the active `integration/beta-1` instead.
- **Mechanism:** runbook rule
- **Verdict:** NEUTRAL
- **Cost:** none; one ledger line
- **Evidence:** progress.md run-start entry. The owner wanted the fix in the next beta-1 build anyway.

- **What:** a 3-chain, spec-changing fix needed all six `whim-harness` artifacts, because `whim-fixloop` has no spec artifact.
- **Mechanism:** tooling (schema set)
- **Verdict:** DRAWBACK
- **Cost:** ~10 minutes of planning artifacts
- **Evidence:** `openspec/schemas/whim-fixloop/schema.yaml` artifacts: findings, plan, dispositions.

- **What:** the reviewer found stale operator text (smoke's `--pages-only` error named `/healthz`) and an untested in-place uptime update.
- **Mechanism:** reviewer pass
- **Verdict:** CAUGHT-REAL-MISTAKE
- **Cost:** one small fix chain (fix-1)
- **Evidence:** reviewer findings 1 and 4; fix-1 commit 4ab0d4d4.

## What helped

Asking implementers to red-check against named weaker variants, not against deletion. Chain-2's fallback tests fail on "fall back on any non-200", "fresh deadline" and "fall back on network error". Chain-3 tightened a substring assertion that the old path would have passed.

## What the harness should change

1. The dispatcher should pre-create the `@whim` symlinks in every chain worktree, not only `contract/`/`server/` chains, because the fast gate's `server` check bundles from any tree.
2. Give `whim-fixloop` an optional spec-delta artifact, so a small spec-changing fix doesn't need the full six-artifact proposal.
