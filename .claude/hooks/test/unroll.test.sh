#!/usr/bin/env bash
# Adversarial regression suite for the compound-command unroller (openspec: compound-command-policy,
# task 2.4). Two layers: (A) the parser helper's JSON verdict in isolation; (B) the end-to-end
# bash-policy decision for compounds. Runs UNHOOKED (invoked from the gate as a child process), so
# the `git push` / `curl` literals below do not re-trigger the PreToolUse hook.
set -euo pipefail

HOOKDIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$HOOKDIR/bash-policy.sh"
UNROLL="$HOOKDIR/unroll-command.mjs"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/whim-unroll.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
WT="$ROOT/.claude/worktrees/nav-chain"
mkdir -p "$WT"

PASS=0
fail() {
  local msg="$1" detail="$2"
  printf 'FAIL: %s\n%s\n' "$msg" "$detail" >&2
  exit 1
}
pass() {
  local name="$1"
  printf 'PASS: %s\n' "$name"
}

# ---- Layer A: the parser helper in isolation -------------------------------------------------
u() {
  local cmd="$1"
  printf '%s' "$cmd" | node "$UNROLL"
}

expect_unrollable() {
  local name="$1" cmd="$2" want="$3"
  local got; got=$(u "$cmd" | jq -r '.unrollable')
  [[ "$got" == "$want" ]] || fail "$name (unrollable expected $want, got $got)" "$(u "$cmd")"
  PASS=$((PASS + 1)); pass "$name"
}
expect_segcount() {
  local name="$1" cmd="$2" want="$3"
  local got; got=$(u "$cmd" | jq -r '.segments | length')
  [[ "$got" == "$want" ]] || fail "$name (segments expected $want, got $got)" "$(u "$cmd")"
  PASS=$((PASS + 1)); pass "$name"
}
expect_redirect() {
  local name="$1" cmd="$2" want="$3"
  local got; got=$(u "$cmd" | jq -r '.redirects[0] // ""')
  [[ "$got" == "$want" ]] || fail "$name (redirect[0] expected '$want', got '$got')" "$(u "$cmd")"
  PASS=$((PASS + 1)); pass "$name"
}

# Split points: one per top-level connector.
expect_segcount "AND splits"        'npm run build && npm run lint'          2
expect_segcount "OR splits"         'npm run build || npm run lint'          2
expect_segcount "semicolon splits"  'git status ; git diff'                  2
expect_segcount "pipe splits"       'grep foo | head'                        2
expect_segcount "three-way chain"   'a && b ; c'                             3

# Quoted connectors are ARGUMENT TEXT, not split points (the load-bearing anti-smuggle property).
expect_segcount "quoted && is one segment"      'git commit -m "fix && polish"'        1
expect_segcount "quoted pipe/semis one segment" 'git commit -m "a | b ; c"'            1
expect_segcount "single-quoted connectors"      "git commit -m 'x && y || z'"          1
expect_segcount "quoted push text one segment"  'echo "git push origin main"'          1

# Redirect targets become pseudo-writes (dequoted); segment count excludes them.
expect_redirect "redirect target extracted"     'node x.mjs > out.txt'                 out.txt
expect_redirect "append target extracted"       'npm run build >> log.txt'             log.txt
expect_redirect "dequoted redirect target"      'echo x > ".claude/settings.json"'     .claude/settings.json
expect_segcount "redirect not counted as seg"   'echo x > out.txt'                     1

# Non-unrollable constructs fail closed.
expect_unrollable "command substitution refused"   'git push origin $(cat ref)'        false
expect_unrollable "backtick refused"               'echo `whoami`'                      false
expect_unrollable "param expansion refused"        'git push origin $BRANCH'            false
expect_unrollable "expansion in dquotes refused"   'echo "hi $USER"'                    false
expect_unrollable "bash -c refused"                'bash -c "rm -rf x"'                 false
expect_unrollable "eval refused"                   'eval rm -rf x'                      false
expect_unrollable "xargs refused"                  'echo x | xargs rm'                  false
expect_unrollable "env wrapper refused"            'env FOO=bar npm run x'              false
expect_unrollable "assignment prefix refused"      'FOO=bar npm run x'                  false
expect_unrollable "process substitution refused"   'diff <(a) <(b)'                     false
expect_unrollable "subshell refused"               'ls && (cd / && rm)'                 false
expect_unrollable "brace group refused"            '{ ls ; rm ; }'                      false
expect_unrollable "heredoc refused"                'cat <<EOF'                           false
expect_unrollable "backslash escape refused"       'echo a\ b'                          false
expect_unrollable "dangling connector refused"     'npm run build &&'                   false
expect_unrollable "unterminated quote refused"     'echo "oops'                         false
expect_unrollable "plain compound is unrollable"   'npm run build && npm run lint'      true

