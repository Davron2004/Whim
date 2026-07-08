# Harness Build Guide

> **SUPERSEDED (2026-07-07).** This is the original build recipe (June 2026), kept for history.
> The embedded copies of `gate.sh`, `settings.json`, the agent definitions, and the dispatch
> command have ALL drifted from the real files — never work from them. Current architecture:
> [`../harness.md`](../harness.md). `/dispatch` was folded into `/opsx:apply`; the integration
> branch is `main`; both loops now run worktree-parallel.

Opus dispatches, Sonnet implements, exit codes decide. Built entirely on native Claude Code primitives (subagents, hooks, slash commands) plus OpenSpec artifacts. Assumes TypeScript, Whim as testbed, npm scripts named `typecheck` / `lint` / `test` — adapt those three names and nothing else changes.

-----

## 0. Architecture at a glance

| Role            | Where it runs                        | Model                | Tools                                  | Job                                                                               |
| --------------- | ------------------------------------ | -------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| **Proposer**    | Main session (short-lived chat)      | Fable, high thinking | all                                    | Writes proposal/design/chains. Never crawls code itself.                          |
| **Researcher**  | Subagent                             | Sonnet               | Read, Grep, Glob                       | Crawls codebase, returns a bounded digest.                                        |
| **Dispatcher**  | Main session (`claude --model opus`) | Opus                 | all                                    | Feeds chains to implementers, adjudicates deviations, never reads implementation. |
| **Implementer** | Subagent                             | Sonnet               | Read, Edit, Write, Bash, Grep, Glob    | One context chain per invocation. Done = gate passes.                             |
| **Reviewer**    | Subagent                             | Sonnet               | Read, Grep, Glob, Bash (read-only use) | Reads actual diffs when a report smells off; honesty check.                       |
| **Critic**      | Subagent, daily                      | Sonnet               | Read, Grep, Glob, Bash (read-only use) | Finds problems, fixes nothing, files a report.                                    |

Two structural facts shape everything below:

1. **Subagents cannot spawn subagents.** The hierarchy is flat: main session → workers. So the dispatcher must BE the main session, never a subagent. (This is also why the researcher hands digests to the *main* Fable thread rather than to some intermediate planner.)
1. **A subagent’s context dies with it; only its final message survives.** That final message is your interface. Every agent below has a mandatory fixed-format report because the report is the only thing the dispatcher ever sees.

Information flows through files, not context: `research.md` → proposal artifacts → `chains.md` → `handoff/*.md` contracts → `progress.md` → critic reports. Everything lives in the repo under the OpenSpec change folder, so it’s versioned, greppable, and tool-agnostic (your Codex escape hatch stays open for free).

-----

## 1. Repo additions

```
your-repo/
├── docs/
│   └── capabilities.md            # NEW: one-line index of every spec
├── openspec/
│   └── changes/<change-id>/
│       ├── proposal.md            # OpenSpec native
│       ├── design.md              # OpenSpec native
│       ├── tasks.md               # OpenSpec native
│       ├── research.md            # NEW: researcher digest used for this proposal
│       ├── chains.md              # NEW: tasks grouped into context chains
│       ├── handoff/               # NEW: contracts between chains
│       │   └── backend-api.md
│       └── progress.md            # NEW: dispatcher log, appended per chain
├── scripts/
│   └── gate.sh                    # NEW: the verification gate
└── .claude/
    ├── settings.json              # hooks registered here
    ├── hooks/
    │   ├── gate-on-subagent-stop.sh
    │   └── protect-harness.sh
    ├── agents/
    │   ├── researcher.md
    │   ├── implementer.md
    │   ├── reviewer.md
    │   └── critic.md
    └── commands/
        ├── dispatch.md
        └── critic-run.md
```

### docs/capabilities.md (the “map, not manual”)

One line per spec capability. This is what turns proposal cost from O(project size) into O(change size).

```markdown
# Capability index
<!-- One line per capability. Update when archiving a change. -->
| Capability | What it covers | Spec |
|---|---|---|
| webview-shell | WebView container, lifecycle, rendering contract | openspec/specs/webview-shell/spec.md |
| tip-splitter | Hand-written demo bundle proving the contract | openspec/specs/tip-splitter/spec.md |
```

