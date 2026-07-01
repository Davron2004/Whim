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
#   integrity <branch> [allowlist-file]            exit 0 clean | 6 sanctioned Class-1 (⊆ allowlist, needs
#                                                    ratification) | 3 tamper (Class-2, or ungranted Class-1)
#                                                    | 4 scope-violation (non-protected file outside allowlist)
#   redcheck  <branch> <test-cmd...> -- <prod>...  exit 0 RED (good) | 5 GREEN (vacuous) | 2 error
#   gatefull  <branch>                             run gate-full from the branch's committed tip in the MAIN tree (passthrough exit)
#   park      <branch> <reason...>                 rename fix/<id> -> wip/<id>, write a reason note
#   finish    <branch> [allowlist-file]            re-run integrity (0/6 print the human-gated merge; 6 flags
#                                                    a Class-1 change to ratify; 3/4 abort), then merge cleanup
#   status                                         list fix/* and wip/* branches + worktrees
#
# Protected files split by blast radius: Class 2 (control plane — TAMPER, never grantable) vs Class 1
# (config the agent owns — grantable per-task via .claude/fixloop/grants/<id>). See §4.9 + CLASS1/CLASS2.
#
# BASE for a branch is recovered as `git merge-base <branch> dev/v1` — the point it was cut from,
# immune to dev/v1 advancing. Every integrity question is "diff vs BASE", never "vs HEAD".
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

# Protected paths split by BLAST RADIUS (docs/parallel-fix-loop.md §4.9):
#   Class 2 — the integrity & control plane (the thing doing the verifying). Touching it is TAMPER,
#            never sanctioned — an agent that authored its own gate/hooks/invariants makes every other
#            green check lie. build/ counts: build.mjs is executed by `npm run build` inside the gate.
#   Class 1 — project config the agent owns (the thing being verified). A bad edit is bounded (the gate
#            catches a broken build; the reviewer catches a wrong value). GRANTABLE per-task: a Class-1
#            change that is ⊆ the declared allowlist is SANCTIONED (needs human ratification), not tamper.
CLASS2=(
  scripts/gate.sh scripts/gate-full.sh scripts/fixloop.sh
  .claude/hooks .claude/settings.json .claude/agents .claude/commands .claude/fixloop/grants
  invariants
  build   # the build harness (build.mjs/assemble.mjs) is executed by `npm run build` — tampering here runs arbitrary code in the gate
)
CLASS1=(
  package.json package-lock.json 'tsconfig*.json'
  'eslint.config.*' '.eslintrc*' .eslintignore knip.json 'knip.config.*'
  babel.config.js metro.config.js
)
PROTECTED=( "${CLASS2[@]}" "${CLASS1[@]}" )   # union — the full never-silently-touch set

die() { echo "fixloop: $*" >&2; exit 2; }
base_of() { git merge-base "$1" dev/v1 2>/dev/null || die "no merge-base for '$1' vs dev/v1 (is it a fix branch cut from dev/v1?)"; }

# in_allowlist <file> <allowfile>: 0 iff <file> matches a glob line (mirrors the grant/allowlist parser).
in_allowlist() {
  local f="$1" af="$2" pat
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    case "$pat" in \#*) continue;; esac
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0;; esac
  done < "$af"
  return 1
}

