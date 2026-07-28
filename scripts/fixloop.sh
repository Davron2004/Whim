#!/usr/bin/env bash
# fixloop.sh — deterministic toolkit for the parallel fix loop (docs/harness.md; history in
# docs/archive/parallel-fix-loop.md §5).
# The ORCHESTRATOR (main thread) runs these so the security-critical mechanics are exact and not
# reconstructed inline by the LLM each time. It deliberately does NOT execute the merge to the
# integration branch (that stays an explicit, human-gated orchestrator command) — `finish` only prints it.
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
#   stale     <evidence-file>                       exit 0 evidence present at HEAD (finding live) | 7 missing
#                                                    (likely ALREADY FIXED — do not dispatch). Format:
#                                                    "## <repo-relative-path>" headers, then verbatim source lines.
#   gatefull  <branch>                             run gate-full from the branch's committed tip in the PRIMARY working tree (passthrough exit)
#   checkverdict <tool-rc> <output-file>           classify a `gh pr checks` result for closure's poll.
#                                                    exit 0 SETTLED PASS (every check reported an explicit
#                                                    pass) | 8 PENDING (something has not reported — INCLUDING
#                                                    "no checks reported", an empty result, or an unrecognised
#                                                    state) | 9 SETTLED FAIL | 2 usage error. Absence is never
#                                                    success; see the arm's comment for the defect it removes.
#   park      <branch> <reason...>                 rename fix/<id> -> wip/<id>, write a reason note
#   finish    <branch> [allowlist-file]            re-run integrity (0/6 print the human-gated merge; 6 flags
#                                                    a Class-1 change to ratify; 3/4 abort), then merge cleanup
#   status                                         list fix/* and wip/* branches + worktrees
#
# Protected files split by blast radius: Class 2 (control plane — TAMPER, never grantable) vs Class 1
# (config the agent owns — grantable per-task via .claude/fixloop/grants/<id>). See §4.9 + CLASS1/CLASS2.
#
# BASE for a branch is recovered as `git merge-base <branch> $INTEGRATION_BRANCH` — the point it was
# cut from, immune to the branch advancing. Every integrity question is "diff vs BASE", never "vs HEAD".
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"

# The trusted single-writer branch fixes/chains merge into. Under the staging lane
# (openspec: staging-branch-integration) each run sets FIXLOOP_INTEGRATION_BRANCH to its
# integration/<run-id> branch, cut from main at run start; the default `main` covers legacy
# direct runs. (dev/v1 served through 2026-07, fully merged into main at 559defe.)
INTEGRATION_BRANCH="${FIXLOOP_INTEGRATION_BRANCH:-main}"