Maintenance is one extra line in your archive ritual: when you `/opsx:archive`, update the index. (Later, fold this into the critic’s checklist: “is capabilities.md stale?”)

-----

## 2. The verification gate — `scripts/gate.sh`

The single source of “done.” Implementers must pass it; the hook enforces it; the dispatcher trusts its exit code over any prose.

```bash
#!/usr/bin/env bash
# Verification gate. Exit 0 = done is allowed to mean done.
set -u
FAILED=()

section() { printf '\n== %s\n' "$1"; }
check() {
  local name="$1"; shift
  section "$name"
  if "$@"; then echo "PASS: $name"; else echo "FAIL: $name"; FAILED+=("$name"); fi
}

check "typecheck"        npm run -s typecheck
check "lint"             npm run -s lint -- --max-warnings 0
check "dead code (knip)" npx knip
check "tests"            npm run -s test
check "openspec"         npx openspec validate --strict

# Scaffolding tripwires: cheap greps for the garbage class you've already met.
section "scaffolding tripwires"
TRIPWIRE=$(grep -rn --include='*.ts' --include='*.tsx' \
  -e 'TEMP:' -e 'HACK:' -e 'isImplemented' -e 'IS_IMPLEMENTED' \
  -e 'console\.log(.*debug' \
  src/ 2>/dev/null || true)
if [ -n "$TRIPWIRE" ]; then
  echo "$TRIPWIRE"
  echo "FAIL: scaffolding tripwires"
  FAILED+=("scaffolding tripwires")
else
  echo "PASS: scaffolding tripwires"
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '\nGATE FAILED: %s\n' "${FAILED[*]}"
  exit 1
fi
printf '\nGATE PASSED\n'
exit 0
```

Notes:

- **The always-true-flag catcher:** enable `@typescript-eslint/no-unnecessary-condition` in your ESLint config (requires type-aware linting: `parserOptions.project` set). It flags provably-constant conditions — your dead short-circuit, when the literal type survives to the use site.
- **The tripwire grep is your “encode corrections once” slot.** Every time the critic or you finds a new garbage pattern, add a grep line. It’s crude and it works. Curate it; don’t let it grow stale patterns that block legitimate code.
- Keep the gate under ~2 minutes. If tests get slow, split into `gate.sh` (fast, per-chain) and `gate-full.sh` (run by dispatcher once per change).

-----

## 3. Permissions and hooks — `.claude/settings.json`

Subagents and permission prompts are a known sore spot: there are recurring Claude Code bugs where subagents fail to inherit the parent session’s allowlist and prompt for everything — and even when prompts do surface, an unattended dispatcher means every prompt is a stall. So the harness makes permissions **deterministic** with two layers:

1. **Declarative allowlist** (`permissions.allow` below) — the normal mechanism, version-dependent for subagents.
1. **A PreToolUse bash policy hook** — the bug-proof layer. Hooks execute inside subagents regardless of allowlist inheritance, and a hook returning `permissionDecision: "allow"` skips the prompt entirely. If the allowlist inherits correctly on your version, the hook is redundant; if it doesn’t, the hook carries the load. Either way, no stalls.

The list isn’t huge, because the harness constrains the command vocabulary *by design*: implementers funnel verification through `./scripts/gate.sh` and npm scripts, and the read-only agents need only git-read commands. Keep it that way — when an agent needs a new command class, that’s a prompt-vocabulary decision you make once, not an “Always allow” you click at 2am.

Note the deny rules doing double duty as design enforcement: `npm install` is denied because new dependencies are class-B deviations by definition — the permission system makes the prompt rule physically true instead of merely requested. Same for `git push` (humans push).

```json
{
  "permissions": {
    "allow": [
      "Read", "Edit", "Write", "Grep", "Glob",
      "Bash(./scripts/gate.sh)",
      "Bash(npm run:*)",
      "Bash(npm test:*)",
      "Bash(npx tsc:*)",
      "Bash(npx eslint:*)",
      "Bash(npx knip:*)",
      "Bash(npx vitest:*)",
      "Bash(npx openspec:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)",
      "Bash(grep:*)", "Bash(rg:*)", "Bash(wc:*)", "Bash(mkdir:*)"
    ],
    "deny": [
      "Bash(git push:*)",
      "Bash(npm install:*)",
      "Bash(npm uninstall:*)",
      "Bash(sudo:*)",
      "Bash(curl:*)",
      "Bash(wget:*)"
    ]
  },
  "hooks": {
    "SubagentStop": [
      {
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gate-on-subagent-stop.sh" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-harness.sh" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/bash-policy.sh" }
        ]
      }
    ]
  }
}
```

