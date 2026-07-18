---
name: "OPSX: Apply"
description: Implement an OpenSpec change by dispatching it through the Whim build harness (schema-keyed)
category: Workflow
tags: [workflow, artifacts, harness]
---

Implement an OpenSpec change. You are the DISPATCHER (main thread): you route by schema, orchestrate subagents, adjudicate reports, and merge. You NEVER implement inline in the main thread, and you NEVER read implementation files unless adjudicating a deviation. Canonical architecture + rationale: docs/harness.md. Each run integrates on its own staging branch `integration/<change-id>`, cut from `main` at run start; `main` receives exactly one human-ratified merge at run closure (docs/harness.md §3).

**Input**: optionally a change name (`/opsx:apply <name>`). If omitted: infer from conversation context; auto-select if only one active change; else `openspec list --json` + AskUserQuestion. Always announce: "Using change: <name>".

**Route by schema** — `openspec status --change "<name>" --json` → `schemaName`:

- `whim-fixloop` → run the /fix-loop orchestration (runbook: `.claude/commands/fix-loop.md`) over the change's findings.md / plan.md / dispositions.md. dispositions.md + the fix/wip branches are the resume state for a partially-run batch. Stop here; nothing below applies.
- `whim-harness` → the dispatch loop below.
- anything else → STOP and ask the user. There is no sanctioned inline-implementation path: a change without chains gets its chains.md written first, not a main-thread coding session.

Then `openspec instructions apply --change "<name>" --json` → contextFiles, progress, task list. `state: blocked` (missing artifacts) → tell the user to finish them with `/opsx:propose <name>`. `state: all_done` → suggest `/opsx:archive`.

# Dispatch loop (whim-harness)