# Protected paths split by BLAST RADIUS (docs/parallel-fix-loop.md §4.9):
#   Class 2 — the integrity & control plane (the thing doing the verifying). Touching it is TAMPER,
#            never sanctioned — an agent that authored its own gate/hooks/invariants makes every other
#            green check lie. build/ counts: build.mjs is executed by `npm run build` inside the gate.
#   Class 1 — project config the agent owns (the thing being verified). A bad edit is bounded (the gate
#            catches a broken build; the reviewer catches a wrong value). GRANTABLE per-task: a Class-1
#            change that is ⊆ the declared allowlist is SANCTIONED (needs human ratification), not tamper.
CLASS2=(
  scripts/gate.sh scripts/gate-full.sh scripts/fixloop.sh scripts/git-cleanup-check.sh scripts/sync-codex.mjs
  .claude/hooks .claude/settings.json .claude/agents .claude/commands .claude/fixloop/grants
  .codex   # Codex mirror — its hooks are SYMLINKS to .claude/hooks, so an edit via this path IS a control-plane edit
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

# base_of <branch> — print the merge-base with $INTEGRATION_BRANCH, or print nothing and return 1.
# It deliberately does NOT `die`: every call site invokes it inside a command substitution, and
# `exit` in a subshell CANNOT terminate the parent. It used to die here, which meant an unrelated
# branch produced an EMPTY base and the run carried on to report a confident verdict against no
# baseline at all ("FULL GATE PASSED ... (base )"). The status must be checked by the caller —
# `base="$(base_of "$b")" || die ...` works, because the exit status of an assignment from a
# command substitution IS the substitution's status.
base_of() { git merge-base "$1" "$INTEGRATION_BRANCH" 2>/dev/null; }
no_baseline() { echo "baseline could not be established: '$1' has no merge-base with $INTEGRATION_BRANCH (is it a branch cut from $INTEGRATION_BRANCH? is FIXLOOP_INTEGRATION_BRANCH set for this run?)"; }

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
    base="$(base_of "$branch")" || die "$(no_baseline "$branch")"
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
    base="$(base_of "$branch")" || die "$(no_baseline "$branch")"
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

    # PRECONDITIONS. This command mutates the primary working tree and then pronounces a verdict on
    # a branch, so both "am I in the right tree" and "do I have the right baseline" must be true
    # BEFORE anything else happens. Each was previously assumed; each produced a confident wrong
    # answer when the assumption did not hold (openspec: harden-gate-preconditions).

    # 1. Primary working tree. A linked worktree has no node_modules (gitignored) and Metro
    #    (guard:metro) does not walk up to the repo-root copy the way Node does — so a run from a
    #    worktree either fails deep inside the gate as an unrelated dependency-resolution error, or
    #    (measured) sails through and reports a pass for a tree the gate could not fully verify.
    gitdir="$(cd "$(git rev-parse --git-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
    commondir="$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
    [ -n "$gitdir" ] && [ -n "$commondir" ] || die "not inside a git repository"
    [ "$gitdir" = "$commondir" ] || \
      die "refusing: this is not the primary working tree (running in a linked worktree at $ROOT). 'gatefull' must run in the repo-root checkout — it is the only one with node_modules, which Metro cannot resolve from anywhere else."

    # 2. Baseline. GATE_BASE pins the gate's tamper tripwire, so a wrong or empty baseline yields a
    #    verdict about the wrong change. base_of returns non-zero rather than dying (it runs in a
    #    command substitution, where exit cannot reach us) — the status MUST be checked here.
    base="$(base_of "$branch")" || die "$(no_baseline "$branch")"
    [ -n "$base" ] || die "$(no_baseline "$branch")"

    # Run the FULL gate from the branch's COMMITTED tip, checked out into the PRIMARY working tree
    # (the repo-root checkout — "primary" is about the tree, not the branch named main; under the
    # staging lane the checked-out branch is integration/<run-id>) — NOT a linked worktree. Why not
    # a worktree: a fresh worktree has no node_modules (gitignored) and Metro (guard:metro) does NOT
    # walk up to the repo-root copy the way Node does, so it cannot resolve the RN dependency graph
    # there (Unable to resolve @babel/runtime/...). The primary tree has the real node_modules. We
    # check out the branch's committed OBJECTS here (detached, NOT the fixer's worktree directory),
    # so untracked/gitignored poison in the fixer's worktree never reaches the gate — the §4.7
    # "verified == tested" property holds. (Residual Threat-C: shared node_modules tampering — the
    # OS sandbox's job, and this whole command runs unsandboxed anyway for Chromium + checkout.)
    # SAFETY: refuse on a dirty primary tree; record the starting ref; ALWAYS restore it (trap).
    if ! { git diff --quiet && git diff --cached --quiet; }; then
      die "primary working tree is dirty — commit or stash before 'gatefull' (it checks the branch out here)"
    fi
    start_ref="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"

    # ONE verified restore, used by BOTH the normal path and the EXIT trap. The trap is armed for
    # the whole arm and fires on every early `die` — including the INCOMPLETE CHECKOUT path added
    # here, which is precisely when the restore is MOST likely to be impeded too (the same write
    # barrier that broke the checkout can break the restore). A silent >/dev/null fallback there
    # would reintroduce the exact defect this command now exists to prevent.
    # Judged by tree content and HEAD, never by git's exit status: git was observed reporting
    # failure over a tree that had in fact fully restored.
    restore_primary_tree() {
      local diffs now
      git checkout --quiet --force "$start_ref" >&2
      diffs="$(git diff --name-only "$start_ref" 2>/dev/null)"
      now="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
      if [ -z "$diffs" ] && [ "$now" = "$start_ref" ]; then return 0; fi
      echo "FAILED TO RESTORE the primary working tree to $start_ref — fix by hand before continuing" >&2
      [ -n "$diffs" ] && { echo "paths still differing from $start_ref:" >&2; printf '%s\n' "$diffs" | sed 's/^/  /' >&2; }
      [ "$now" != "$start_ref" ] && echo "HEAD is at '$now', expected '$start_ref'" >&2
      return 1
    }
    trap 'restore_primary_tree' EXIT
    # --detach checks out the branch's COMMIT (allowed even while the branch ref is checked out in the
    # fixer's worktree); gate.sh builds first (regenerates the gitignored generated/*); GATE_BASE pins
    # the gate's own tamper tripwire to the recorded BASE.
    # The checkout's stderr is NOT discarded. It is the one signal that diagnoses a partial
    # checkout, and sending it to /dev/null is what made the original failure take hours to name.
    # Its stdout goes to stderr so this command's stdout stays just the verdict line.
    git checkout --quiet --detach "$branch" >&2 || die "checkout of $branch into the primary working tree failed (git diagnostics above)"

    # POSTCONDITION — the checkout actually landed. `git checkout` reports success per-invocation,
    # not per-file: when it cannot write a tracked path it prints "error: unable to unlink old
    # '<path>'", updates everything it CAN, and STILL EXITS 0. The resulting tree is a mixture of
    # two commits. Handed on, gate.sh diffs it against GATE_BASE and — correctly, for the tree it
    # was given — reports a verification-config mismatch, i.e. accuses the change of tampering with
    # the control plane. The operator then has to disprove a security finding to discover a failed
    # checkout. Detect it here, where the context to name the real cause exists (design D1).
    # Tracked content only: gitignored build output (src/runtime/generated/*) and untracked files
    # are correctly excluded, since the question is what the CHECKOUT wrote.
    stranded="$(git diff --name-only "$branch" 2>/dev/null)"
    if [ -n "$stranded" ]; then
      echo "INCOMPLETE CHECKOUT of $branch into the primary working tree — these tracked paths did NOT update:" >&2
      printf '%s\n' "$stranded" | sed 's/^/  /' >&2
      echo "The working tree is a mixture of commits, so it is NOT what the gate would be verifying." >&2
      echo "This is NOT tamper. Usual cause: the checkout could not write those paths — under the OS" >&2
      echo "sandbox, writes below .claude/** are denied architecturally (see git's own errors above)." >&2
      echo "Re-run with the sandbox disabled, or in the devcontainer." >&2
      die "refusing to gate a partially-applied tree"
    fi

    GATE_BASE="$base" ./scripts/gate-full.sh >&2
    rc=$?

    # The restore is verified (content + HEAD), and its diagnostics reach the operator. On failure
    # restore_primary_tree has already said what is wrong, so exit rather than re-report.
    restore_primary_tree || exit 2
    trap - EXIT

    if [ "$rc" -eq 0 ]; then
      echo "FULL GATE PASSED — primary-tree checkout of $branch (base $base); restored to $start_ref"
    else
      echo "FULL GATE FAILED (exit $rc) — primary-tree checkout of $branch (base $base); restored to $start_ref"
    fi
    exit "$rc"
    ;;

  stale)
    # Deterministic staleness tripwire (mechanizes the PLAN reconcile — findings lists go stale).
    # The planner quotes the buggy lines verbatim in the DONE spec's EVIDENCE block; this checks each
    # quoted line still exists at HEAD (trimmed fixed-string match). All present → finding live (0).
    # Any missing (or the file gone) → likely already fixed → exit 7: record stale-skip, do NOT dispatch.
    evfile="${1:?usage: stale <evidence-file>   (lines: '## <repo-relative-path>' then verbatim source lines)}"
    [ -f "$evfile" ] || die "evidence file not found: $evfile"
    file=""; missing=""; checked=0
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '## '*) file="${line#\#\# }"; continue;;
      esac
      t="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      [ -z "$t" ] && continue
      [ -n "$file" ] || die "evidence line before any '## <path>' header in $evfile"
      checked=$((checked+1))
      if ! git show "HEAD:$file" 2>/dev/null | grep -qF -- "$t"; then
        missing+="$file: $t"$'\n'
      fi
    done < "$evfile"
    [ "$checked" -gt 0 ] || die "no evidence lines in $evfile"
    if [ -n "$missing" ]; then
      echo "EVIDENCE MISSING at HEAD — likely ALREADY FIXED (or moved); re-verify, do NOT dispatch:"
      printf '%s' "$missing" | sed 's/^/  /'
      exit 7
    fi
    echo "EVIDENCE PRESENT at HEAD ($checked lines) — finding still live"
    exit 0
    ;;

  checkverdict)
    # Classify a `gh pr checks` result for closure's poll (apply.md step 12c).
    #
    # The poll used to stop when nothing reported *pending*. In the window between a push and CI
    # registering, `gh pr checks` prints "no checks reported on the '<branch>' branch" and exits 0 —
    # so that window satisfied "nothing is pending" and read as a PASS, and the PR could be flipped
    # ready before a single check had run (openspec: harden-closure-lane, finding F1).
    #
    # This asserts the POSITIVE condition instead: settle only when at least one check exists AND
    # every one carries an explicit terminal verdict. Absence, emptiness, and any state token this
    # predicate does not recognise are all PENDING — never success. That last one is the part that
    # keeps the classifier from rotting: a new `gh` verdict string cannot silently become a green.
    #
    # <tool-rc> is reported for diagnosis but deliberately NOT trusted on its own — `gh pr checks`
    # exits 0 both when everything passed and when nothing exists, which is the whole defect. The
    # classification comes from the output.
    #
    #   usage: checkverdict <tool-rc> <output-file>
    #   exit 0 SETTLED PASS | 8 PENDING (keep waiting) | 9 SETTLED FAIL | 2 usage error
    toolrc="${1:?usage: checkverdict <tool-rc> <output-file>}"
    outfile="${2:?usage: checkverdict <tool-rc> <output-file>}"
    [ -r "$outfile" ] || die "checkverdict: cannot read check output '$outfile'"

    total=0; failing=0; waiting=0; unknown=""
    # `|| [ -n "$cname" ]` so a final line without a trailing newline is still classified.
    while IFS=$'\t' read -r cname cstate _rest || [ -n "${cname:-}" ]; do
      [ -n "${cname:-}" ] || continue
      # Prose lines ("no checks reported on the 'x' branch") carry no tab-separated state field.
      [ -n "${cstate:-}" ] || { cname=""; continue; }
      total=$((total + 1))
      case "$(printf '%s' "$cstate" | tr '[:upper:]' '[:lower:]')" in
        pass|success|skipping|skipped|neutral) : ;;
        fail|failure|error|cancelled|canceled|timed_out|action_required|startup_failure)
          failing=$((failing + 1)) ;;
        pending|queued|in_progress|expected|waiting|requested)
          waiting=$((waiting + 1)) ;;
        *) unknown="${unknown:+$unknown, }$cname=$cstate" ;;
      esac
      cname=""
    done < "$outfile"

    if [ "$total" -eq 0 ]; then
      echo "PENDING — no check has reported a verdict yet (tool rc=$toolrc). An absent verdict is not a passing one."
      exit 8
    fi
    # A definite failure outranks an uninterpretable state: it is already actionable, and reporting
    # it cannot produce a false green either way.
    if [ "$failing" -gt 0 ]; then
      echo "SETTLED FAIL — $failing of $total check(s) failed (tool rc=$toolrc)."
      exit 9
    fi
    if [ -n "$unknown" ]; then
      echo "PENDING — unrecognised check state(s): $unknown. A state this predicate cannot interpret is never counted as success."
      exit 8
    fi
    if [ "$waiting" -gt 0 ]; then
      echo "PENDING — $waiting of $total check(s) have not reported a verdict yet (tool rc=$toolrc)."
      exit 8
    fi
    echo "SETTLED PASS — all $total check(s) reported an explicit passing verdict (tool rc=$toolrc)."
    exit 0
    ;;

  park)
    branch="${1:?usage: park <branch> <reason...>}"; shift; reason="${*:-no reason given}"
    case "$branch" in fix/*|chain/*) : ;; *) die "park expects a fix/* or chain/* branch, got '$branch'";; esac
    id="${branch#*/}"
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
      0|6) : ;;
      *) exit "$rc" ;;   # 3 tamper / 4 scope / 2 error — no merge command
    esac
    # Resolved ONCE, status-checked, then reused. It used to be called a second time unguarded,
    # inline inside the ratify string — the same unchecked-`base_of` shape this change exists to
    # remove, and it would have interpolated an empty baseline into the command a human is told to
    # run to ratify a protected-config change.
    base="$(base_of "$branch")" || die "$(no_baseline "$branch")"
    ratify=""
    [ "$rc" = 6 ] && ratify="⚠  SANCTIONED Class-1 config change present (listed above) — RATIFY it before merging: git diff $base..$branch"
    echo
    [ -n "$ratify" ] && { echo "$ratify"; echo; }
    echo "INTEGRITY OK — ready to merge (human-gated, run explicitly):"
    echo "  git switch $INTEGRATION_BRANCH && git merge --no-ff $branch -m \"fix: ${branch#fix/}\""
    echo "after merge, REGATE the merged tip BEFORE the next merge (catches two individually-green"
    echo "fixes that break each other — a semantic conflict surfaces at the merge that caused it):"
    echo "  ./scripts/gate.sh   # on FAIL: git revert --no-edit -m 1 HEAD, then park the branch"
    echo "then clean up:"
    echo "  git worktree remove --force .claude/worktrees/${branch#fix/}  # if a named worktree exists"
    echo "  git branch -d $branch"
    echo "  rm -f .claude/fixloop/owners/${branch#fix/}  # release the agent<->worktree binding (also required before re-dispatching a parked worktree to a NEW agent)"
    exit 0
    ;;

  status)
    echo "=== fix/chain/wip branches ==="
    git branch --list 'fix/*' 'chain/*' 'wip/*' | sed 's/^/  /' || true
    echo "=== worktrees ==="
    git worktree list | sed 's/^/  /'
    echo "=== parked notes ==="
    ls -1 "$ROOT/.claude/fixloop/" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
    exit 0
    ;;

  *)
    die "unknown subcommand '$cmd' — one of: integrity redcheck stale gatefull checkverdict park finish status"
    ;;
esac
