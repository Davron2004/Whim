#!/usr/bin/env bash
# Preflight-assertion suite for `scripts/fixloop.sh gatefull`
# (openspec: harden-gate-preconditions — capability `gate-preconditions`).
#
# WHAT THIS LOCKS, AND WHY IT ASSERTS ON MESSAGES
# `gatefull` checks a branch's committed tip out into the primary working tree and runs the full
# gate against it. Every failure this suite covers was ALREADY a non-zero exit before the change —
# the gate refused, correctly. The defect was that it refused *stating the wrong cause*: a
# half-applied checkout surfaced as a tamper accusation, and the operator had to disprove a
# security finding to discover a failed `git checkout`. So a suite that asserted only on exit
# status would pass against the buggy behaviour and lock the defect in. Every assertion here is on
# message CONTENT (design D2).
#
# HOW THE HALF-APPLIED CHECKOUT IS REPRODUCED
# Not by simulating the sandbox — the sandbox is a property of the invoking harness and is not
# reproducible from inside a test (design D4). It is reproduced by the mechanism the sandbox merely
# happens to trigger: git's own behaviour when it cannot write a tracked path. Measured:
#
#     error: unable to unlink old 'a/x.txt': Permission denied
#     checkout rc=0                      <-- the entire defect, in git itself
#
# git warns per file, updates every path it CAN write, and still exits 0. Any write barrier
# produces it; a read-only parent directory is the portable one. This is stronger than a
# hand-dirtied tree, which `gatefull` would reject at its dirty-tree guard before reaching the
# assertion under test.
#
# ROOT BYPASSES DIRECTORY PERMISSIONS, so the barrier would silently not bite. That is checked, not
# assumed — an ineffective barrier is reported as a FAILURE, never skipped. A suite that cannot
# build its fixture certifies nothing, and silently degrading to a pass is precisely the defect
# class this change exists to eliminate. Every environment the gate runs in is non-root (CI:
# ubuntu-latest as `runner`; devcontainer: `USER node`).
#
# The fixture is a throwaway repo holding a VERBATIM COPY of the real `scripts/fixloop.sh` plus a
# stub `scripts/gate-full.sh`. The copy is the real logic; the stub keeps the suite fast and lets
# the negative control prove the gate was actually REACHED rather than merely not-failed.
#
# This file is human-edited only (Class-2 adjacent: it verifies the verifier).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REAL_FIXLOOP="$REPO/scripts/fixloop.sh"
REAL_CLEANUP="$REPO/scripts/git-cleanup-check.sh"

PASSED=0
FAILURES=0
FIXTURES=()

pass() { printf 'PASS: %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  printf '%s\n' "$2" | sed 's/^/      /' >&2
  FAILURES=$((FAILURES + 1))
}

cleanup() {
  local fx
  for fx in ${FIXTURES+"${FIXTURES[@]}"}; do
    [ -d "$fx" ] || continue
    chmod -R u+rwX "$fx" 2>/dev/null || true
    rm -rf "$fx"
  done
}
trap cleanup EXIT

# ---- assertions --------------------------------------------------------------------------------
# Message assertions are case-insensitive substring matches: they pin the CLAIM the message makes,
# not its exact wording, so the message can be reworded without a test edit but cannot start
# blaming a different cause.

assert_contains() {
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qiF -- "$needle"; then
    pass "$name"
  else
    fail "$name (expected the output to mention '$needle')" "$hay"
  fi
}

assert_not_contains() {
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qiF -- "$needle"; then
    fail "$name (output must NOT mention '$needle')" "$hay"
  else
    pass "$name"
  fi
}

assert_rc_nonzero() {
  local name="$1" rc="$2" out="$3"
  if [ "$rc" -ne 0 ]; then pass "$name"; else fail "$name (expected non-zero exit, got 0)" "$out"; fi
}

assert_rc_zero() {
  local name="$1" rc="$2" out="$3"
  if [ "$rc" -eq 0 ]; then pass "$name"; else fail "$name (expected exit 0, got $rc)" "$out"; fi
}

# ---- fixture -----------------------------------------------------------------------------------
# Topology:
#   base   (integration branch)  locked/x.txt=v1  free/y.txt=v1
#   target (branch under gate)   locked/x.txt=v2  free/y.txt=v2      -- descends from base
#   alien  (orphan)                                                  -- no merge-base with base
# The primary tree sits on `base`, so gating `target` must rewrite both files.