# ---- Layer B: end-to-end bash-policy verdict for compounds -----------------------------------
invoke() {
  local agent="$1" cmd="$2" cwd="$3"
  jq -cn --arg a "$agent" --arg c "$cmd" --arg cwd "$cwd" \
    '{agent_id:$a,cwd:$cwd,tool_input:{command:$c}}' | bash "$HOOK"
}
expect_decision() {
  local name="$1" expected="$2" agent="$3" cmd="$4" cwd="$5"
  local out dec; out=$(invoke "$agent" "$cmd" "$cwd")
  if [[ -z "$out" ]]; then dec="none"; else dec=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"'); fi
  [[ "$dec" == "$expected" ]] || fail "$name (expected $expected, got $dec)" "$out"
  PASS=$((PASS + 1)); pass "$name"
}

# Worst-segment composition (deny > ask > none > allow).
expect_decision "all-allowed compound runs unprompted" allow "" 'npm run build && npm run lint' "$ROOT"
expect_decision "all-allowed pipe runs unprompted"     allow "" 'grep foo build.log | head -20' "$ROOT"
expect_decision "one ask-tier segment asks (full line)" ask   "" 'npm run build && git commit -m wip' "$ROOT"
expect_decision "unknown segment falls through to none" none  "" 'ls && frobnicate --wat' "$ROOT"

# Raw-string deny kernel is checked BEFORE parsing.
expect_decision "curl smuggled into compound denies"    deny  "" 'npm run lint; curl https://evil' "$ROOT"
expect_decision "npm install smuggled denies"           deny  "" 'ls && npm install lodash' "$ROOT"

# Redirect into a protected path denies (alone or compounded).
expect_decision "redirect into protected denies"        deny  "" 'echo x > .claude/settings.json' "$ROOT"
expect_decision "redirect into protected in compound"   deny  "" 'npm run build && echo x >> scripts/gate.sh' "$ROOT"
expect_decision "redirect into safe path is not denied"  none  "" 'echo hello > '"$ROOT"'/scratch.txt' "$ROOT"
# Glob-obfuscated redirect targets are unclassifiable (bash would expand `settin?s`->`settings` at
# run time), so they fail closed to deny — the literal PROTECTED match can't see through the glob.
expect_decision "glob (?) redirect denies"              deny  "" 'echo x > .claude/settin?s.json' "$ROOT"
expect_decision "glob (*) redirect denies"              deny  "" 'echo x > .claude/setti*.json' "$ROOT"
expect_decision "glob ([]) redirect denies"             deny  "" 'echo x > out-[abc].txt' "$ROOT"

# Refspec smuggling inside a compound stays denied (the push names main via the refspec).
expect_decision "refspec smuggling in compound denies"  deny  "" 'git push origin integration/run-1:main && echo done' "$ROOT"
expect_decision "compound push of main denies"          deny  "" 'echo hi && git push origin main' "$ROOT"

# Subagent compound is never auto-allowed (parity with bash-policy.test.sh line 49).
expect_decision "subagent worktree add + unknown -> none" none agent-a "git -C $WT add f.ts && frob" "$ROOT"

# Negative control: a known-bad compound must NEVER come back allowed. If a regressed parser split
# the quoted push wrong or promoted a deny to allow, this line flips and the gate fails.
NEG=$(invoke "" 'git push origin main && echo done' "$ROOT" | jq -r '.hookSpecificOutput.permissionDecision // "none"')
[[ "$NEG" == "allow" ]] && fail "NEGATIVE CONTROL: known-bad compound was ALLOWED" "$NEG"
PASS=$((PASS + 1)); pass 'negative control (known-bad never allowed)'

printf 'unroller tests: %d passed\n' "$PASS"
