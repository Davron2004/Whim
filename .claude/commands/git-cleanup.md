Run the git-history cleanup lane. "$ARGUMENTS" is optional grouping guidance from the human (which runs to squash, what to keep as milestones); if empty, the cleaner groups by topic on its own judgment. You are the ORCHESTRATOR (main thread): you mint the grant, pin the reference data, create the lane, dispatch the `git-cleaner` subagent, and judge the outcome with ONE mechanical check. You NEVER rewrite history yourself; the rewrite happens only inside the cleaner's lane. On CLEANUP GATE PASS the two dangerous operations — moving the target ref and force-pushing — are executed by the ORCHESTRATOR itself (the pinned tree-identity gate + intact backup ref are the safety, never the human's typing). Full design + rationale: docs/archive/parallel-fix-loop.md §4.10 (branch-parameterized by openspec: staging-integration-lane).

**Standing grouping rule:** Sonar-fix iteration commits (from CLOSURE quality-gate rounds) are FOLDED into the semantic commits whose code they touch — no standalone Sonar-fix commit survives cleanup. The tip tree is unchanged by construction, so folding never alters content.

The model in one line: **freed path, gated outcome.** The cleaner may do anything to the shape of history inside its lane; the single acceptance check is that the cleanup branch's tip TREE is byte-identical to the TARGET's tree pinned before dispatch — so no content change of any kind can survive, and you audit one hash equality instead of the agent's process.

**TARGET selection.** The lane rewrites one branch, `TARGET`:
- **Standard flow:** the active staging branch `integration/<run-id>`, cleaned PRE-merge (apply.md CLOSURE step 12c) so `main` receives already-semantic history and is never force-pushed.
- **Legacy mode:** `main` itself — pre-existing history only; prefer never using it again.

Derived lane names (`ID = TARGET with / → -`; the hooks derive the same names from the grant — do not vary them):
- worktree: `.claude/worktrees/<ID>-squashed`
- branch: `cleanup/<ID>-squashed`
- grant: `.claude/fixloop/grants/git-cleanup` (fixed path — one lane at a time)
- backup ref: `backup/pre-cleanup-<ID>` (legacy `main` runs may still carry `backup/pre-cleanup`)
- outcome gate: `scripts/git-cleanup-check.sh`

## Preconditions (check once, STOP and tell the user if any fail)

1. **No fix-loop run is active**: `.claude/fixloop/owners/` must be empty (`ls`). History rewrite under a live pinned-BASE audit is the one forbidden interaction. A stale marker from a previous cleanup (`owners/<ID>-squashed`) must also be removed before dispatching a NEW agent, or `owners_claim` refuses it.
2. **No leftover lane state** from a previous run: no `grants/git-cleanup`, no `<ID>-squashed` worktree, no `cleanup/*-squashed` or `backup/pre-cleanup*` branches. If present, a previous run wasn't torn down — show the user `scripts/git-cleanup-check.sh` output and finish THAT run first.
3. Working tree clean on TARGET (`git status`), and `scripts/git-cleanup-check.sh` exists and is committed clean.

## Setup (each step routes through the human's ask prompt — that is the ratification)

1. **Pin** (read-only, no prompt): `git rev-parse <TARGET>` → TARGET_SHA, `git rev-parse '<TARGET>^{tree}'` → TARGET_TREE, `git rev-list --count <TARGET>` → BEFORE_COUNT.
2. **Mint the grant** — Write (the Edit/Write tool, NEVER a shell redirect — bash writes to `grants/` are policy-denied for everyone) to `.claude/fixloop/grants/git-cleanup`:
   ```
   # git-cleanup lane grant (docs/archive/parallel-fix-loop.md §4.10) — one-shot, delete after merge.
   target_branch=<TARGET>
   target_sha=<TARGET_SHA>
   target_tree=<TARGET_TREE>
   ```
   The gate judges against these pins; they are recorded BEFORE the agent exists and the file is agent-unwritable (pinned-BASE philosophy). The bash-policy lane (`cleanup_lane()`) derives the lane worktree name from `target_branch` — grant and lane cannot drift apart.