fgit() {
  git -c user.email=whim@example.invalid -c user.name=whim -c commit.gpgsign=false \
      -c protocol.file.allow=always "$@"
}

new_fixture() {
  local fx
  fx="$(mktemp -d "${TMPDIR:-/tmp}/whim-preflight.XXXXXX")" || return 1
  FIXTURES+=("$fx")

  fgit init -q -b base "$fx" >/dev/null 2>&1 || return 1
  mkdir -p "$fx/scripts" "$fx/locked" "$fx/free"

  # The real script under test, byte-for-byte.
  cp "$REAL_FIXLOOP" "$fx/scripts/fixloop.sh"
  chmod +x "$fx/scripts/fixloop.sh"

  # Stub gate: fast, and it announces itself so the negative control can prove it was REACHED.
  cat > "$fx/scripts/gate-full.sh" <<'STUB'
#!/usr/bin/env bash
echo "STUB-GATE-FULL-RAN"
exit "${STUB_GATE_FULL_RC:-0}"
STUB
  chmod +x "$fx/scripts/gate-full.sh"

  echo v1 > "$fx/locked/x.txt"
  echo v1 > "$fx/free/y.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "base" >/dev/null 2>&1 || return 1

  fgit -C "$fx" switch -q -c target >/dev/null 2>&1 || return 1
  echo v2 > "$fx/locked/x.txt"
  echo v2 > "$fx/free/y.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "target" >/dev/null 2>&1 || return 1
  fgit -C "$fx" switch -q base >/dev/null 2>&1 || return 1

  printf '%s' "$fx"
}

add_orphan_branch() {
  local fx="$1"
  fgit -C "$fx" switch -q --orphan alien >/dev/null 2>&1 || return 1
  # --orphan keeps the index; clear it so `alien` shares no history AND no content with base.
  fgit -C "$fx" rm -rq --cached . >/dev/null 2>&1
  rm -rf "$fx/locked" "$fx/free"
  mkdir -p "$fx/scripts"
  cp "$REAL_FIXLOOP" "$fx/scripts/fixloop.sh"; chmod +x "$fx/scripts/fixloop.sh"
  cat > "$fx/scripts/gate-full.sh" <<'STUB'
#!/usr/bin/env bash
echo "STUB-GATE-FULL-RAN"
exit "${STUB_GATE_FULL_RC:-0}"
STUB
  chmod +x "$fx/scripts/gate-full.sh"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "alien root" >/dev/null 2>&1 || return 1
  fgit -C "$fx" switch -q base >/dev/null 2>&1 || return 1
}

# lock_dir <dir> — make <dir> unwritable and PROVE it. Returns 1 if the barrier does not bite.
lock_dir() {
  local d="$1"
  chmod 500 "$d" 2>/dev/null || return 1
  if : > "$d/.barrier-probe" 2>/dev/null; then
    rm -f "$d/.barrier-probe" 2>/dev/null
    chmod 700 "$d" 2>/dev/null
    return 1
  fi
  return 0
}

# run_gatefull <cwd> <integration-branch> <target-branch> -> OUT / RC
run_gatefull() {
  local cwd="$1" integ="$2" target="$3"
  OUT="$(cd "$cwd" && FIXLOOP_INTEGRATION_BRANCH="$integ" ./scripts/fixloop.sh gatefull "$target" 2>&1)"
  RC=$?
}