### `.claude/hooks/gate-on-subagent-stop.sh`

Fires when any subagent tries to finish. Exit 2 blocks the stop and feeds stderr back to the subagent, which keeps working. Read-only agents pass through untouched (no dirty tree → no gate).

```bash
#!/usr/bin/env bash
INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Only gate the implementer.
[ "$AGENT_TYPE" = "implementer" ] || exit 0

# Nothing changed → nothing to verify (also exempts read-only agents defensively).
if git diff --quiet && git diff --cached --quiet; then exit 0; fi

# Attempt cap: after 2 blocked stops, let it stop. The report will say
# failed-gate and the dispatcher handles it. Prevents infinite loops.
COUNT_FILE="/tmp/gate-attempts-${SESSION}"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
if [ "$COUNT" -ge 2 ]; then rm -f "$COUNT_FILE"; exit 0; fi

OUT=$(./scripts/gate.sh 2>&1)
if [ $? -eq 0 ]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

echo $((COUNT + 1)) > "$COUNT_FILE"
{
  echo "VERIFICATION GATE FAILED — you are not done."
  echo "Fix the failures, rerun ./scripts/gate.sh yourself, and only finish when it passes."
  echo "If a failure is genuinely outside your chain's scope, finish with STATUS: failed-gate and explain in DEVIATIONS."
  echo "--- gate output (tail) ---"
  echo "$OUT" | tail -40
} >&2
exit 2
```

### `.claude/hooks/protect-harness.sh`

The anti-reward-hacking hook. An agent that can’t pass the checks must never be able to edit the checks. Blocks even in permissive modes. `package.json` is included because `npm run` is broadly allowed — an agent must not be able to redefine what `npm run typecheck` *means*. (Script or dependency changes are class-B deviations: the agent stops, you edit.)

```bash
#!/usr/bin/env bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in
  */scripts/gate.sh|*/.claude/*|*/eslint.config.*|*/.eslintrc*|*/knip.json|*/knip.config.*|*/tsconfig*.json|*/package.json|*/package-lock.json)
    echo "BLOCKED: harness and verification config are human-edited only. If a config change is genuinely required, report it as a class-B deviation." >&2
    exit 2
    ;;
esac
exit 0
```

(You edit those files in your editor, not through Claude. Small price.)

### `.claude/hooks/bash-policy.sh`

The no-stall guarantee. Deterministic allow/deny on the harness’s command vocabulary, evaluated inside subagents where allowlist inheritance has historically been flaky. Three outcomes: hard-deny with a reason the agent sees, auto-allow the known vocabulary, or stay silent — an unknown command falls through to the normal permission flow, which is safe-by-default (it can stall, and a stall on an unknown command is information).

```bash
#!/usr/bin/env bash
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}
allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"harness bash policy"}}\n'
  exit 0
}

# Hard denies first — match anywhere in the command, including chained segments.
case "$CMD" in
  *sudo*|*"git push"*|*"npm install"*|*"npm uninstall"*|*curl*|*wget*|*"rm -rf /"*)
    deny "blocked by harness policy — if genuinely needed, stop and report a class-B deviation" ;;
esac

# Auto-allow vocabulary — anchored at command start, so chained commands fall through.
case "$CMD" in
  "./scripts/gate.sh"*|"npm run "*|"npm test"*|"npx tsc"*|"npx eslint"*|"npx knip"*|"npx vitest"*|"npx openspec"*|\
  "git status"*|"git diff"*|"git log"*|"git show"*|"git add "*|"git commit "*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
esac

# Unknown: no decision → normal permission flow.
exit 0
```

Deliberate crudeness: the allow patterns are anchored at the start of the command, so `npm test && rm -rf src` does NOT auto-approve — chained commands fall through to a prompt. The implementer prompt compensates with a “run commands singly” rule. The vocabulary lists in this script and in `permissions.allow` should stay in sync; when you add a tripwire-style new command class, add it to both.

