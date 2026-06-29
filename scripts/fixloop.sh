#!/usr/bin/env bash
# fixloop.sh — deterministic toolkit for the parallel fix loop (docs/parallel-fix-loop.md §5).
# The ORCHESTRATOR (main thread) runs these so the security-critical mechanics are exact and not
# reconstructed inline by the LLM each time. It deliberately does NOT execute the merge to dev/v1
# (that stays an explicit, human-gated orchestrator command) — `finish` only prints it.
#
# This file is human-edited only (protect-harness.sh + bash-policy.sh block agents). NOTE: git run
# *inside* this script does not re-trigger the PreToolUse(Bash) hook, so whoever can invoke this
# script runs its git unrestricted — keep it orchestrator-only (do not auto-allow for subagents).
#
# Subcommands:
#   integrity <branch> [allowlist-file]            exit 0 clean | 3 protected-touch | 4 scope-violation
#   redcheck  <branch> <test-cmd...> -- <prod>...  exit 0 RED (good) | 5 GREEN (vacuous) | 2 error
#   gatefull  <branch>                             run gate-full in a FRESH checkout (passthrough exit)
#   park      <branch> <reason...>                 rename fix/<id> -> wip/<id>, write a reason note
#   finish    <branch> [allowlist-file]            re-run integrity, print the merge command, remove worktree
#   status                                         list fix/* and wip/* branches + worktrees
#
# BASE for a branch is recovered as `git merge-base <branch> dev/v1` — the point it was cut from,
# immune to dev/v1 advancing. Every integrity question is "diff vs BASE", never "vs HEAD".
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

# Paths that a fix branch must NEVER touch (mirrors the gate tripwire + bash-policy PROTECTED).
PROTECTED=(
  scripts/gate.sh scripts/gate-full.sh scripts/fixloop.sh
  .claude/hooks .claude/settings.json .claude/agents .claude/commands
  package.json package-lock.json 'tsconfig*.json'
  'eslint.config.*' '.eslintrc*' .eslintignore knip.json 'knip.config.*'
  babel.config.js metro.config.js invariants
  build   # the build harness (build.mjs/assemble.mjs) is executed by `npm run build` — tampering here runs arbitrary code in the gate
)

die() { echo "fixloop: $*" >&2; exit 2; }
base_of() { git merge-base "$1" dev/v1 2>/dev/null || die "no merge-base for '$1' vs dev/v1 (is it a fix branch cut from dev/v1?)"; }