# ================================================================================================
# Case 1 — a checkout that could not write every tracked path is reported as an INCOMPLETE
# CHECKOUT, naming the stranded paths, and never reaches the gate.
# ================================================================================================
case_incomplete_checkout() {
  local fx; fx="$(new_fixture)" || { fail "case 1 fixture" "could not build fixture"; return; }

  if ! lock_dir "$fx/locked"; then
    fail "case 1 fixture barrier" \
      "chmod 500 did not prevent writes to $fx/locked — running as root, or a filesystem that ignores directory permissions. The fixture cannot reproduce a half-applied checkout, so this suite certifies nothing here. This is reported as a failure rather than skipped, deliberately."
    return
  fi

  run_gatefull "$fx" base target
  chmod 700 "$fx/locked" 2>/dev/null

  assert_rc_nonzero  "incomplete checkout refuses"                  "$RC"  "$OUT"
  assert_contains    "incomplete checkout names its cause"          "$OUT" "INCOMPLETE CHECKOUT"
  assert_contains    "incomplete checkout names the stranded path"  "$OUT" "locked/x.txt"
  assert_not_contains "incomplete checkout does not reach the gate" "$OUT" "STUB-GATE-FULL-RAN"
  # The whole point: the operator must not be told this is tamper. Asserted against the ACTUAL
  # misleading message — `gate.sh`'s tripwire wording — rather than the bare word "tamper", which
  # a substring match cannot distinguish from the message explicitly disclaiming it.
  assert_not_contains "the gate's tripwire is not the reporting mechanism" "$OUT" "GATE REFUSING TO RUN"
  assert_contains     "incomplete checkout actively disclaims tamper"      "$OUT" "NOT tamper"
  # D3: the diagnostic git already emitted must survive, not go to /dev/null.
  assert_contains    "checkout stderr is preserved"                 "$OUT" "Permission denied"
  # This is where the false restore alarm was actually OBSERVED (task 1.6 red check): the
  # half-applied path reached the gate, then reported FAILED TO RESTORE although the working tree
  # content had in fact returned to the starting ref. Two misleading messages stacked on one bug.
  assert_not_contains "incomplete checkout does not also cry restore-failure" "$OUT" "FAILED TO RESTORE"

  # The EXIT trap fires on THIS path, and it is the path where the restore is most likely to be
  # impeded too — the same write barrier that broke the checkout can break the restore. So the
  # early-exit restore must be verified, not silently attempted. Asserting the outcome, because a
  # message-only test would leave the operator's tree unchecked exactly when it is most at risk.
  local head_after tree_diff
  head_after="$(fgit -C "$fx" symbolic-ref --quiet --short HEAD 2>/dev/null)"
  tree_diff="$(fgit -C "$fx" diff --name-only base 2>/dev/null)"
  if [ "$head_after" = "base" ] && [ -z "$tree_diff" ]; then
    pass "incomplete-checkout exit path leaves the tree restored"
  else
    fail "incomplete-checkout exit path leaves the tree restored" \
         "HEAD='$head_after' (want 'base'); still differing: ${tree_diff:-<none>}"
  fi
}

# ================================================================================================
# Case 2 — invoked from a linked worktree, `gatefull` refuses for THAT reason, rather than failing
# later inside the gate with an unrelated dependency-resolution error.
# ================================================================================================
case_linked_worktree() {
  local fx; fx="$(new_fixture)" || { fail "case 2 fixture" "could not build fixture"; return; }
  local wt="$fx/../$(basename "$fx")-wt"

  fgit -C "$fx" worktree add -q --detach "$wt" base >/dev/null 2>&1 \
    || { fail "case 2 fixture" "worktree add failed"; return; }
  FIXTURES+=("$wt")

  run_gatefull "$wt" base target

  assert_rc_nonzero "linked worktree refuses"           "$RC"  "$OUT"
  assert_contains   "linked worktree names its reason"  "$OUT" "primary working tree"
  assert_not_contains "linked worktree does not reach the gate" "$OUT" "STUB-GATE-FULL-RAN"
}

# ================================================================================================
# Case 3 — a target branch unrelated to the integration branch yields no usable baseline, so the
# run refuses saying so, rather than producing a confident verdict against the wrong baseline.
# ================================================================================================
case_unrelated_baseline() {
  local fx; fx="$(new_fixture)" || { fail "case 3 fixture" "could not build fixture"; return; }
  add_orphan_branch "$fx" || { fail "case 3 fixture" "orphan branch setup failed"; return; }

  run_gatefull "$fx" base alien

  assert_rc_nonzero "unrelated baseline refuses"          "$RC"  "$OUT"
  assert_contains   "unrelated baseline names its reason" "$OUT" "baseline could not be established"
  assert_not_contains "unrelated baseline does not reach the gate" "$OUT" "STUB-GATE-FULL-RAN"
}

