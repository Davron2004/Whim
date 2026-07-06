Run the parallel fix loop over the findings in "$ARGUMENTS" (a path to a findings list, or an inline list). You are the ORCHESTRATOR (main thread): you plan, dispatch, run the deterministic checks via `scripts/fixloop.sh`, adjudicate, and merge. You NEVER write fix code yourself, and you NEVER self-approve a protected-file change. Full design: docs/parallel-fix-loop.md.

Preconditions (check once, STOP and tell the user if any fail):
- `.claude/settings.json` has `worktree.baseRef: "head"` (without it, fixer worktrees branch from a stale base).
- `scripts/gate.sh`, `scripts/gate-full.sh`, `scripts/fixloop.sh` exist and are committed clean (else the pinned-BASE tripwire refuses to run).

You MAY run several findings in parallel — launch the fixers async and process each as its notification arrives — but step 8 (MERGE) is strictly serialized: one writer to dev/v1 at a time.

Per finding:

1. PLAN (read-only). Dispatch a read-only agent (`researcher` or `Plan`) to produce the DONE spec: the fix sketch, the **file allowlist** (glob patterns, one per line — save to a temp file), the **test** it must add, the expected red-without-fix, and **severity** (low/med/high). The orchestrator never explores the code itself.
   - **First, RECONCILE the finding against HEAD — findings lists go stale.** The planner must confirm the defect still exists at the current tip by reading the cited code (and, where the finding cites a fix-shaped change, `git merge-base --is-ancestor <fix-commit> dev/v1`). If it's already fixed, the planner returns `ALREADY-FIXED: <evidence>` and you SKIP steps 2–8 for that finding (record it, do not dispatch a fixer). This is cheap here — no worktree is created — so always do it before the FIX step.
   - **Classify the fix's testability and put it in the DONE spec** (the worker honors it — `.claude/agents/fix-worker.md` step 3). **Behavioral** (changes observable output / error surface / persisted state / executable control flow) → specify the red-without/green-with test (the `test` + `expected red-without` fields apply to this class only). **Structural, no behavioral delta** (rename, dead-code deletion, a dedup that can't change behavior) → specify **no test**; regression + inspection is the assurance — do NOT have the worker fabricate a source-grep. **Standing invariant** worth locking (single-source, no-`eval`) → specify a source/structural assertion that encodes the invariant, not the patch (litmus: would it read sensibly to someone who never saw the diff?); a new invariant/static-check file is owner territory, so don't ask a fixer for it. Rule of thumb: a source-string grep is legitimate ONLY as an invariant, never as a stand-in for an absent behavioral test. (Framework: docs/parallel-fix-loop.md §6.7.)

2. FIX. Launch a `fix-worker` subagent with `isolation: worktree` and the DONE spec. It comes up on a fresh worktree at dev/v1's tip (because of `baseRef: head`), builds, fixes, writes the test, self-runs `./scripts/gate.sh` until green, commits, and reports. The completion notification gives you its `worktreeBranch` and `worktreePath`.
   - STATUS blocked (B/C) → adjudicate from the spec, or `SendMessage` the worker a corrected spec, or escalate to the user. Never improvise the fix yourself.

3. RED-CHECK (deterministic, the crown jewel) — **behavioral class only.** A `structural-no-test` fix has no test to red-check: SKIP this step and let VERIFY (inspection) + the FULL GATE staying green be the assurance. An `invariant` check asserts source, not behavior, so the reviewer judges it (don't expect a clean revert-RED). For a behavioral fix, from the report's TEST + PROD FILES:
   `scripts/fixloop.sh redcheck <worktreeBranch> <TEST...> -- <PROD FILES...>`
   exit 0 = RED (test fails without the fix → non-vacuous, good). exit 5 = GREEN = vacuous test → `SendMessage` the worker to write a real test (revision cap), else PARK.
   - **New-module caveat (the RED can be a false signal).** If the fix ADDS a new file that the test imports, reverting it to BASE deletes the module, so the test fails to *build* ("Could not resolve …") rather than *assert* — a coarse RED that proves nothing about the assertions. Re-run redcheck reverting ONLY the pre-existing prod file(s) so the suite still builds and the real assertion fails cleanly. A behavioral test exercising a brand-new helper can't be revert-red-checked at all (the helper vanishes) — note it and have the VERIFY reviewer judge that test's non-vacuity by inspection.

4. INTEGRITY (deterministic). `scripts/fixloop.sh integrity <worktreeBranch> <allowlist-file>`
   exit 0 = clean. exit 3 = protected file touched → **ESCALATE to the user** (never self-approve). exit 4 = scope violation → re-plan with a corrected allowlist if it stays same-subsystem & non-protected (§4.6), else escalate.

5. VERIFY. Dispatch the `reviewer` on `git diff <worktreeBranch>` against its merge-base (`git merge-base <worktreeBranch> dev/v1`) + the DONE spec + the red-check result — NOT the worker's reasoning. Default-reject. Reject → `SendMessage` the worker the critique (revision cap = 2), then re-run from step 3. Cap hit → PARK.

6. FULL GATE (deterministic). `scripts/fixloop.sh gatefull <worktreeBranch>` (slower — Metro + Chromium). This runs `gate-full.sh` in a **fresh checkout of the committed branch tip**, NOT the worker's worktree: the worker's tree can hold untracked/gitignored files (poisoned `src/runtime/generated/*` or `build/` output) that the integrity diff can't see but the gate would execute against — so gating there could go green on code that isn't what you reviewed. The fresh checkout makes "what you verified" == "what you tested". FAIL → SendMessage the worker (one extended attempt), else PARK. (Do NOT fall back to `cd <worktreePath> && ./scripts/gate-full.sh` — that re-introduces the poisoning gap.)

7. APPROVE. low/med + everything green → you may merge. high severity, or any escalation from step 4 → get the user's explicit OK first.

8. MERGE (serialized — one finding at a time). `git switch dev/v1 && git merge --no-ff <worktreeBranch> -m "fix: <id>"`, then clean up: `git worktree remove --force <worktreePath>` and `git branch -d <worktreeBranch>`. (`scripts/fixloop.sh finish <worktreeBranch> <allowlist-file>` re-checks integrity and prints these commands.)

On ANY terminal wall (verifier cap, unfixable-vacuous, scope/protected you won't pursue, persistent gate fail): `scripts/fixloop.sh park <branch> "<reason>"` — NEVER delete. The branch survives as `wip/<id>` (resumable) with a reason note under `.claude/fixloop/`.

Caps (bounded autonomy, then escalate — never silent-drop): the worker self-gates in its own loop; verifier revisions ≤ 2; one extended attempt on a gate cap-hit; then PARK. Protected-file touches and high-severity merges ALWAYS go to the user.

MEMORY (end of run, human-gated). Subagents never write the memory store directly — collect any `MEMORY:` proposals from their reports as you go. After the batch, dedupe them and apply the worthwhile ones yourself with the Write/Edit tool (each prompts you with the full diff — approve or skip). Follow the memory rules in CLAUDE.md (one fact per file + a one-line MEMORY.md index pointer). If running unattended (no human to approve), do NOT apply — list the proposals in the summary for the user to ratify. Never let a subagent's proposal land unreviewed.

Keep a running progress note (finding → verdict → merge/park, with reasons). At the end, give the user a summary: what merged, what parked and why, the memory proposals applied/pending, and what awaits their ratification — not the diffs.
