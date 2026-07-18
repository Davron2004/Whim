#!/usr/bin/env bash
# Outcome gate for the git-cleanup lane (docs/archive/parallel-fix-loop.md §4.10; branch-parameterized
# by openspec: staging-branch-integration).
# Verifies the RESULT of a history cleanup, never the process:
#   1. the cleanup branch's tip TREE is byte-identical to the tree pinned at grant time — no
#      content change of any kind survived the rewrite (this single check is what makes
#      reward-hacking structurally impossible for this lane)
#   2. the TARGET branch still points at the SHA pinned at grant time — the lane never moved a
#      shared ref
#   3. the backup ref still points at the pinned target — the undo button is intact
# On pass it PRINTS the human merge + teardown commands — it never executes them.
# Pins come from the grant file, which is orchestrator-written and agent-unwritable (bash-policy
# PROTECTED + protect-harness .claude/* block) — the gate's reference data cannot be forged by
# the agent it judges. Parsed with grep, never sourced.
#
# Grant schema (one key=value per line):
#   target_branch=<branch the cleanup rewrites>   e.g. integration/<run-id>; `main` = legacy
#                                                 pre-existing-history mode only
#   target_sha=<pinned tip SHA of target_branch>
#   target_tree=<pinned tip tree of target_branch>
# Legacy grants using main_sha=/main_tree= (no target_branch) are accepted as target_branch=main.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRANT="$ROOT/.claude/fixloop/grants/git-cleanup"

fail() { echo "CLEANUP GATE FAIL: $1"; exit "$2"; }

[[ -f "$GRANT" ]] || fail "no active git-cleanup grant at $GRANT" 3
target_branch=$(grep -E '^target_branch=' "$GRANT" | head -1 | cut -d= -f2)
target_sha=$(grep -E '^target_sha=' "$GRANT" | head -1 | cut -d= -f2)
target_tree=$(grep -E '^target_tree=' "$GRANT" | head -1 | cut -d= -f2)
if [[ -z "$target_branch" ]]; then
  # Legacy grant shape: main_sha/main_tree pins, target implicitly main.
  target_branch="main"
  [[ -z "$target_sha" ]] && target_sha=$(grep -E '^main_sha=' "$GRANT" | head -1 | cut -d= -f2)
  [[ -z "$target_tree" ]] && target_tree=$(grep -E '^main_tree=' "$GRANT" | head -1 | cut -d= -f2)
fi
[[ -n "$target_sha" && -n "$target_tree" ]] \
  || fail "grant file is missing target_sha/target_tree (or legacy main_sha/main_tree) pins" 3

# Lane names derive from the target so concurrent-lane collisions are impossible by construction.
id="${target_branch//\//-}"
BRANCH="cleanup/${id}-squashed"
BACKUP="backup/pre-cleanup-${id}"
WORKTREE=".claude/worktrees/${id}-squashed"

cur_target=$(git -C "$ROOT" rev-parse "refs/heads/$target_branch" 2>/dev/null) \
  || fail "cannot resolve refs/heads/$target_branch — grant names a branch that does not exist" 3
[[ "$cur_target" = "$target_sha" ]] \
  || fail "$target_branch MOVED (pinned $target_sha, now $cur_target) — shared-ref breach; investigate before anything else" 4

backup_sha=$(git -C "$ROOT" rev-parse "refs/heads/$BACKUP" 2>/dev/null)
if [[ -z "${backup_sha:-}" && "$target_branch" = "main" ]]; then
  # Legacy backup ref name from the pre-parameterized lane.
  BACKUP="backup/pre-cleanup"
  backup_sha=$(git -C "$ROOT" rev-parse "refs/heads/$BACKUP" 2>/dev/null)
fi
[[ -n "${backup_sha:-}" ]] || fail "backup ref $BACKUP is missing" 4
[[ "$backup_sha" = "$target_sha" ]] \
  || fail "backup ref $BACKUP does not match the pinned target" 4

tip_tree=$(git -C "$ROOT" rev-parse "refs/heads/$BRANCH^{tree}" 2>/dev/null) \
  || fail "cleanup branch $BRANCH does not exist yet" 5
[[ "$tip_tree" = "$target_tree" ]] \
  || fail "tree-tip differs (branch tree $tip_tree, pinned $target_tree) — content drifted; NOT mergeable" 5

before=$(git -C "$ROOT" rev-list --count "$target_sha")
after=$(git -C "$ROOT" rev-list --count "refs/heads/$BRANCH")
echo "CLEANUP GATE PASS — tree-tip identical, $target_branch unmoved, backup intact."
echo "history: $before commits -> $after commits"
echo
echo "review the squash map:  git log --oneline $BRANCH"
echo
echo "apply (human — a pure ref move, zero file churn, since the trees are identical):"
echo "  git checkout $target_branch && git reset --hard $BRANCH"
echo "  git push --force-with-lease origin $target_branch"
if [[ "$target_branch" = "main" ]]; then
  echo "  # NOTE: main-targeted cleanup is the LEGACY mode (pre-existing history only);"
  echo "  # the standard flow targets the run's integration/<run-id> branch pre-merge."
fi
echo "teardown:"
echo "  rm .claude/fixloop/grants/git-cleanup .claude/fixloop/owners/${id}-squashed"
echo "  git worktree remove $WORKTREE"
echo "  git branch -D $BRANCH"
echo "  git branch -D $BACKUP   # only after you're confident in the new history"
exit 0