# ================================================================================================
# Case 4 — a restore that succeeded is not reported as a restore failure. A warning that fires on
# the success path trains operators to ignore a genuinely serious message.
# ================================================================================================
case_restore_not_falsely_alarmed() {
  local fx; fx="$(new_fixture)" || { fail "case 4 fixture" "could not build fixture"; return; }

  run_gatefull "$fx" base target

  assert_not_contains "successful restore emits no restore-failure warning" "$OUT" "FAILED TO RESTORE"

  local head_after
  head_after="$(fgit -C "$fx" symbolic-ref --quiet --short HEAD 2>/dev/null)"
  if [ "$head_after" = "base" ]; then
    pass "successful restore actually returned the tree to its starting ref"
  else
    fail "successful restore actually returned the tree to its starting ref" \
         "HEAD is '$head_after', expected 'base'"
  fi
}

# ================================================================================================
# Case 5 — NEGATIVE CONTROL (decision #28 discipline). A complete, valid checkout passes every
# assertion above and reaches the gate. Without this, every assertion could be a blanket refusal
# and the suite would still be green.
# ================================================================================================
case_negative_control() {
  local fx; fx="$(new_fixture)" || { fail "case 5 fixture" "could not build fixture"; return; }

  run_gatefull "$fx" base target

  assert_rc_zero    "negative control: valid checkout passes"      "$RC"  "$OUT"
  assert_contains   "negative control: the gate was REACHED"       "$OUT" "STUB-GATE-FULL-RAN"
  assert_contains   "negative control: reports the gate verdict"   "$OUT" "FULL GATE PASSED"
  assert_not_contains "negative control: no incomplete-checkout claim" "$OUT" "INCOMPLETE CHECKOUT"
  assert_not_contains "negative control: no worktree claim"        "$OUT" "primary working tree"
  assert_not_contains "negative control: no baseline claim"        "$OUT" "baseline could not be established"

  # The success path must stay silent about internals — a partial success is never reported as
  # success, but a complete one adds no noise.
  assert_not_contains "negative control: no permission diagnostics" "$OUT" "Permission denied"
}

# ================================================================================================
# Cases 6-7 — `git-cleanup-check.sh` prints an apply command valid for the topology the target is
# ACTUALLY checked out in (openspec: staging-integration-lane).
#
# These cases EXECUTE the printed command rather than only matching its text. That is the whole
# point: the original defect was a command that had never once been run, and it failed 100% of the
# time it was followed literally under the staging lane. A test that only grepped the output would
# have reproduced exactly the mistake being fixed.
# ================================================================================================

# new_cleanup_fixture <target-in-worktree: yes|no> -> prints fixture path
# Lane names derive from target_branch=integration/run, so id=integration-run:
#   cleanup branch  cleanup/integration-run-squashed   (single commit, tree identical to target)
#   backup ref      backup/pre-cleanup-integration-run
new_cleanup_fixture() {
  local in_worktree="$1" fx target_sha target_tree squashed
  fx="$(mktemp -d "${TMPDIR:-/tmp}/whim-cleanup.XXXXXX")" || return 1
  FIXTURES+=("$fx")
  # Resolve symlinks: on macOS $TMPDIR lives under /tmp -> /private/tmp, and `git worktree list`
  # reports the real path. The assertions compare full absolute paths, so both sides must agree.
  fx="$(cd "$fx" && pwd -P)" || return 1

  fgit init -q -b main "$fx" >/dev/null 2>&1 || return 1
  mkdir -p "$fx/scripts" "$fx/.claude/fixloop/grants" || return 1
  cp "$REAL_CLEANUP" "$fx/scripts/git-cleanup-check.sh" || return 1
  chmod +x "$fx/scripts/git-cleanup-check.sh"

  echo one > "$fx/file.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "root" >/dev/null 2>&1 || return 1

  fgit -C "$fx" switch -q -c integration/run >/dev/null 2>&1 || return 1
  echo two >> "$fx/file.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "work" >/dev/null 2>&1 || return 1
  fgit -C "$fx" switch -q main >/dev/null 2>&1 || return 1

  target_sha="$(fgit -C "$fx" rev-parse integration/run)"
  target_tree="$(fgit -C "$fx" rev-parse 'integration/run^{tree}')"
  # A rewritten history whose tip TREE is byte-identical — what the cleanup lane must produce.
  squashed="$(fgit -C "$fx" commit-tree "$target_tree" -m "squashed")" || return 1
  fgit -C "$fx" branch cleanup/integration-run-squashed "$squashed" >/dev/null 2>&1 || return 1
  fgit -C "$fx" branch backup/pre-cleanup-integration-run "$target_sha" >/dev/null 2>&1 || return 1

  {
    echo "target_branch=integration/run"
    echo "target_sha=$target_sha"
    echo "target_tree=$target_tree"
  } > "$fx/.claude/fixloop/grants/git-cleanup" || return 1

  if [ "$in_worktree" = yes ]; then
    fgit -C "$fx" worktree add -q "$fx/.claude/worktrees/run-orchestrator" integration/run \
      >/dev/null 2>&1 || return 1
  fi

  printf '%s' "$fx"
}