Preconditions (check once; STOP and tell the user if any fail):
- `scripts/gate.sh`, `scripts/gate-full.sh`, `scripts/fixloop.sh` exist and are committed clean (the gate's pinned-BASE tamper tripwire refuses to run on dirty harness config).
- The primary working tree is clean (merges and the regate run here).
- No other staging branch is active: `git branch --list 'integration/*'` must be empty (one active run at a time — a second concurrent run is refused, surface the active one instead).

Setup:
0. RUN START: record `MAIN_TIP = git rev-parse main`; cut the staging branch `git branch integration/<change-id> "$MAIN_TIP"` and `git switch integration/<change-id>`; export `FIXLOOP_INTEGRATION_BRANCH=integration/<change-id>` for every `fixloop.sh` invocation this run; ledger `run-start` (staging branch, MAIN_TIP). All merges, regates, and gate-full below happen on this branch; `main` is untouched until CLOSURE.
1. Read the planning artifacts from contextFiles: proposal.md, design.md, tasks.md, chains.md, research.md if present. If chains.md is missing, create it per the whim-harness schema's chain rules and show the user for a quick OK before dispatching anything.
2. Chains touching Class-2 config (gate scripts, `.claude/**`, `invariants/`, `build/`) are NOT dispatchable — the scoped-grant mechanism covers Class-1 config only. Honor HUMAN-BOOTSTRAP / separate-session markers in chains.md: surface those chains to the user and skip them.
3. Create or open progress.md in the change folder — the ledger. Append every disposition AS IT HAPPENS (chain dispatched with BASE, worktree path, report received, check results, merged/parked/halted), never batched at the end. The ledger + the chain/wip branches are the resume state if your context dies mid-change.
4. Build the chain DAG: chain X depends on chain Y iff X `reads` a contract Y declares as `writes-contract` (plus any explicit `after:` in chains.md). Chains with all dependencies merged are ELIGIBLE and MAY run in parallel — their file scopes must not overlap (chains.md groups by shared files; if two eligible chains touch the same files the partition is wrong: surface it, don't dispatch both). Merges (step 9) are strictly serialized regardless.

Per chain, once eligible:
5. WORKTREE (orchestrator-owned, pre-created). BASE = `git rev-parse integration/<change-id>` (the staging tip — every BASE still traces to the recorded MAIN_TIP ancestor); ledger `dispatched` (chain, BASE). Then `git worktree add -b chain/<change>-<id> .claude/worktrees/<change>-<id> "$BASE"` (needs the OS sandbox off for this one command — checkout materializes `.claude/**` copies; it prompts once). Then `npm run build` inside the worktree (~0.3s — populates the gitignored `src/runtime/generated/*` a fresh worktree lacks).
   - greenBy (phased suites only): if chains.md or its handoff contract declares a `greenBy`-phased suite, Write `<worktree>/<suite>/.phase` containing this chain's phase id BEFORE dispatching, so the implementer's self-gate holds later-chain tests as pending instead of red. `.phase` is untracked + gitignored: it never reaches a commit, so the final gate (step 10) and CI run strict by construction — no delete step to forget.
6. DISPATCH one `implementer` subagent with the chain block: chain id; its task list verbatim from tasks.md; ONLY the spec sections its chains.md entry names (excerpt them — never hand over whole files); paths of contracts it reads; the contract it must write, if any; the worktree path + branch. The implementer cds into the worktree (agent↔worktree ownership binds on first use), pins an untracked `.gitkeep`, implements, self-gates `./scripts/gate.sh` until green, commits, and reports. It does NOT tick tasks.md — you do that at merge (parallel chains ticking one shared file is a guaranteed merge conflict).
7. ADJUDICATE the report (trust exit codes and the reviewer over prose — "all good" is a claim, GATE: PASS is evidence):
   - STATUS complete + GATE PASS → proceed to step 8.
   - Class-A deviations → log them; the same pattern in 2+ chains → note under "tripwire candidates" in progress.md.
   - STATUS blocked, class B → adjudicate: answer from the spec/design and SendMessage the same implementer; or amend the chain block and redispatch fresh; or amend chains.md. If adjudication requires reading the actual diff, dispatch the `reviewer` rather than reading it yourself. If the deviation invalidates the proposal, STOP and surface to the user.
   - Class C, or failed-gate persisting after one redispatch → HALT EVERYTHING. Halt summary to progress.md; tell the user what halted, why, what you recommend. A critical finding surfaced early is a success, not a failure.
8. INTEGRITY (deterministic): `scripts/fixloop.sh integrity chain/<change>-<id> [allowlist]` — pass the chain's declared file scope if chains.md declares one, else run without an allowlist (the protected-files floor still applies). exit 3 = tamper → ESCALATE to the user (never self-approve). exit 4 = scope violation → re-plan if it stays same-subsystem and non-protected, else escalate. exit 6 = sanctioned Class-1 config change → the user ratifies at merge. exit 0 → proceed.
9. MERGE (strictly serialized — one chain at a time, even when work ran in parallel): `git switch integration/<change-id> && git merge --no-ff chain/<change>-<id> -m "chain(<change>): <id>"`. A merge CONFLICT means the chain partition was wrong — abort the merge, HALT, surface; never auto-resolve. Then tick this chain's tasks in tasks.md (staging branch, primary tree) and REGATE: `./scripts/gate.sh` on the merged tip — each chain was gated against its own BASE, never against its siblings; the regate catches two individually-green chains that break each other at the merge that caused it. PASS → ledger `merged` + `regate-pass`; clean up (`git worktree remove --force .claude/worktrees/<change>-<id>`, `git branch -d chain/<change>-<id>`, `rm -f .claude/fixloop/owners/<change>-<id>`); dispatch any newly-eligible chains. FAIL → `git revert --no-edit -m 1 HEAD`, `scripts/fixloop.sh park chain/<change>-<id> "<reason>"`, ledger `regate-fail`.

After the last chain:
10. Run `./scripts/gate-full.sh` once on the merged staging tip (knip + Metro + the Chromium invariants + openspec validate; strict for any greenBy suite by construction).
11. Dispatch the `reviewer` on the whole change's diff range (first recorded BASE → staging tip) with the change's spec excerpts. report-mismatch or high-severity findings → convert into a fix chain and run it through steps 5–9.
12. CLOSURE (attended only — every remote write passes a human at the scoped-push prompt):
   a. Push the staging branch — exactly `git push origin integration/<change-id>` (the anchored simple form the policy recognizes; approve the refspec at the prompt) — and open a DRAFT PR `integration/<change-id>` → `main` (human, or `gh` by hand). Every approved push triggers SonarCloud automatic analysis + the CI `pull_request` jobs.
   b. Sonar iteration: transcribe SonarCloud findings into a findings list AND append one line per finding to `openspec/critic/sonar-ledger.md` at transcription time (grammar in the ledger's header; run-id = this change id; a re-run of the same round reuses the same run-id); then run the /fix-loop orchestration over the findings with `FIXLOOP_INTEGRATION_BRANCH=integration/<change-id>` (a nested fix-loop run REUSES the active staging branch, it never cuts its own); re-push; repeat until the PR quality gate is green.
   c. History cleanup: run /git-cleanup with `target_branch=integration/<change-id>` in the grant (schema: target_branch/target_sha/target_tree — see scripts/git-cleanup-check.sh); on CLEANUP GATE PASS the human applies the printed reset and force-pushes the branch (`--force-with-lease`).
   d. FINAL MERGE (human): check `git merge-base --is-ancestor main integration/<change-id>` — on failure the staging branch diverged: rebase or restart it, NEVER surgery on main. Then `git switch main && git merge --no-ff integration/<change-id>` and push main. No post-merge regate: the ancestor check makes the merged tree byte-identical to the staging tip that gate-full + SonarCloud already verified.
   e. Run teardown: delete `integration/<change-id>` (local + remote) and close the PR; a parked run instead keeps its branch under the `wip/*` convention.
13. Closing summary to progress.md: chains run, redispatches, deviations by class, reviewer verdict. Collect `MEMORY:` proposals from implementer reports, dedupe, and apply the worthwhile ones yourself (each Write prompts the human; unattended → list them for ratification instead). Tell the user the change is ready for a skim of progress.md + the proposal — not the diff — and suggest `/opsx:archive`.

On any terminal wall you won't pursue further: `scripts/fixloop.sh park chain/<change>-<id> "<reason>"` — NEVER delete; the branch survives as `wip/<id>` with a reason note.

Caps (bounded autonomy, then escalate — never silent-drop): the implementer self-gates in its own loop; one redispatch per chain on failed-gate; SendMessage revisions ≤ 2 per chain; protected-file touches (integrity exit 3/6), merge conflicts, and proposal-invalidating deviations ALWAYS go to the user.