-----

## 4. Agent definitions

### `.claude/agents/researcher.md`

```markdown
---
name: researcher
description: Codebase exploration and context digests. Use proactively whenever orienting requires reading more than 3 files — especially during OpenSpec proposal and design phases (/opsx:*). The main thread should never crawl the codebase itself.
tools: Read, Grep, Glob
model: sonnet
---

You are a research scout. You read code so that a more expensive model doesn't have to. Your entire value is compression: the caller gets your digest INSTEAD of the files.

You receive a research question (e.g. "what would adding X touch?"). Procedure:
1. Read docs/capabilities.md first. Pull only the specs it points to as relevant.
2. Explore source from there: Grep/Glob to locate, Read to confirm. Follow imports only while they answer the question.
3. Return the digest as your final message. The proposer (caller) saves it to openspec/changes/<id>/research.md.

Digest format — hard cap 120 lines:

# Research digest: <question>
## Relevant files
- path — one-line role in this question
## Current behavior
What the code does today in the affected area. Prose, precise, no code dumps.
## Constraints and invariants
Things any change here must not break. Include type signatures or contracts verbatim ONLY when exactness matters.
## Integration points
Where new code would attach: functions, modules, events, routes.
## Risks and unknowns
Anything you could not confirm. Say "I did not verify X" explicitly.
## Open questions for the planner
Max 5, only if genuinely undecidable from code.

Rules:
- Never paste more than 10 consecutive lines of source.
- Never recommend an implementation approach. You report terrain, not strategy.
- If the question is too broad to digest in 120 lines, say so and propose how to split it — do not silently truncate coverage.
```

### `.claude/agents/implementer.md`

```markdown
---
name: implementer
description: Implements exactly one context chain (a contiguous group of OpenSpec tasks) end to end. Dispatched by the orchestrator with a chain block. Not for exploration, review, or multi-chain work.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You implement ONE context chain. The dispatcher's message contains: the chain id, the task list, spec excerpts, paths of contract files to read, and likely-touched files. That message plus those files is your whole world — do not re-derive the plan, do not expand scope.

Procedure:
1. Read the contract files and spec excerpts listed in your chain block. Nothing else unless a task forces it.
2. Implement tasks in order. After each task, tick its checkbox in openspec/changes/<id>/tasks.md.
3. Tests come from spec scenarios (Given/When/Then), written before or alongside the code they verify. Never write a test that merely asserts what your implementation happens to do.
4. Run ./scripts/gate.sh yourself before finishing. You are not done until it passes. A hook enforces this; do not try to negotiate with it.
5. If your chain block lists a contract to write, write it (see contract rules in chains.md) as your last task.
6. End with the report. The report is the ONLY thing the dispatcher sees. It must be honest — a reviewer audits reports against diffs, and a dishonest report is the one unforgivable failure.

Deviation classes — when reality disagrees with the spec or plan:
- CLASS A (trivial): naming, file placement, an obvious small fix outside the letter of the task. → Proceed, note it in the report.
- CLASS B (spec-affecting): the planned approach won't work, a dependency is needed, an interface must differ from the contract, a task is ambiguous. → STOP. Finish with STATUS: blocked, describe the deviation precisely, propose 1–2 options. Do not improvise around it.
- CLASS C (spec-contradicting or destructive): the spec asks for something the codebase contradicts, data loss is possible, two tasks conflict. → STOP IMMEDIATELY with STATUS: blocked, severity critical. Touch nothing further.

Hard rules:
- Smallest diff that satisfies the task. No drive-by refactors, no scope creep.
- No new dependencies without a class-B stop.
- Never edit scripts/gate.sh, .claude/**, package.json, or lint/type configs (hook-blocked; a needed config change is class B).
- Run shell commands one at a time. Chained commands (&&, ;, |) are outside the auto-approval policy and will stall the run.
- Leave no scaffolding: no transitional flags ("isXReady"), no commented-out code, no debug logging, no TODO for work inside your own chain. Temporary means deleted before done.

Report format (mandatory, nothing after it):

CHAIN: <id>
STATUS: complete | blocked | failed-gate
TASKS: <n>/<m> done — list undone ones with one-line reasons
GATE: PASS | FAIL(<which checks>)
DEVIATIONS: none | [A|B|C] what, why, where (one line each)
CONTRACT: <path written> | none
FILES TOUCHED: paths only
NOTES FOR DISPATCHER: ≤5 lines, only what changes their next decision
```