# apply_command <output> — the runnable apply line, minus the push (no remote in a fixture).
apply_command() {
  printf '%s\n' "$1" \
    | sed -n '/^apply (human/,/^teardown:/p' \
    | grep -E '^[[:space:]]+git ' \
    | grep -v -- '--force-with-lease' \
    | head -1 \
    | sed 's/^[[:space:]]*//'
}

case_cleanup_target_in_worktree() {
  local fx out cmd moved
  fx="$(new_cleanup_fixture yes)" || { fail "case 6 fixture" "could not build cleanup fixture"; return; }
  out="$(cd "$fx" && ./scripts/git-cleanup-check.sh 2>&1)"

  assert_contains "cleanup gate passes (target in a worktree)" "$out" "CLEANUP GATE PASS"
  assert_contains "apply command targets the worktree"         "$out" "git -C $fx/.claude/worktrees/run-orchestrator reset --hard cleanup/integration-run-squashed"
  assert_not_contains "apply command does not tell the operator to check the target out" \
                      "$out" "git checkout integration/run &&"

  # Task 3.3 — RUN it. Text that has never been executed is how the original bug survived.
  cmd="$(apply_command "$out")"
  if [ -z "$cmd" ]; then
    fail "printed apply command is runnable (target in a worktree)" "no apply command found in output"
    return
  fi
  if ! (cd "$fx" && eval "$cmd") >/dev/null 2>&1; then
    fail "printed apply command is runnable (target in a worktree)" "command failed: $cmd"
    return
  fi
  moved="$(fgit -C "$fx" rev-parse integration/run)"
  if [ "$moved" = "$(fgit -C "$fx" rev-parse cleanup/integration-run-squashed)" ]; then
    pass "printed apply command actually moved the target branch (worktree topology)"
  else
    fail "printed apply command actually moved the target branch (worktree topology)" \
         "integration/run is at $moved"
  fi
}

case_cleanup_target_not_checked_out() {
  local fx out cmd moved
  fx="$(new_cleanup_fixture no)" || { fail "case 7 fixture" "could not build cleanup fixture"; return; }
  out="$(cd "$fx" && ./scripts/git-cleanup-check.sh 2>&1)"

  assert_contains "cleanup gate passes (target checked out nowhere)" "$out" "CLEANUP GATE PASS"
  assert_contains "apply command may use the checkout form" \
                  "$out" "git checkout integration/run && git reset --hard cleanup/integration-run-squashed"

  cmd="$(apply_command "$out")"
  if [ -z "$cmd" ]; then
    fail "printed apply command is runnable (checked out nowhere)" "no apply command found in output"
    return
  fi
  if ! (cd "$fx" && eval "$cmd") >/dev/null 2>&1; then
    fail "printed apply command is runnable (checked out nowhere)" "command failed: $cmd"
    return
  fi
  moved="$(fgit -C "$fx" rev-parse integration/run)"
  if [ "$moved" = "$(fgit -C "$fx" rev-parse cleanup/integration-run-squashed)" ]; then
    pass "printed apply command actually moved the target branch (detached topology)"
  else
    fail "printed apply command actually moved the target branch (detached topology)" \
         "integration/run is at $moved"
  fi
}