3. **Backup ref**: `git branch backup/pre-cleanup-<ID> <TARGET>` — the undo button. The agent cannot destroy it (`reflog`/`gc`/forced branch ops are tier-1 denied even in-lane).
4. **Lane worktree**: `git worktree add <abs-repo-root>/.claude/worktrees/<ID>-squashed -b cleanup/<ID>-squashed <TARGET>`. **Run this with the sandbox disabled** — the checkout materializes `.claude/` copies inside the worktree and sandboxed bash gets "Operation not permitted" on them (verified 2026-07-06). This is the one expected sandbox override in the flow; it needs an attended session.

## Dispatch

Launch the `git-cleaner` subagent (foreground, so any unexpected prompt surfaces instead of silently stalling a background run). The dispatch message must contain: the absolute lane worktree path, TARGET, TARGET_SHA, TARGET_TREE, BEFORE_COUNT, and the grouping guidance from "$ARGUMENTS". The agent definition (`.claude/agents/git-cleaner.md`) carries the operating contract; two facts the dispatch must reinforce because they were learned live:

- **cwd does not persist for subagents** (re-pinned to repo root on every Bash call), so every git command must be the verbatim form `git -C <abs-repo-root>/.claude/worktrees/<ID>-squashed <subcommand> ...` — `cleanup_lane()` in bash-policy accepts exactly that path as in-lane. `cd` is unreliable; don't build the flow on it.
- **Index-only rebuild** (`git reset --soft <base>` once, then per group boundary: `git read-tree <B>` + `git commit -m "<title>"`): never `reset --hard` / `checkout -- <path>` / `read-tree -u` — they materialize historical `.claude/` copies into the worktree and die on the sandbox. The final boundary MUST be TARGET_SHA itself, which makes tree identity true by construction.
- One simple command at a time; no `;` `&` `|` `>` `<` backticks `$(` or newlines anywhere, including inside quoted commit messages.

If the agent reports STATUS: blocked, fix the cause and `SendMessage` the SAME agent (its owners marker is bound to its agent id; a fresh agent needs the marker removed first). Never improvise history surgery yourself.

## Adjudicate (trust the gate, not the report)

Run `./scripts/git-cleanup-check.sh` yourself. It verifies: branch tip tree == TARGET_TREE, TARGET still == TARGET_SHA (retroactive catch for anything that slipped the ref fence), backup ref intact. PASS prints the human apply + teardown commands. FAIL exit codes: 3 = grant/plumbing problem (incl. a target branch that doesn't exist), 4 = shared-state breach (target moved or backup gone — investigate before ANYTHING else), 5 = tree drift (not mergeable — send the agent back or abandon the branch; TARGET is untouched either way).

On PASS, show the user `git log --oneline cleanup/<ID>-squashed` (the squash map is the deliverable they review) plus the agent's old→new mapping, then the ORCHESTRATOR itself applies the ref move and force-push:

```
git checkout <TARGET>
git reset --hard cleanup/<ID>-squashed   # pure ref move — trees identical, zero file churn
git push --force-with-lease origin <TARGET>
```

Standard flow: TARGET is `integration/<run-id>` — the force-push is a main-thread branch push (auto-allowed; sandbox carve-out gives it egress); the ref-move `git reset --hard` is a main-thread mutating-git prompt in the attended session. The tree-identity gate already ran, so nothing content-bearing can slip. Legacy `main` target: `git-cleanup-check.sh` prints an extra warning and force-pushing `main` is NOT part of the standard flow — treat it as the exceptional lane it now is.

## Teardown (after the orchestrator has applied the ref move and force-pushed)

```
rm .claude/fixloop/grants/git-cleanup .claude/fixloop/owners/<ID>-squashed
git worktree remove .claude/worktrees/<ID>-squashed
git branch -D cleanup/<ID>-squashed
git branch -D backup/pre-cleanup-<ID>    # ONLY after the human is confident; until then it is the rollback: git reset --hard backup/pre-cleanup-<ID>
```

Grants are minted per run, never left standing — a lingering grant file is the loophole this whole design exists to avoid.
