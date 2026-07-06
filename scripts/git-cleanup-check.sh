#!/usr/bin/env bash
# Outcome gate for the git-cleanup lane (docs/parallel-fix-loop.md §4.10).
# Verifies the RESULT of a history cleanup, never the process:
#   1. the cleanup branch's tip TREE is byte-identical to the tree pinned at grant time — no
#      content change of any kind survived the rewrite (this single check is what makes
#      reward-hacking structurally impossible for this lane)
#   2. `main` still points at the SHA pinned at grant time — the lane never moved a shared ref
#   3. the backup ref still points at pinned main — the undo button is intact
# On pass it PRINTS the human merge + teardown commands — it never executes them.
# Pins come from the grant file, which is orchestrator-written and agent-unwritable (bash-policy
# PROTECTED + protect-harness .claude/* block) — the gate's reference data cannot be forged by
# the agent it judges. Parsed with grep, never sourced.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRANT="$ROOT/.claude/fixloop/grants/git-cleanup"
BRANCH="cleanup/main-squashed"
BACKUP="backup/pre-cleanup"

fail() { echo "CLEANUP GATE FAIL: $1"; exit "$2"; }

[[ -f "$GRANT" ]] || fail "no active git-cleanup grant at $GRANT" 3
main_sha=$(grep -E '^main_sha=' "$GRANT" | head -1 | cut -d= -f2)
main_tree=$(grep -E '^main_tree=' "$GRANT" | head -1 | cut -d= -f2)
[[ -n "$main_sha" && -n "$main_tree" ]] || fail "grant file is missing main_sha/main_tree pins" 3

cur_main=$(git -C "$ROOT" rev-parse refs/heads/main 2>/dev/null) \
  || fail "cannot resolve refs/heads/main" 3
[[ "$cur_main" = "$main_sha" ]] \
  || fail "main MOVED (pinned $main_sha, now $cur_main) — shared-ref breach; investigate before anything else" 4

backup_sha=$(git -C "$ROOT" rev-parse "refs/heads/$BACKUP" 2>/dev/null) \
  || fail "backup ref $BACKUP is missing" 4
[[ "$backup_sha" = "$main_sha" ]] \
  || fail "backup ref $BACKUP does not match pinned main" 4

tip_tree=$(git -C "$ROOT" rev-parse "refs/heads/$BRANCH^{tree}" 2>/dev/null) \
  || fail "cleanup branch $BRANCH does not exist yet" 5
[[ "$tip_tree" = "$main_tree" ]] \
  || fail "tree-tip differs (branch tree $tip_tree, pinned $main_tree) — content drifted; NOT mergeable" 5

before=$(git -C "$ROOT" rev-list --count "$main_sha")
after=$(git -C "$ROOT" rev-list --count "refs/heads/$BRANCH")
echo "CLEANUP GATE PASS — tree-tip identical, main unmoved, backup intact."
echo "history: $before commits -> $after commits"
echo
echo "review the squash map:  git log --oneline $BRANCH"
echo
echo "merge (human — a pure ref move, zero file churn, since the trees are identical):"
echo "  git checkout main && git reset --hard $BRANCH"
echo "  git push --force-with-lease origin main"
echo "teardown:"
echo "  rm .claude/fixloop/grants/git-cleanup .claude/fixloop/owners/main-squashed"
echo "  git worktree remove .claude/worktrees/main-squashed"
echo "  git branch -D $BRANCH"
echo "  git branch -D $BACKUP   # only after you're confident in the new history"
exit 0
