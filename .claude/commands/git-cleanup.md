Run the git-history cleanup lane. "$ARGUMENTS" is optional grouping guidance from the human (which runs to squash, what to keep as milestones); if empty, the cleaner groups by topic on its own judgment. You are the ORCHESTRATOR (main thread): you mint the grant, pin the reference data, create the lane, dispatch the `git-cleaner` subagent, and judge the outcome with ONE mechanical check. You NEVER rewrite history yourself, and the two dangerous operations — moving `main` and force-pushing — are printed for the HUMAN, never executed. Full design + rationale: docs/parallel-fix-loop.md §4.10.

The model in one line: **freed path, gated outcome.** The cleaner may do anything to the shape of history inside its lane; the single acceptance check is that the cleanup branch's tip TREE is byte-identical to `main`'s tree pinned before dispatch — so no content change of any kind can survive, and you audit one hash equality instead of the agent's process.

Hardcoded lane constants (the hooks key on these — do not vary them):
- worktree: `.claude/worktrees/main-squashed`
- branch: `cleanup/main-squashed`
- grant: `.claude/fixloop/grants/git-cleanup`
- backup ref: `backup/pre-cleanup`
- outcome gate: `scripts/git-cleanup-check.sh`

## Preconditions (check once, STOP and tell the user if any fail)

1. **No fix-loop run is active**: `.claude/fixloop/owners/` must be empty (`ls`). History rewrite under a live pinned-BASE audit is the one forbidden interaction. A stale marker from a previous cleanup (`owners/main-squashed`) must also be removed before dispatching a NEW agent, or `owners_claim` refuses it.
2. **No leftover lane state** from a previous run: no `grants/git-cleanup`, no `.claude/worktrees/main-squashed`, no `cleanup/main-squashed` or `backup/pre-cleanup` branches. If present, a previous run wasn't torn down — show the user `scripts/git-cleanup-check.sh` output and finish THAT run first.
3. Working tree clean on `main` (`git status`), and `scripts/git-cleanup-check.sh` exists and is committed clean.

## Setup (each step routes through the human's ask prompt — that is the ratification)

1. **Pin** (read-only, no prompt): `git rev-parse main` → MAIN_SHA, `git rev-parse main^{tree}` → MAIN_TREE, `git rev-list --count main` → BEFORE_COUNT.
2. **Mint the grant** — Write (the Edit/Write tool, NEVER a shell redirect — bash writes to `grants/` are policy-denied for everyone) to `.claude/fixloop/grants/git-cleanup`:
   ```
   # git-cleanup lane grant (docs/parallel-fix-loop.md §4.10) — one-shot, delete after merge.
   main_sha=<MAIN_SHA>
   main_tree=<MAIN_TREE>
   ```
   The gate judges against these pins; they are recorded BEFORE the agent exists and the file is agent-unwritable (pinned-BASE philosophy).
3. **Backup ref**: `git branch backup/pre-cleanup main` — the undo button. The agent cannot destroy it (`reflog`/`gc`/forced branch ops are tier-1 denied even in-lane).
4. **Lane worktree**: `git worktree add <abs-repo-root>/.claude/worktrees/main-squashed -b cleanup/main-squashed main`. **Run this with the sandbox disabled** — the checkout materializes `.claude/` copies inside the worktree and sandboxed bash gets "Operation not permitted" on them (verified 2026-07-06). This is the one expected sandbox override in the flow; it needs an attended session.

## Dispatch

Launch the `git-cleaner` subagent (foreground, so any unexpected prompt surfaces instead of silently stalling a background run). The dispatch message must contain: the absolute lane worktree path, MAIN_SHA, MAIN_TREE, BEFORE_COUNT, and the grouping guidance from "$ARGUMENTS". The agent definition (`.claude/agents/git-cleaner.md`) carries the operating contract; two facts the dispatch must reinforce because they were learned live:

- **cwd does not persist for subagents** (re-pinned to repo root on every Bash call), so every git command must be the verbatim form `git -C <abs-repo-root>/.claude/worktrees/main-squashed <subcommand> ...` — `cleanup_lane()` in bash-policy accepts exactly that path as in-lane. `cd` is unreliable; don't build the flow on it.
- **Index-only rebuild** (`git reset --soft <base>` once, then per group boundary: `git read-tree <B>` + `git commit -m "<title>"`): never `reset --hard` / `checkout -- <path>` / `read-tree -u` — they materialize historical `.claude/` copies into the worktree and die on the sandbox. The final boundary MUST be MAIN_SHA itself, which makes tree identity true by construction.
- One simple command at a time; no `;` `&` `|` `>` `<` backticks `$(` or newlines anywhere, including inside quoted commit messages.

If the agent reports STATUS: blocked, fix the cause and `SendMessage` the SAME agent (its owners marker is bound to its agent id; a fresh agent needs the marker removed first). Never improvise history surgery yourself.

## Adjudicate (trust the gate, not the report)

Run `./scripts/git-cleanup-check.sh` yourself. It verifies: branch tip tree == MAIN_TREE, `main` still == MAIN_SHA (retroactive catch for anything that slipped the ref fence), backup ref intact. PASS prints the human merge + teardown commands. FAIL exit codes: 3 = grant/plumbing problem, 4 = shared-state breach (main moved or backup gone — investigate before ANYTHING else), 5 = tree drift (not mergeable — send the agent back or abandon the branch; `main` is untouched either way).

On PASS, show the user `git log --oneline cleanup/main-squashed` (the squash map is the deliverable they review) plus the agent's old→new mapping, then hand over the printed commands:

```
git checkout main && git reset --hard cleanup/main-squashed   # pure ref move — trees identical, zero file churn
git push --force-with-lease origin main
```

## Teardown (after the human has merged and pushed)

```
rm .claude/fixloop/grants/git-cleanup .claude/fixloop/owners/main-squashed
git worktree remove .claude/worktrees/main-squashed
git branch -D cleanup/main-squashed
git branch -D backup/pre-cleanup    # ONLY after the human is confident; until then it is the rollback: git reset --hard backup/pre-cleanup
```

Grants are minted per run, never left standing — a lingering grant file is the loophole this whole design exists to avoid.