### `.claude/agents/reviewer.md`

```markdown
---
name: reviewer
description: Read-only diff auditor. Invoked by the orchestrator when an implementer report needs verification, and once per change on the full diff before it is declared done.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You audit diffs against claims. You never modify anything; Bash is for read-only commands (git diff, git log, grep) only.

Input: a chain report (or a whole change) and a git ref range. Procedure:
1. Read the diff: git diff <range>.
2. Check the report against reality: does FILES TOUCHED match? Are claimed-done tasks actually implemented? Are claimed tests real assertions of spec scenarios, or tautologies?
3. Check the diff against the spec excerpts you were given: conformance, not taste.
4. Scan for the garbage class: transitional flags, conditions that are now constant, scaffolding left behind, debug residue, code with no caller.

Verdict format:

VERDICT: clean | findings | report-mismatch
REPORT HONESTY: matches diff | discrepancies: <list>
FINDINGS: (file:line — severity high/med/low — what — why it matters)
SPEC CONFORMANCE: conforms | gaps: <list>

report-mismatch is the most serious verdict. Flag it even when the code itself is fine.
```

### `.claude/agents/critic.md`

```markdown
---
name: critic
description: Daily code quality critic. Finds and documents problems across recent changes. Never fixes anything. Run via /critic-run.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior engineer doing a cold-eyed daily read of recent work. You are paid to complain precisely. You do not fix anything — read-only Bash (git, grep) only — and you do not soften.

Scope: everything since the marker the caller gives you (a git ref or "the last report in openspec/critic/"). Read the diff, then read the surrounding code where the diff lands — problems live at the seams.

You file findings in these categories:
1. DEAD PATTERNS — code whose reason has expired: always-true guards, transitional flags, migration shims for finished migrations, unreachable branches.
2. SCAFFOLDING RESIDUE — debug logging, commented-out code, TODO-that-was-done, copy-paste fossils.
3. SPEC DRIFT — code that quietly does more/less/other than the governing spec in openspec/specs/.
4. STRUCTURAL SMELL — wrong-layer logic, duplicated near-identical code, an abstraction that 2+ chains have now worked around.
5. REAL-BUT-HARD — genuine problems that are NOT trivially fixable. This is the most valuable category. "Hard to fix" is a property of a finding, never a reason to omit it. If you catch yourself thinking "it's not really a problem because fixing it is invasive," write the finding and say exactly that.
6. STALE MAPS — docs/capabilities.md or specs that no longer match reality.

Report → openspec/critic/<YYYY-MM-DD>.md:

# Critic report <date>
Scope: <ref range>, <n> commits, <m> files
## Findings
### [severity: high|med|low] <one-line title>
- Where: file:line
- Category: <1–6>
- What: precise description
- Why it matters: consequence if left
- Suggested approach: sketch only — you do not implement
## Patterns worth a tripwire
Recurring garbage that scripts/gate.sh's grep section or a lint rule could catch mechanically. Be specific enough to paste.
## Not findings
≤3 things you considered and rejected, so the human knows you looked.

Caps: 15 findings max, ordered by severity. If you found more, say "N additional low-severity findings omitted" — do not pad, do not flood.
```

-----

## 5. Context chains

Chains are a **planning output**, produced right after `tasks.md`, stored as `chains.md` in the change folder. The proposer (Fable) writes them; the dispatcher just executes them.

### Grouping rules (these go in the proposer’s head, see §6)

- A chain = tasks that **share working context**: same layer, same files, same vocabulary. Backend chain, frontend chain, persistence chain.
- Size: 3–7 tasks, or roughly ≤800 lines of expected diff. Smaller is better than bigger — your own research doc’s strongest empirical finding is that small, focused units get merged and big ones get abandoned.
- A chain must be completable using only: the spec excerpts named in its block + contracts from earlier chains. If a task needs “whatever chain 1 happened to learn,” that knowledge must be promoted into the contract — otherwise the partition is wrong.
- Chains are sequential by default. Parallel chains (worktrees) are a later upgrade; don’t start there.