cmd="${1:-}"; shift 2>/dev/null || true
case "$cmd" in

  integrity)
    branch="${1:?usage: integrity <branch> [allowlist-file]}"; allowfile="${2:-}"
    base="$(base_of "$branch")"
    [ -n "$allowfile" ] && { [ -f "$allowfile" ] || die "allowlist file not found: $allowfile"; }

    # Class 2 — the control plane. Any touch is TAMPER: never sanctioned, never grantable, even if it
    # appears in the allowlist. This is the hard floor the whole grant model rests on.
    c2="$(git diff --name-only "$base..$branch" -- "${CLASS2[@]}" 2>/dev/null || true)"
    if [ -n "$c2" ]; then
      echo "CLASS-2 CONTROL PLANE TOUCHED — TAMPER (escalate to human; never auto-sanctioned):"
      echo "$c2" | sed 's/^/  /'
      exit 3
    fi

    changed="$(git diff --name-only "$base..$branch")"
    echo "CHANGED vs BASE ($base):"
    [ -n "$changed" ] && echo "$changed" | sed 's/^/  /' || echo "  (none)"

    # Class 1 — grantable config. SANCTIONED iff every touched Class-1 file is covered by the declared
    # allowlist (= the plan's declared protected scope / the grant); otherwise TAMPER (ungranted touch).
    c1="$(git diff --name-only "$base..$branch" -- "${CLASS1[@]}" 2>/dev/null || true)"
    sanctioned=0
    if [ -n "$c1" ]; then
      if [ -z "$allowfile" ]; then
        echo "CLASS-1 CONFIG TOUCHED but NO allowlist declared — TAMPER (ungranted protected change):"
        echo "$c1" | sed 's/^/  /'
        exit 3
      fi
      ungranted=""
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        in_allowlist "$f" "$allowfile" || ungranted+="$f"$'\n'
      done <<< "$c1"
      if [ -n "$ungranted" ]; then
        echo "CLASS-1 CONFIG TOUCHED but NOT in the declared allowlist — TAMPER:"
        printf '%s' "$ungranted" | sed 's/^/  /'
        exit 3
      fi
      echo "CLASS-1 CONFIG CHANGED — SANCTIONED (⊆ declared allowlist); NEEDS HUMAN RATIFICATION:"
      echo "$c1" | sed 's/^/  /'
      sanctioned=1
    fi

    # General scope — every changed file (protected or not) must be in the allowlist when one is given.
    if [ -n "$allowfile" ]; then
      viol=""
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        in_allowlist "$f" "$allowfile" || viol+="$f"$'\n'
      done <<< "$changed"
      if [ -n "$viol" ]; then
        echo "OUTSIDE ALLOWLIST (scope violation):"
        printf '%s' "$viol" | sed 's/^/  /'
        exit 4
      fi
    fi

    if [ "$sanctioned" = 1 ]; then
      echo "INTEGRITY OK — but a SANCTIONED Class-1 change is present; human ratifies it at merge."
      exit 6
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
    # Run the FULL gate from the branch's COMMITTED tip, checked out into the MAIN tree — NOT a
    # worktree. Why not a worktree: a fresh worktree has no node_modules (gitignored) and Metro
    # (guard:metro) does NOT walk up to the repo-root copy the way Node does, so it cannot resolve the
    # RN dependency graph there (Unable to resolve @babel/runtime/...). The main tree has the real
    # node_modules. We check out the branch's committed OBJECTS here (detached, NOT the fixer's worktree
    # directory), so untracked/gitignored poison in the fixer's worktree never reaches the gate — the
    # §4.7 "verified == tested" property holds. (Residual Threat-C: shared node_modules tampering — the
    # OS sandbox's job, and this whole command runs unsandboxed anyway for Chromium + checkout.)
    # SAFETY: refuse on a dirty main tree; record the starting ref; ALWAYS restore it (trap).
    if ! { git diff --quiet && git diff --cached --quiet; }; then
      die "main tree is dirty — commit or stash before 'gatefull' (it checks the branch out in the main tree)"
    fi
    start_ref="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
    # shellcheck disable=SC2064
    trap "git checkout --quiet --force '$start_ref' >/dev/null 2>&1" EXIT
    # --detach checks out the branch's COMMIT (allowed even while the branch ref is checked out in the
    # fixer's worktree); gate.sh builds first (regenerates the gitignored generated/*); GATE_BASE pins
    # the gate's own tamper tripwire to the recorded BASE.
    git checkout --quiet --detach "$branch" >/dev/null 2>&1 || die "checkout of $branch into the main tree failed"
    GATE_BASE="$base" ./scripts/gate-full.sh >&2
    rc=$?
    git checkout --quiet --force "$start_ref" >/dev/null 2>&1 || die "FAILED TO RESTORE main tree to $start_ref — fix by hand before continuing"
    trap - EXIT
    if [ "$rc" -eq 0 ]; then
      echo "FULL GATE PASSED — main-tree checkout of $branch (base $base); restored to $start_ref"
    else
      echo "FULL GATE FAILED (exit $rc) — main-tree checkout of $branch (base $base); restored to $start_ref"
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
    "$ROOT/scripts/fixloop.sh" integrity "$branch" "$allowfile"; rc=$?
    case "$rc" in
      0) ratify="" ;;
      6) ratify="⚠  SANCTIONED Class-1 config change present (listed above) — RATIFY it before merging: git diff $(base_of "$branch")..$branch" ;;
      *) exit "$rc" ;;   # 3 tamper / 4 scope / 2 error — no merge command
    esac
    base="$(base_of "$branch")"
    echo
    [ -n "$ratify" ] && { echo "$ratify"; echo; }
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
