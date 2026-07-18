# Contract: target-branch parameterization (chain-1 → chains 2–4)

## Environment seam
- `FIXLOOP_INTEGRATION_BRANCH` — read once by `scripts/fixloop.sh` as
  `INTEGRATION_BRANCH="${FIXLOOP_INTEGRATION_BRANCH:-main}"`. Under the staging lane each run
  sets it to `integration/<run-id>`; unset ⇒ legacy direct-to-main behavior. `base_of()` and
  `finish`'s printed merge command are the only consumers; `gatefull` operates on the current
  checkout and is branch-agnostic.

## git-cleanup grant schema (`.claude/fixloop/grants/git-cleanup`)
- New shape (one `key=value` per line, grep-parsed, never sourced):
  - `target_branch=<branch>` — the branch the cleanup rewrites (`integration/<run-id>`; `main`
    = legacy pre-existing-history mode only)
  - `target_sha=<tip SHA pinned at grant time>`
  - `target_tree=<tip tree pinned at grant time>`
- Legacy shape still accepted: `main_sha=`/`main_tree=` with no `target_branch` ⇒ treated as
  `target_branch=main` (verified live: parses, pin-checks, correct exit codes).
- A grant naming a nonexistent branch fails closed: exit 3,
  "cannot resolve refs/heads/<branch>" (verified live).

## Derived lane names (single derivation point: `id="${target_branch//\//-}"`)
- cleanup branch: `cleanup/<id>-squashed`
- backup ref: `backup/pre-cleanup-<id>` (fallback accepted for `main` target: legacy
  `backup/pre-cleanup`)
- lane worktree: `.claude/worktrees/<id>-squashed`
- owners file: `.claude/fixloop/owners/<id>-squashed`

## Exit codes (unchanged)
- 3 = grant missing/malformed/unresolvable target; 4 = target moved or backup wrong;
  5 = cleanup branch missing or tree drift; 0 = pass (prints human apply + teardown commands,
  never executes). Printed apply text force-pushes `origin <target_branch>` with
  `--force-with-lease`; a `main` target prints a legacy-mode warning.

## Invariant for downstream chains
- "main tree" wording in fixloop.sh now reads "primary working tree" — it always meant the
  repo-root checkout, not the branch named main; runbooks should use the same disambiguated
  wording.