# ================================================================================================
# Case 8 — the closure poll settles only on a POSITIVE verdict from every check.
#
# `gh pr checks` prints "no checks reported on the '<branch>' branch" and exits 0 in the window
# between a push and CI registering. Step 12c's poll used to stop when nothing reported *pending*,
# so that window read as a PASS and the PR could be flipped ready before a single check had run
# (openspec: harden-closure-lane, finding F1). The predicate under test asserts the condition the
# step actually wants — at least one check exists AND every one has reported an explicit terminal
# verdict — so an absent, empty, or unrecognised result can never produce a green.
#
# WHY A SUBCOMMAND AND NOT PROSE: a markdown step has no exit code, so a runbook promise cannot be
# red-checked. Extracting the condition into `fixloop.sh checkverdict` is what makes F1 testable
# (design D1). Exit contract: 0 settled-pass | 8 pending | 9 settled-fail | 2 usage error.
#
# The fixtures are `gh pr checks` output verbatim in shape: tab-separated NAME/STATE/ELAPSED/URL.
# ================================================================================================

assert_rc_is() {
  local name="$1" want="$2" rc="$3" out="$4"
  if [ "$rc" -eq "$want" ]; then pass "$name"; else fail "$name (expected exit $want, got $rc)" "$out"; fi
}

CHECKS_DIR=""

# run_checkverdict <tool-rc> <output-text> -> OUT / RC
run_checkverdict() {
  local text="$2" f
  if [ -z "$CHECKS_DIR" ]; then
    CHECKS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/whim-checkverdict.XXXXXX")" || return 1
    FIXTURES+=("$CHECKS_DIR")
  fi
  f="$(mktemp "$CHECKS_DIR/out.XXXXXX")" || return 1
  printf '%s' "$text" > "$f"
  OUT="$("$REAL_FIXLOOP" checkverdict "$1" "$f" 2>&1)"
  RC=$?
}

case_poll_absent_verdict_is_pending() {
  # The defect in its exact shape: the tool exits 0 and reports no verdict at all.
  run_checkverdict 0 "no checks reported on the 'integration/run' branch"$'\n'
  assert_rc_is "no-checks-reported classifies as PENDING" 8 "$RC" "$OUT"
  assert_not_contains "no-checks-reported never reports a pass" "$OUT" "SETTLED PASS"

  # Absence in its other shape: no output whatsoever, exit 0.
  run_checkverdict 0 ""
  assert_rc_is "empty check output classifies as PENDING" 8 "$RC" "$OUT"
  assert_not_contains "empty check output never reports a pass" "$OUT" "SETTLED PASS"
}

case_poll_every_check_reported() {
  # The POSITIVE case. This is the negative control for the whole group: without it, a predicate
  # that returned 8 unconditionally would satisfy every other assertion here.
  run_checkverdict 0 "$(printf 'build\tpass\t1m2s\thttps://x/1\nlint\tpass\t31s\thttps://x/2\n')"
  assert_rc_is "every check passing classifies as SETTLED PASS" 0 "$RC" "$OUT"
  assert_contains "the settled pass is stated, not inferred" "$OUT" "SETTLED PASS"

  # `skipping` is a terminal non-failure verdict — it settles, it does not block.
  run_checkverdict 0 "$(printf 'build\tpass\t1m2s\thttps://x/1\ndocs\tskipping\t0\thttps://x/3\n')"
  assert_rc_is "a skipped check still settles" 0 "$RC" "$OUT"
}

case_poll_partial_is_pending() {
  # A mix of reported and unreported is the case the old predicate got right only by accident:
  # it saw the literal word "pending" and kept waiting. Locked so the rewrite cannot lose it.
  run_checkverdict 8 "$(printf 'build\tpass\t1m2s\thttps://x/1\nlint\tpending\t0\thttps://x/2\n')"
  assert_rc_is "a pending check keeps the poll waiting" 8 "$RC" "$OUT"
  assert_not_contains "a partial result never reports a pass" "$OUT" "SETTLED PASS"
}

case_poll_failure_is_settled_fail() {
  # Settled, but NOT passing — the poll must stop and route to the Sonar/fix round, never flip ready.
  run_checkverdict 1 "$(printf 'build\tfail\t1m2s\thttps://x/1\nlint\tpass\t31s\thttps://x/2\n')"
  assert_rc_is "a failing check classifies as SETTLED FAIL" 9 "$RC" "$OUT"
  assert_not_contains "a failing check never reports a pass" "$OUT" "SETTLED PASS"
}