### `chains.md` template

```markdown
# Context chains: <change-id>

## chain-1: backend-<name>
- tasks: 1.1–1.4
- rationale: all touch the splitter service + storage schema
- reads: specs/tip-splitter/spec.md §2–3; handoff: none
- writes-contract: handoff/backend-api.md

## chain-2: frontend-<name>
- tasks: 2.1–2.3
- rationale: UI layer only, consumes backend via contract
- reads: specs/tip-splitter/spec.md §4; handoff/backend-api.md
- writes-contract: none
```

### Contract rules (`handoff/*.md`)

A contract is the *fraction of a chain’s context the next chain actually needs*, made into a file — nothing else.

```markdown
# Contract: backend-api (chain-1 → chain-2)
## Endpoints / entry points
signature, params, return type — exact
## Types
the shared types, verbatim
## Invariants
what callers may assume; what they must never do
## Errors
how failure is surfaced
```

Hard cap 60 lines. A contract is an interface, not a diary — no narration of how chain-1 did its work.

-----

## 6. Commands

### Proposal flow (Fable session) — exploration policy, not a new command

Add to your project `CLAUDE.md` (or `AGENTS.md`, whichever OpenSpec wired up):

```markdown
## Exploration policy
- The main thread NEVER crawls the codebase. If orienting requires reading more than 3 files, dispatch the `researcher` subagent and work from its digest. This applies with full force to all /opsx:* planning phases.
- Always read docs/capabilities.md first and pull only the specs it points to.
- During /opsx proposal/design: the researcher returns its digest as its final message (it has no Write tool); copy that into openspec/changes/<id>/research.md and cite it in design.md.

## Chain planning
After tasks.md is written, produce chains.md in the change folder: group tasks into context chains per the rules in any existing chains.md or, failing that: 3–7 tasks per chain, grouped by shared files/layer, sequential, each chain readable from spec excerpts + declared contracts only. Declare a writes-contract for every chain whose outputs a later chain consumes.
```

Your Fable ritual becomes: open session → `/opsx:propose <idea>` → Fable dispatches researcher, gets a digest, writes proposal/design/tasks/chains → you read the proposal and chains (this is where your reading time goes now) → kill the session. Target: session dead under 60k tokens.

### Phased TDD across chains — the greenBy harness (reusable mode)

**When you need it.** A change builds one test suite incrementally across several chains, but that suite is enumerated in `gate.sh` so it runs on *every* chain. Strict TDD wants the whole assertion corpus written first (before implementation can teach-to-the-test), yet a chain that leaves an assertion red fails its own gate and stalls the dispatch. greenBy reconciles the two: write all the tests up front, but schedule *when each must be green*.

**The mechanism** (reference implementation + full contract: `static-check-pipeline/handoff/greenby-harness.md`):
- Each test is tagged `greenBy: <chain>` on a small home-grown harness (extends the house `test(name, fn)` helper — there is no shared test framework; copy the ~30-line harness into the suite).
- The runner reads an **untracked** `<suite>/.phase` file holding one chain id. `.phase = N` ⇒ tests with `greenBy ≤ N` are *required*, later ones are tolerated *pending*; **`.phase` absent ⇒ strict** (all required). A not-yet-due test that passes early is an **XPASS** — reported, never swallowed, because a test green before its code exists is probably vacuous (same ethos as the invariants negative control).
- Exit non-zero **iff a due test fails**. Strict makes everything due, so nothing can pend forever.

**Dispatcher protocol** (the one new orchestrator duty): before dispatching chain N, `Write` `<suite>/.phase = N` (main tree); **delete `.phase` before the final `./scripts/gate.sh` (step 7)** so that run — and CI's fresh checkout — is strict. Add `<suite>/.phase` to `.gitignore` in the change's human-bootstrap pass so it never reaches a commit or CI.

**Why a file, not `CHECKS_PHASE=…`.** `bash-policy.sh` auto-allows commands anchored at their start (`./scripts/gate.sh`); an env-assignment prefix matches nothing and would stall a subagent on a permission prompt it can't answer. The file lets the implementer run the plain, already-allowed gate. Fail-closed: a missing `.phase` yields strict, never a silent skip.

