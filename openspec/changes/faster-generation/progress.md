# Progress ledger: faster-generation

Staging branch: integration/faster-generation · MAIN_TIP 780923c775601b0240b7b8b06df2a8eb90368981

## 2026-09-22

- run-start: staging branch cut from MAIN_TIP; planning artifacts committed as b7b04f5. Note: a leftover local `integration/store-launch` exists; its tree is identical to `origin/main` (pre-cleanup history of the merged launch run, never torn down), so it is not an active run. Left untouched for the owner.
- baseline (pre-change code, production roster `deepseek/deepseek-v4-flash-0731` + `deepseek/deepseek-v4.1-flash`, local server, 3 cases): clarify 3.5/29.5/32.0 s, rewrite 17.3/29.6/34.5 s, generate 44.6/122.6/225.9 s; the summariser tail is 20.0 s in every run. First pass without retries: `503 policy_unavailable` on 2/3 clarifies and 3/3 generates, one clarify `502` at 61.7 s. Numbers and method in design.md § Context.
- dispatch plan: chain-1 (server-roster) → Claude `implementer` (sonnet); chain-2 (server-flowbench) → Codex `gpt-6-luna` (owner asked to try Codex workers), gated and committed by the orchestrator because Codex's sandbox cannot write the linked-worktree index.