case_poll_unknown_state_is_pending() {
  # Fail-safe: a state token this predicate does not recognise (a new gh verdict, a format change)
  # must never be silently counted as success. It is the same absent-is-not-success rule applied to
  # a value we cannot interpret, and it is what keeps the classifier from rotting into a green.
  run_checkverdict 0 "$(printf 'build\tsome-new-state\t1m2s\thttps://x/1\n')"
  assert_rc_is "an unrecognised state classifies as PENDING" 8 "$RC" "$OUT"
  assert_not_contains "an unrecognised state never reports a pass" "$OUT" "SETTLED PASS"
  assert_contains "an unrecognised state is named, not swallowed" "$OUT" "some-new-state"
}

# ================================================================================================
# Case 9 — `park` accepts the branch kinds the runbook tells operators to park.
#
# The runbook instructs `scripts/fixloop.sh park` on a run's staging branch (apply.md step 12c's
# timeout path, and the standing terminal-wall rule), and the command refused `integration/*` — so
# the one real staging park had to be hand-rolled, reproducing this command's own note format by
# eye (openspec: harden-closure-lane, finding F3).
#
# Widening an accepted-input set is exactly the change that silently becomes "accept anything", so
# the refusal case is asserted alongside, and it asserts that NO note is written on refusal — a
# rename that half-happened would otherwise leave a run in a state neither branch name describes.
# ================================================================================================

# new_park_fixture <main-advanced: yes|no> -> path
# Topology: main -> (branch point) -> integration/run. With `yes`, main gains a further commit so
# it is no longer an ancestor — the condition that made step 12f fail on the real parked run.
new_park_fixture() {
  local advanced="$1" fx
  fx="$(mktemp -d "${TMPDIR:-/tmp}/whim-park.XXXXXX")" || return 1
  FIXTURES+=("$fx")

  fgit init -q -b main "$fx" >/dev/null 2>&1 || return 1
  mkdir -p "$fx/scripts"
  cp "$REAL_FIXLOOP" "$fx/scripts/fixloop.sh"; chmod +x "$fx/scripts/fixloop.sh"
  echo v1 > "$fx/a.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "base" >/dev/null 2>&1 || return 1

  fgit -C "$fx" switch -q -c integration/run >/dev/null 2>&1 || return 1
  echo v2 > "$fx/a.txt"
  fgit -C "$fx" add -A >/dev/null 2>&1
  fgit -C "$fx" commit -qm "run work" >/dev/null 2>&1 || return 1

  if [ "$advanced" = yes ]; then
    fgit -C "$fx" switch -q main >/dev/null 2>&1 || return 1
    echo v3 > "$fx/b.txt"
    fgit -C "$fx" add -A >/dev/null 2>&1
    fgit -C "$fx" commit -qm "main moved on" >/dev/null 2>&1 || return 1
    fgit -C "$fx" switch -q integration/run >/dev/null 2>&1 || return 1
  fi

  printf '%s' "$fx"
}

case_park_accepts_staging_branch() {
  local fx out rc note
  fx="$(new_park_fixture no)" || { fail "case 9 fixture" "could not build park fixture"; return; }

  out="$(cd "$fx" && ./scripts/fixloop.sh park integration/run "closure poll reached no verdict" 2>&1)"
  rc=$?
  assert_rc_is "parking a staging branch succeeds" 0 "$rc" "$out"
  assert_contains "the park is reported" "$out" "PARKED integration/run -> wip/run"

  if fgit -C "$fx" rev-parse --verify -q wip/run >/dev/null; then
    pass "the staging branch is renamed under wip/*"
  else
    fail "the staging branch is renamed under wip/*" "$out"
  fi

  note="$fx/.claude/fixloop/wip-run.md"
  if [ -r "$note" ]; then
    pass "a reason note is written"
  else
    fail "a reason note is written" "no note at $note"
    return
  fi
  note="$(cat "$note")"
  assert_contains "the note records the reason" "$note" "closure poll reached no verdict"
  assert_contains "the note points at closure, not a worktree redispatch" "$note" "runbook step 12"
  assert_contains "the note resumes in the primary tree" "$note" "PRIMARY working tree"
  assert_contains "the note names the integration-branch export" "$note" "FIXLOOP_INTEGRATION_BRANCH=wip/run"
}