**Don't confuse this with the fast/full gate split.** `gate.sh` vs `gate-full.sh` is cost-based (Metro/Chromium deferred), and `gate-full.sh` *runs* `gate.sh` — so a suite can't be made "final-only" by moving gate files. Completeness-over-time is what `.phase` encodes instead.

**Optional harness edit:** add a line to `.claude/agents/reviewer.md` asking the reviewer to confirm each promoted/ XPASS test is non-vacuous — the one part of "did the schedule stay honest" a machine can't check.

### `.claude/commands/dispatch.md`

```markdown
Implement the OpenSpec change "$ARGUMENTS" by orchestrating implementer subagents. You are the dispatcher: you manage, adjudicate, and log. You do not implement, and you do not read implementation files unless adjudicating a deviation.

Setup:
1. Read, from openspec/changes/$ARGUMENTS/: proposal.md, design.md, tasks.md, chains.md, research.md if present. If chains.md is missing, create it per the chain rules in CLAUDE.md before doing anything else, and show it to the user for a quick OK.
2. Create or open progress.md in the change folder.

Per chain, in order:
3. Assemble the chain block: chain id; its task list verbatim from tasks.md; ONLY the spec sections its chains.md entry names (excerpt them — do not hand over whole files); paths of contracts it reads; the contract it must write, if any.
4. Dispatch ONE implementer subagent with that block.
5. On report:
   - STATUS complete + GATE PASS → append to progress.md (chain, tasks done, deviations, contract path, timestamp). Continue to next chain.
   - Class-A deviations → log them, continue. If the same class-A pattern appears in 2+ chains, note it in progress.md under "tripwire candidates".
   - STATUS blocked, class B → adjudicate. You may: answer from the spec/design, amend the chain block and redispatch a FRESH implementer, or amend chains.md. If adjudication requires reading the actual diff, dispatch the reviewer rather than reading it yourself. If the deviation invalidates the proposal, STOP and surface to the user.
   - STATUS blocked, class C, or failed-gate persisting after one redispatch → STOP EVERYTHING. Write a halt summary to progress.md and tell the user: what halted, why, what you recommend. A critical finding surfaced early is a success, not a failure.
6. Trust exit codes and the reviewer over prose. An implementer's "all good" is a claim; GATE: PASS is evidence.

After the last chain:
7. Run ./scripts/gate.sh yourself once on the full tree.
8. Dispatch the reviewer on the whole change's diff range with the change's spec excerpts. report-mismatch or high-severity findings → convert into a fix chain and dispatch it through the normal pipeline.
9. Append a closing summary to progress.md: chains run, redispatches, deviations by class, reviewer verdict. Tell the user the change is ready for their skim of progress.md + the proposal — not the diff.
```

### `.claude/commands/critic-run.md`

```markdown
Dispatch the critic subagent over everything since the last critic report (openspec/critic/ — newest file's ref; if none, the last archive tag; if none, ask me for a ref). Give it the ref and the report path openspec/critic/<today>.md. When it finishes, summarize for me: finding count by severity, the high-severity titles, and any "patterns worth a tripwire" verbatim. Do not act on findings — I triage them.
```

Your triage ritual: read the report over coffee, approve findings, then either fix the trivial ones yourself or say “turn approved findings 1, 3, 4 into an OpenSpec change” — and they flow through the normal propose→dispatch pipeline like any feature. Tripwire suggestions go into `gate.sh` by your hand (the hook stops agents from doing it, by design).

-----

## 7. Daily rhythm

```
Morning   /critic-run → triage over coffee → tripwires into gate.sh, real findings into a cleanup change
Planning  Fable session per change: /opsx:propose → read proposal + chains.md → kill session
Build     claude --model opus → /dispatch <change-id> → walk away; return on halt or completion
Evening   skim progress.md files; spot-check ONE chain report against its diff (keeps everyone honest, costs 5 minutes)
```

Your reading budget, redistributed per your research doc: front-load it into proposals and chains.md (decisions), spot-check reports (trust calibration), read critic output (residue). You stop reading implementations.

-----

## 8. Rollout plan