cmd="${1:-}"; shift 2>/dev/null || true
case "$cmd" in

  integrity)
    branch="${1:?usage: integrity <branch> [allowlist-file]}"; allowfile="${2:-}"
    base="$(base_of "$branch")"
    prot="$(git diff --name-only "$base..$branch" -- "${PROTECTED[@]}" 2>/dev/null || true)"
    if [ -n "$prot" ]; then
      echo "PROTECTED TOUCHED (escalate to human — orchestrator must not self-approve):"
      echo "$prot" | sed 's/^/  /'
      exit 3
    fi
    changed="$(git diff --name-only "$base..$branch")"
    echo "CHANGED vs BASE ($base):"
    [ -n "$changed" ] && echo "$changed" | sed 's/^/  /' || echo "  (none)"
    if [ -n "$allowfile" ]; then
      [ -f "$allowfile" ] || die "allowlist file not found: $allowfile"
      viol=""
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        ok=0
        while IFS= read -r pat; do
          [ -z "$pat" ] && continue
          case "$pat" in \#*) continue;; esac
          # shellcheck disable=SC2254
          case "$f" in $pat) ok=1; break;; esac
        done < "$allowfile"
        [ "$ok" = 0 ] && viol+="$f"$'\n'
      done <<< "$changed"
      if [ -n "$viol" ]; then
        echo "OUTSIDE ALLOWLIST (scope violation):"
        printf '%s' "$viol" | sed 's/^/  /'
        exit 4
      fi
    fi
    echo "INTEGRITY OK"
    exit 0
    ;;

  redcheck)
    branch="${1:?usage: redcheck <branch> <test-cmd...> -- <prod-file>...}"; shift
    testcmd=(); prod=(); sep=0
    for a in "$@"; do
      if [ "$a" = "--" ]; then sep=1; continue; fi
      if [ "$sep" -eq 0 ]; then testcmd+=("$a"); else prod+=("$a"); fi
    done
    [ "${#testcmd[@]}" -gt 0 ] || die "no test command before --"
    [ "${#prod[@]}" -gt 0 ] || die "no prod files after --"
    base="$(base_of "$branch")"
    wt="$ROOT/.claude/worktrees/redcheck-$$"
    git worktree add --detach "$wt" "$branch" >&2 2>&1 || die "worktree add failed"
    # shellcheck disable=SC2064
    trap "git worktree remove --force '$wt' >/dev/null 2>&1; git worktree prune >/dev/null 2>&1" EXIT
    for f in "${prod[@]}"; do
      if git cat-file -e "$base:$f" 2>/dev/null; then
        ( cd "$wt" && git checkout "$base" -- "$f" ) || die "revert failed: $f"
      else
        ( cd "$wt" && rm -f "$f" )   # absent in BASE (a new file) → "before the fix" = remove it
      fi
    done
    ( cd "$wt" && npm run -s build >/dev/null 2>&1 ) || true   # regenerate gitignored output for the reverted tree
    if ( cd "$wt" && "${testcmd[@]}" ) >&2; then
      echo "GREEN — test PASSED without the fix → VACUOUS test, reject"
      exit 5
    else
      echo "RED — test FAILED with the fix reverted → non-vacuous, good"
      exit 0
    fi
    ;;

  gatefull)
    branch="${1:?usage: gatefull <branch>}"
    base="$(base_of "$branch")"
    # Run the FULL gate in a FRESH checkout of the committed branch tip — NOT the fixer's worktree.
    # The fixer's tree can carry untracked / gitignored files (poisoned src/runtime/generated/* or
    # build/ output, a shadowing .npmrc, etc.) that `git diff <BASE>` cannot see but the gate WOULD
    # execute against — "test against X, ship Y". A clean checkout holds exactly the tracked content,
    # so what we verified (the diff) and what we tested (the tree) are identical. (Limit: this shares
    # the repo's node_modules — repo-root dependency tampering is Threat C, the OS sandbox's job.)
    wt="$ROOT/.claude/worktrees/gatefull-$$"
    git worktree add --detach "$wt" "$branch" >&2 2>&1 || die "worktree add failed"
    # shellcheck disable=SC2064
    trap "git worktree remove --force '$wt' >/dev/null 2>&1; git worktree prune >/dev/null 2>&1" EXIT
    # gate-full runs gate.sh first, which builds (writes the gitignored generated/*) before any check;
    # GATE_BASE pins the gate's own tamper tripwire to the recorded BASE so a tampered config can't pass.
    ( cd "$wt" && GATE_BASE="$base" ./scripts/gate-full.sh ) >&2
    rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "FULL GATE PASSED — fresh checkout of $branch (base $base)"
    else
      echo "FULL GATE FAILED (exit $rc) — fresh checkout of $branch (base $base)"
    fi
    exit "$rc"
    ;;

  park)
    branch="${1:?usage: park <branch> <reason...>}"; shift; reason="${*:-no reason given}"
    case "$branch" in fix/*) : ;; *) die "park expects a fix/* branch, got '$branch'";; esac
    id="${branch#fix/}"
    git branch -m "$branch" "wip/$id" || die "rename failed"
    mkdir -p "$ROOT/.claude/fixloop"
    note="$ROOT/.claude/fixloop/wip-$id.md"
    { echo "# PARKED: $id"; echo; echo "- branch: wip/$id"; echo "- reason: $reason"; \
      echo "- resume: git worktree add .claude/worktrees/$id wip/$id"; } > "$note"
    echo "PARKED $branch -> wip/$id"
    echo "note: $note"
    exit 0
    ;;

  finish)
    branch="${1:?usage: finish <branch> [allowlist-file]}"; allowfile="${2:-}"
    "$ROOT/scripts/fixloop.sh" integrity "$branch" "$allowfile" || exit $?
    base="$(base_of "$branch")"
    echo
    echo "INTEGRITY OK — ready to merge (human-gated, run explicitly):"
    echo "  git switch dev/v1 && git merge --no-ff $branch -m \"fix: ${branch#fix/}\""
    echo "after merge, clean up:"
    echo "  git worktree remove --force .claude/worktrees/${branch#fix/}  # if a named worktree exists"
    echo "  git branch -d $branch"
    exit 0
    ;;

  status)
    echo "=== fix/wip branches ==="
    git branch --list 'fix/*' 'wip/*' | sed 's/^/  /' || true
    echo "=== worktrees ==="
    git worktree list | sed 's/^/  /'
    echo "=== parked notes ==="
    ls -1 "$ROOT/.claude/fixloop/" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
    exit 0
    ;;

  *)
    die "unknown subcommand '$cmd' — one of: integrity redcheck gatefull park finish status"
    ;;
esac