case_park_staging_records_base_divergence() {
  # The fact that makes a parked staging run resumable, and the one the hand-rolled park had to
  # work out by hand. Asserted in BOTH directions so the note reports what is true, not a warning
  # stapled on unconditionally.
  local fx out note
  fx="$(new_park_fixture yes)" || { fail "case 9b fixture" "could not build park fixture"; return; }
  out="$(cd "$fx" && ./scripts/fixloop.sh park integration/run "parked with the base advanced" 2>&1)"
  note="$(cat "$fx/.claude/fixloop/wip-run.md" 2>/dev/null)"
  assert_contains "a diverged base is reported as NOT an ancestor" "$note" "is NOT an ancestor"
  assert_contains "the note says the ancestor check will fail" "$note" "WILL FAIL"
  assert_contains "the note says to reconcile first" "$note" "Do that FIRST"

  fx="$(new_park_fixture no)" || { fail "case 9c fixture" "could not build park fixture"; return; }
  out="$(cd "$fx" && ./scripts/fixloop.sh park integration/run "parked with the base still behind" 2>&1)"
  note="$(cat "$fx/.claude/fixloop/wip-run.md" 2>/dev/null)"
  assert_contains "an undiverged base is reported as still an ancestor" "$note" "IS still an ancestor"
  assert_not_contains "no divergence warning when the base has not diverged" "$note" "WILL FAIL"
}

case_park_still_refuses_unknown_branch_kind() {
  # The negative control for 2.2. Without it, widening the accepted set could become "accept
  # anything" and no assertion here would notice.
  local fx out rc
  fx="$(new_park_fixture no)" || { fail "case 9d fixture" "could not build park fixture"; return; }
  fgit -C "$fx" branch scratch/thing integration/run >/dev/null 2>&1

  out="$(cd "$fx" && ./scripts/fixloop.sh park scratch/thing "should be refused" 2>&1)"
  rc=$?
  assert_rc_nonzero "parking an unrecognised branch kind is refused" "$rc" "$out"
  assert_contains "the refusal names the accepted kinds" "$out" "fix/*, chain/* or integration/*"
  if fgit -C "$fx" rev-parse --verify -q scratch/thing >/dev/null; then
    pass "a refused park leaves the branch untouched"
  else
    fail "a refused park leaves the branch untouched" "scratch/thing no longer exists"
  fi
  if [ -e "$fx/.claude/fixloop/wip-thing.md" ]; then
    fail "a refused park writes no note" "a note was written for a refused park"
  else
    pass "a refused park writes no note"
  fi

  # Regression guard: the pre-existing kinds still park, and still get the worktree resume line.
  out="$(cd "$fx" && ./scripts/fixloop.sh park fix/thing "nope" 2>&1)"
  assert_rc_nonzero "parking a nonexistent fix branch fails cleanly" "$?" "$out"
}

case_park_fix_branch_unchanged() {
  local fx out rc note
  fx="$(new_park_fixture no)" || { fail "case 9e fixture" "could not build park fixture"; return; }
  fgit -C "$fx" branch fix/thing integration/run >/dev/null 2>&1

  out="$(cd "$fx" && ./scripts/fixloop.sh park fix/thing "still works" 2>&1)"
  rc=$?
  assert_rc_is "parking a fix branch still succeeds" 0 "$rc" "$out"
  note="$(cat "$fx/.claude/fixloop/wip-thing.md" 2>/dev/null)"
  assert_contains "a fix park still gets the worktree resume line" "$note" "git worktree add .claude/worktrees/thing"
  assert_not_contains "a fix park gets no staging-closure section" "$note" "runbook step 12"
}

case_incomplete_checkout
case_linked_worktree
case_unrelated_baseline
case_restore_not_falsely_alarmed
case_negative_control
case_cleanup_target_in_worktree
case_cleanup_target_not_checked_out
case_poll_absent_verdict_is_pending
case_poll_every_check_reported
case_poll_partial_is_pending
case_poll_failure_is_settled_fail
case_poll_unknown_state_is_pending
case_park_accepts_staging_branch
case_park_staging_records_base_divergence
case_park_still_refuses_unknown_branch_kind
case_park_fix_branch_unchanged

printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf 'fixloop preflight: %d passed, %d FAILED\n' "$PASSED" "$FAILURES" >&2
  exit 1
fi
printf 'fixloop preflight: %d passed\n' "$PASSED"
exit 0
