# orchestrator (main thread): harness feedback, request-envelope 2026-09-23

Run shape: 6 planned chains + 1b (spec gap) + 7a/7b (review fixes); chains 1‖3, then 2‖4, then 1b‖5, then 7a‖7b.
One SendMessage revision (chain-1), zero redispatches, zero regate failures, zero integrity failures.

## Blocks, stops and detours

- **What:** chain-1 couldn't pass its gate: adding two `ServiceRefusalCode` members broke the phone's exhaustive `REFUSAL_RULES` (in `src/`, owned by chain-4).
  **Mechanism:** chain planning (chains.md split a contract enum from its exhaustive consumer) + per-chain self-gate.
  **Verdict:** CAUGHT-REAL-MISTAKE (the gate exposed a planning error on the first run) — but the chain rules produced the error. Cost: one blocked round-trip, ~6 min.
  **Evidence:** `service-refusal.ts(29,14): TS2739 … missing update_required, consent_required`.
- **What:** every worktree needed `node_modules/@whim/{contract,server}` symlinks created by hand; I skipped them for chain-3 (no server edits) and its fast gate still failed until it made them itself.
  **Mechanism:** worktree setup (step 5 of the runbook doesn't create them; a memory note does).
  **Verdict:** DRAWBACK. Cost: a few tool calls per chain, one lost detour in chain-3.
  **Evidence:** chain-3 report: `@whim/contract is bundled into the entry`.
- **What:** task 3.3 (on-device check) couldn't run in its chain; Metro can't bundle from `.claude/worktrees/<id>`. Deferred to a main-tree verifier after merge.
  **Mechanism:** worktree path depth vs Metro resolution.
  **Verdict:** DRAWBACK. Chains with device tasks are never self-contained. Cost: one extra verifier dispatch, serialized against merges.
- **What:** main-tree exclusivity: the verifier's temporary `App.tsx`/`LauncherRoot.tsx` probe, gate-full, merges and my ledger commits all compete for one tree; I had to commit the ledger mid-verification and tell the reviewer to read committed content only.
  **Mechanism:** the full gate and device builds need the main tree (#74).
  **Verdict:** DRAWBACK. Cost: sequencing care; no failure.
- **What:** `chains.md` had no contract from chain-4 to chain-5 (refusal routing) and no chain for the unmet part of 1.3; I amended chains.md twice at dispatch (chain-4 writes-contract, chain-1b).
  **Mechanism:** chain planning rules (no check that every cross-chain seam has a contract).
  **Verdict:** DRAWBACK (planning gap, cheap to fix live).
- **What:** integrity checks ran with no allowlist (chains.md declares no file scopes) and all passed; with the Class 1/2 system retired they check only the protected floor. chain-1's approved `src/` edits and chain-5's `checks/` edit would have passed regardless.
  **Mechanism:** `fixloop.sh integrity` without scopes.
  **Verdict:** NEUTRAL leaning DRAWBACK: runs every chain, caught nothing, can't catch scope creep as configured.
- **What:** regate after every merge (7 times) all passed.
  **Mechanism:** step 9 regate.
  **Verdict:** NEUTRAL (insurance; ~1–2 min each, no catch this run).
- **What:** tasks are ticked when the chain merges, not when each task's acceptance is verified; 5.3 was ticked though its wording ("before the prompt field accepts input") wasn't implemented.
  **Mechanism:** runbook step 9 ticking.
  **Verdict:** DRAWBACK; the reviewer caught it, the harness didn't.
- **What:** the gate can't typecheck `src/host/*/test`, `checks/test`, `evals/test` (tsconfig-excluded); 13 type errors from stale fixtures got past 7 green regates and gate-full.
  **Mechanism:** gate coverage.
  **Verdict:** DRAWBACK (filed #79).
- **What:** the Android emulator is a shared resource the harness doesn't know about; I had to ask the owner whether the demo session was using it.
  **Mechanism:** none (no resource lock).
  **Verdict:** DRAWBACK (minor).
- **What:** after each worktree removal, hundreds of stale "Cannot find module" IDE diagnostics streamed into my context for files in deleted worktrees.
  **Mechanism:** IDE ↔ worktree lifecycle.
  **Verdict:** ENV. Cost: context noise on every later turn.

## What helped

- The final reviewer: caught H1 (a rollback to a pre-change image would fail smoke on tomorrow's deploy), a weakened test (`> 0`), a duplicate log key, 13 hidden type errors, and a ticked-but-unmet task. Highest value step of the run.
- Implementer honesty rule: chain-1 reported its own unmet spec clause; that became chain-1b.
- Handoff contracts: chains 2, 4 and 5 started from them without reading the prior chain's code; chain-1's `envelope.md` was precise enough that no later chain asked a question.
- Red-checks against weaker variants: every chain reported them; they're why most tests look non-vacuous to the reviewer.
- Parallel dependency-free chains: roughly halved wall-clock.

## What the harness should change

1. One worktree-create command (`fixloop.sh worktree <change> <id>`) that does add + `npm run build` + `@whim` symlinks + owner file, and a matching remove; the runbook calls it instead of a memory note.
2. Chain planning check: a chain must gate green in isolation. At minimum, a rule that a closed-union contract change and every exhaustive consumer land in one chain, and a lint over chains.md that each `reads` handoff has a `writes-contract` producer.
3. Make the final reviewer's mechanical findings mechanical: typecheck the test dirs (#79), and give integrity real per-chain file scopes from chains.md or drop it.