**Day 1 — plumbing.** Create the files above on Whim. `chmod +x` the scripts and hooks. Verify: `eslint` runs type-aware with `no-unnecessary-condition` on, `knip` is configured, `./scripts/gate.sh` passes on a clean tree, and a deliberately planted `const ready = true; if (!ready) return;` fails it. Hooks need `jq` installed. Then the no-stall test: dispatch a throwaway implementer with a one-line task and confirm it runs `./scripts/gate.sh`, `git add`, and `git commit` without a single permission prompt — if anything prompts, the allowlist isn’t inheriting on your version and `bash-policy.sh` isn’t matching; fix the pattern before trusting an unattended run.

**Day 2–3 — one small change end to end.** Pick something real but small (a tip-splitter increment, 2 chains max). Run the full loop. You’re watching for: gate runtime (<2 min), whether the implementer’s report matches its diff (check manually this once), whether the SubagentStop hook actually bounced it at least once (plant a failure if needed).

**Week 1 — calibrate.** Tune chain size (if implementers keep going class-B, chains are too big or contracts too thin), grow the tripwire list, fix report-format drift by tightening the agent prompts.

**Week 2 — start the critic cadence** and begin tracking two numbers per change: total tokens (rough, from usage) and dispatcher adjudications per chain.

**The demotion test.** When adjudications drop below ~1 per 3 chains for a couple of changes, run a routine change with the dispatcher on Sonnet (`claude --model sonnet`, same command). If outcomes hold, Opus becomes the dispatcher only for gnarly changes, and your cost curve drops again. This is the harness-first thesis paying out: a strong gate lowers how smart the orchestrator must be.

**Explicitly later, not now:** parallel chains in worktrees (runtime-state isolation is the unsolved tax — your doc, §open questions), Codex as overflow lane (artifacts are already portable when you want it), doc-gardening agent (the critic’s category 6 covers the need at your scale).

-----

## 9. Failure modes and the dial that fixes them

|Symptom                                 |Diagnosis                                          |Dial                                                                                                                                                                                        |
|----------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Subagent stalls mid-chain, no error     |Permission prompt it can’t surface / you didn’t see|Check the command against `bash-policy.sh` patterns; add the missing vocabulary to BOTH the hook and `permissions.allow`; re-check after Claude Code updates (inheritance regressions recur)|
|Implementer “passes” by weakening a test|Gate gaming                                        |Reviewer checks tests against spec scenarios (already in its prompt); protect-hook already blocks config edits; add the gamed pattern as a tripwire                                         |
|Same chain blocks twice on class B      |Chain too big or contract too thin                 |Split the chain; promote the missing knowledge into the upstream contract                                                                                                                   |
|Reports turn into essays                |Format drift                                       |Tighten implementer prompt: “nothing after the report block”; reject malformed reports by redispatching                                                                                     |
|Hook bounces an agent forever           |Unfixable-within-scope gate failure                |Attempt cap already releases it after 2 bounces → failed-gate → dispatcher halts; that’s working as designed                                                                                |
|Critic floods with nitpicks             |Severity inflation                                 |The 15-finding cap is the backstop; if it persists, add “low-severity findings require a concrete consequence” to its prompt                                                                |
|Contracts bloat past 60 lines           |Diary creep                                        |Reject at dispatch time: dispatcher excerpts, never forwards whole files                                                                                                                    |
|Dispatcher starts reading code          |Orchestrator scope creep                           |It’s in its prompt; if Opus keeps doing it, that’s a sign chains.md rationale fields are too vague to adjudicate from                                                                       |
|Fable session balloons again            |Exploration leak                                   |Check /context; if Messages is fat, the researcher policy isn’t firing — make the CLAUDE.md rule more imperative (“MUST dispatch researcher”)                                               |

-----

## 10. What you’ll have

Fable thinks in a 50k-token room instead of a 170k one. Opus reads reports and exit codes instead of diffs. Sonnet does the volume work one chain at a time with a mechanical definition of done it cannot edit. Garbage gets caught three times — gate (mechanical), reviewer (per change), critic (daily, including the unfixable-but-real category that a fix-it agent would bury). And every artifact that matters is markdown in the repo, so none of it is hostage to any one tool.