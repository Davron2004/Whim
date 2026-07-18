# Contract: scoped push policy (chain-2 → chains 3–4)

## Decision matrix (bash-policy.sh, verified by .claude/hooks/test/bash-policy.test.sh — 17 cases)

| Command shape | Main thread | Subagent |
|---|---|---|
| `git push …` naming `main`/`dev/v1` anywhere (incl. refspec `x:main`, substrings) | deny | deny |
| simple `git push …integration/…` (anchored `git push `, no chaining) | **ask** (human reviews exact refspec) | deny |
| any other `git push` form (incl. `git -c … push`, compound commands) | deny | deny |
| `git branch -f/-D/-m`, `checkout -B`, `switch -C` on `integration/*` | falls to ordinary mutating-git **ask** | deny (tier-1-style glob) |

- Fail-closed substring rule: a branch like `integration/domain-fix` is denied ("main" in
  "domain") — rename the branch, don't weaken the pattern.
- Outcome is ask, never allow: every remote write still passes a human at the prompt.

## settings.json mirror
- `permissions.deny` narrowed: `Bash(git push:*)` → `Bash(git push origin main:*)`
  (belt-and-braces prefix matcher; the hook is the authoritative layer and runs first).
- End-to-end prompt surfacing verified at the hook layer (suite `ask` case); first real
  staging-branch push next run is the final end-to-end confirmation.

## Suite
- `.claude/hooks/test/bash-policy.test.sh` — 6 new cases appended; red-check performed:
  new suite vs pre-change hook (extracted from e3d6674) fails at
  "main-thread push of integration/* asks" → behavioral case non-vacuous.

## For runbooks (chain-3)
- Run-start branch creation (`git branch integration/<run-id>` / `git switch -c`) and closure
  deletion are main-thread commands → ordinary ask prompt; no policy change needed for them.
- Pushes in runbook text should always be written as the simple anchored form
  `git push origin integration/<run-id>` (optionally `--force-with-lease` after cleanup).
