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
  # The whole point: the operator must not be told this is tamper.
  assert_not_contains "incomplete checkout is not blamed on tamper" "$OUT" "TAMPER"
  # D3: the diagnostic git already emitted must survive, not go to /dev/null.
  assert_contains    "checkout stderr is preserved"                 "$OUT" "Permission denied"
  # This is where the false restore alarm was actually OBSERVED (task 1.6 red check): the
  # half-applied path reached the gate, then reported FAILED TO RESTORE although the working tree
  # content had in fact returned to the starting ref. Two misleading messages stacked on one bug.
  assert_not_contains "incomplete checkout does not also cry restore-failure" "$OUT" "FAILED TO RESTORE"
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

case_incomplete_checkout
case_linked_worktree
case_unrelated_baseline
case_restore_not_falsely_alarmed
case_negative_control

printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf 'fixloop preflight: %d passed, %d FAILED\n' "$PASSED" "$FAILURES" >&2
  exit 1
fi
printf 'fixloop preflight: %d passed\n' "$PASSED"
exit 0
