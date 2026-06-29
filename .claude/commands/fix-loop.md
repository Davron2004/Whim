Run the parallel fix loop over the findings in "$ARGUMENTS" (a path to a findings list, or an inline list). You are the ORCHESTRATOR (main thread): you plan, dispatch, run the deterministic checks via `scripts/fixloop.sh`, adjudicate, and merge. You NEVER write fix code yourself, and you NEVER self-approve a protected-file change. Full design: docs/parallel-fix-loop.md.

Preconditions (check once, STOP and tell the user if any fail):
- `.claude/settings.json` has `worktree.baseRef: "head"` (without it, fixer worktrees branch from a stale base).
- `scripts/gate.sh`, `scripts/gate-full.sh`, `scripts/fixloop.sh` exist and are committed clean (else the pinned-BASE tripwire refuses to run).

You MAY run several findings in parallel — launch the fixers async and process each as its notification arrives — but step 8 (MERGE) is strictly serialized: one writer to dev/v1 at a time.

Per finding:

1. PLAN (read-only). Dispatch a read-only agent (`researcher` or `Plan`) to produce the DONE spec: the fix sketch, the **file allowlist** (glob patterns, one per line — save to a temp file), the **test** it must add, the expected red-without-fix, and **severity** (low/med/high). The orchestrator never explores the code itself.

2. FIX. Launch a `fix-worker` subagent with `isolation: worktree` and the DONE spec. It comes up on a fresh worktree at dev/v1's tip (because of `baseRef: head`), builds, fixes, writes the test, self-runs `./scripts/gate.sh` until green, commits, and reports. The completion notification gives you its `worktreeBranch` and `worktreePath`.
   - STATUS blocked (B/C) → adjudicate from the spec, or `SendMessage` the worker a corrected spec, or escalate to the user. Never improvise the fix yourself.

3. RED-CHECK (deterministic, the crown jewel). From the report's TEST + PROD FILES:
   `scripts/fixloop.sh redcheck <worktreeBranch> <TEST...> -- <PROD FILES...>`
   exit 0 = RED (test fails without the fix → non-vacuous, good). exit 5 = GREEN = vacuous test → `SendMessage` the worker to write a real test (revision cap), else PARK.

4. INTEGRITY (deterministic). `scripts/fixloop.sh integrity <worktreeBranch> <allowlist-file>`
   exit 0 = clean. exit 3 = protected file touched → **ESCALATE to the user** (never self-approve). exit 4 = scope violation → re-plan with a corrected allowlist if it stays same-subsystem & non-protected (§4.6), else escalate.

5. VERIFY. Dispatch the `reviewer` on `git diff <worktreeBranch>` against its merge-base (`git merge-base <worktreeBranch> dev/v1`) + the DONE spec + the red-check result — NOT the worker's reasoning. Default-reject. Reject → `SendMessage` the worker the critique (revision cap = 2), then re-run from step 3. Cap hit → PARK.

6. FULL GATE (deterministic). Run the full gate in the worker's worktree: `( cd <worktreePath> && ./scripts/gate-full.sh )` (slower — Metro + Chromium). FAIL → SendMessage the worker (one extended attempt), else PARK.

7. APPROVE. low/med + everything green → you may merge. high severity, or any escalation from step 4 → get the user's explicit OK first.

8. MERGE (serialized — one finding at a time). `git switch dev/v1 && git merge --no-ff <worktreeBranch> -m "fix: <id>"`, then clean up: `git worktree remove --force <worktreePath>` and `git branch -d <worktreeBranch>`. (`scripts/fixloop.sh finish <worktreeBranch> <allowlist-file>` re-checks integrity and prints these commands.)

On ANY terminal wall (verifier cap, unfixable-vacuous, scope/protected you won't pursue, persistent gate fail): `scripts/fixloop.sh park <branch> "<reason>"` — NEVER delete. The branch survives as `wip/<id>` (resumable) with a reason note under `.claude/fixloop/`.

Caps (bounded autonomy, then escalate — never silent-drop): the worker self-gates in its own loop; verifier revisions ≤ 2; one extended attempt on a gate cap-hit; then PARK. Protected-file touches and high-severity merges ALWAYS go to the user.

Keep a running progress note (finding → verdict → merge/park, with reasons). At the end, give the user a summary: what merged, what parked and why, and what awaits their ratification — not the diffs.
