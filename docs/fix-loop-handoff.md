# Fix-Loop Harness — Handoff

**For:** a fresh-context agent (or future me) continuing the parallel fix-loop harness work.
**Date:** 2026-06-27. **Branch:** `dev/v1`. **HEAD when written:** `fb2fdd8`.
**Read this, then read [`parallel-fix-loop.md`](./parallel-fix-loop.md) (the spec/source-of-truth) and [`coding-harness-diagram.md`](./coding-harness-diagram.md) (the diagrams).**

> ✅ **Update 2026-06-29:** both original blockers are resolved — (1) the human reviewed + committed the driver files (§3); (2) the human read the security findings (§6) and decided. The two Threat-B gaps and the memory-handoff design are now **implemented** (see §6 + `parallel-fix-loop.md` §4.7/§4.8/§6.6). **New uncommitted batch pending commit** — see §3. The only thing still on the human is the **sandbox decision** (`sandbox.enabled: true`, §6.1) — Threat C stays open until then.

---

## 1. What this is & why we did it

Goal: make Whim's AI-coding harness **reliably run quality work in parallel with subagents**. We started with the *particular* — a parallel loop for mechanical **fixes** (the ~47 fix-fest / critic findings) — to prove the pattern before generalizing it to the whole OpenSpec build loop (`/opsx:*` → `/dispatch`).

The harness was built for *attended, sequential, single-tree, human-commits* work and was being pushed toward *unattended, parallel, multi-worktree, agent-commits*. Almost every failure traced to that mismatch.

## 2. Problems we diagnosed and fixed

| Problem | Fix |
|---|---|
| **git did double duty** — VCS *and* the tamper oracle (`git diff HEAD -- config`). Once an agent can commit, it can hide a tampered config (HEAD==tree → no diff → green). | **Decouple via pinned BASE.** The orchestrator records `BASE = rev-parse dev/v1` at worktree creation; every integrity question is `git diff <BASE>`, never `vs HEAD`. A commit can't move a recorded SHA. Git's content-addressing *is* the baseline — no hash manifest needed. |
| **Verification couldn't run isolated** — old worktrees lived in `/tmp` with symlinked `node_modules`; toolchain didn't resolve. | **Worktrees under `.claude/worktrees/`** — Node resolves the repo's `node_modules` by walking *up*; toolchain Just Works in-repo. (Spike-proven.) |
| **Isolation worktrees branched from a stale base** (`origin/main`, an ancient commit). | **`worktree.baseRef: "head"`** in `.claude/settings.json` — branches from local HEAD (dev/v1). Re-test confirmed fresh base + green gate. |
| **`src/runtime/generated/*` + `build/generated/*` are gitignored** → a fresh worktree lacks them → typecheck/metro/invariants fail. | Run **`npm run build` once at worktree setup** (~0.3s). The fix-worker does this first. |
| **Monolithic ~15s gate** runs `build`+Metro+Chromium every attempt; bad under N parallel worktrees. | **Gate split**: `gate.sh` (FAST: build+typecheck+lint+node suites+tripwires) for the inner loop; `gate-full.sh` (FULL: +knip/metro/invariants/bridge/deliver/openspec) once per fix pre-merge. |
| **Subagent git was blanket-denied** → couldn't commit → no red-check. | **Scoped git** in `bash-policy.sh`: a subagent (`agent_id` set) may add/commit/checkout/etc. *only* when `cwd` is under `.claude/worktrees/`; network/shared-ref/history git hard-denied for all. |

**Proven by spikes (2026-06-26/27):** toolchain resolves in in-repo worktrees; `build` ≈0.3s; pinned-BASE diff shows a change even after the agent commits (HEAD-diff is empty — the old bug); a real subagent's `git add`/`commit` in its worktree are allowed and `git push` denied; the red-check correctly flags vacuous tests; subagents resume in-context via `SendMessage`.

## 3. Current state — COMMITTED vs UNCOMMITTED ⚠️

**Committed (in `fb2fdd8` and earlier):** `scripts/gate.sh` (fast), `scripts/gate-full.sh` (full), `.claude/hooks/bash-policy.sh` (scoped-git base), `.claude/hooks/protect-harness.sh` (gate-full protection), `.claude/settings.json` (`worktree.baseRef: head`), and the docs.

**The orchestrator driver is now COMMITTED** (human did this 2026-06-29): `scripts/fixloop.sh`, `.claude/agents/fix-worker.md`, `.claude/commands/fix-loop.md`, and the bash-policy/protect-harness additions for it.

**NEW UNCOMMITTED batch — the Threat-B + memory-handoff implementation (this session, 2026-06-29):**
```
 M scripts/fixloop.sh            # + `gatefull` subcommand (fresh-checkout gate); `build` in PROTECTED
 M scripts/gate.sh               # + `build` in the tamper tripwire (refuse to run/execute tampered build code)
 M .claude/hooks/bash-policy.sh  # + build/ in the protected-write regex
 M .claude/hooks/protect-harness.sh  # memory: subagent-deny / main-ask; build/ protected (incl. worktree carve-out)
 M .claude/agents/fix-worker.md  # never-touch build/**; MEMORY: report field; no direct memory writes
 M .claude/commands/fix-loop.md  # step 6 → fixloop.sh gatefull; end-of-run memory-apply step
 M docs/parallel-fix-loop.md     # §4.7 (hermetic gate) + §4.8 (memory) + §6.6; PROTECTED/§5/§5.1 updates
 M docs/fix-loop-handoff.md      # this file
```
Suggested commit message:
`harness: close Threat-B gaps (build/ protected, fresh-checkout gate-full) + memory propose-via-report handoff`

> 🚨 **Until these are committed, `./scripts/gate.sh` will REFUSE to run** — its pinned-BASE tripwire watches `.claude/hooks` + `scripts/gate*.sh` + (now) `build/`, which are currently dirty. By design. Commit first, then the gate runs.
> Note: editing `scripts/fixloop.sh` doesn't change its exec bit — it was already committed `+x`. No `chmod` needed this time.

## 4. The artifacts (where everything lives)

- **`docs/parallel-fix-loop.md`** — the spec & build plan (source of truth). §4 mechanisms, §5 procedure, §5.1 implementation, §6 the applied config changes, §7 open items, §8 generalization.
- **`docs/coding-harness-diagram.md`** — mermaid diagrams (pipeline, fan-out, salvage).
- **`scripts/fixloop.sh`** — orchestrator toolkit. Subcommands: `integrity <branch> [allowlist]` (exit 0 ok / 3 protected-touch / 4 scope-violation), `redcheck <branch> <test…> -- <prod…>` (exit 0 RED-good / 5 vacuous-GREEN), `park <branch> <reason>`, `finish <branch>` (prints the human-gated merge, never executes it), `status`. Recovers BASE via `git merge-base <branch> dev/v1`.
- **`.claude/agents/fix-worker.md`** — the fixer (dispatch with `isolation: worktree`): builds → smallest fix + non-vacuous test → self-gates → commits → reports `TEST` + `PROD FILES`.
- **`.claude/commands/fix-loop.md`** — `/fix-loop` runbook the orchestrator (main thread) follows.
- **`.claude/hooks/`** — `bash-policy.sh` (PreToolUse Bash), `protect-harness.sh` (PreToolUse Edit/Write), `gate-on-subagent-stop.sh` (SubagentStop). `.claude/settings.json` registers them + permissions + `worktree.baseRef`.
- **Memory:** `whim-parallel-fix-loop` (load-bearing gotchas) in the project memory index.

## 5. What's validated

- Both gates green on `dev/v1` (fast + full, all suites + Metro + Chromium invariants + openspec).
- `fixloop.sh`: all 6 exit-code paths unit-tested (integrity ok/3/4, redcheck red/vacuous, park, status).
- Hooks: scoped-git 14-case matrix + fixloop protections 7-case matrix; protect-harness 3-case.
- End-to-end dry run: real subagent commits in its worktree on a fresh base, builds, `FAST GATE PASSED`; orchestrator-side red-check + BASE-diff integrity proven.
- **Not yet done:** a real-finding shakeout through `/fix-loop` (next step).

## 6. The security question the human raised — RESOLVED 2026-06-29 (sandbox still pending)

**The observation (correct):** `bash-policy.sh` only filters the *top-level* command string. A subagent can bypass it by writing a script and running it (the inner command isn't re-hooked) — also via `edit build.mjs + npm run build`, `echo|base64|sh`, or just authoring code we then execute on purpose. So the hook is a **guardrail, not a sandbox.**

**My analysis (in chat; human will read in the morning):** decompose by threat —
- **A (honest mistakes):** the hook handles it.
- **B (reward-hacking / land bad code):** contained by the **output boundary** — immutable diff + orchestrator-run `integrity`/`redcheck`/`gate-full` out-of-band, in a context the agent can't touch. Robust. The agent self-hacking its own gate is pointless (orchestrator re-verifies).
- **C (malice / arbitrary execution):** only the **OS sandbox** can contain this — you can't prevent code execution in a system whose job is running code.

**Key fact confirmed:** Claude Code HAS an OS sandbox (Seatbelt/bubblewrap), **process-tree-wide** (so it *does* defeat the script-bypass), but it is **OFF here** (no `sandbox` key in project or user settings). So right now the bypass is unguarded at the OS level.

**Decisions — RESOLVED 2026-06-29:**
1. **`sandbox.enabled: true` — STILL PENDING THE HUMAN** (the proportionate fix — right layer; closes Threat C). Tuning when enabled: deny credential reads (`~/.ssh`, `~/.aws`, `.env`); network is prompt-gated (autonomous subagents can't approve → effectively no egress); writes confined to workdir+temp. The fix-loop itself is sandbox-compatible (all offline/in-repo). Recommend enabling **before any unattended/scaled run**. (The human must do this — it's session-wide, set at start, and settings self-mod is blocked for the agent.)
   - **Correction to the earlier caveat:** the memory-dir worry was **wrong for the Write/Edit tools** — they **bypass the OS sandbox entirely** (only Bash subprocesses are sandboxed; confirmed via claude-code-guide). So `sandbox.enabled` does NOT break memory writes done via the tools, and **no memory allow-list is needed**. The new memory design (below) gates memory on the *permission prompt*, not the sandbox.
2. **Two Threat-B gaps — DONE (implemented 2026-06-29).** (a) `build/` added to the PROTECTED set across `fixloop.sh` integrity, the `gate.sh` tamper tripwire, `bash-policy.sh`, and `protect-harness.sh` (with a worktree carve-out). (b) `gate-full` now runs in a **fresh checkout** via the new `fixloop.sh gatefull <branch>` — see `parallel-fix-loop.md` §4.7. The fresh-checkout limit (shared `node_modules` = Threat C) is documented; it needs the sandbox.
3. **Memory handoff — DONE (implemented 2026-06-29; human chose orchestrator-applies-with-prompt over human-copy-paste).** Subagents never write the memory store (hook-denied); they propose in the report's `MEMORY:` field; the orchestrator applies via Write/Edit, which prompts the human with the full diff. Main-thread memory writes are routed to `ask`. See `parallel-fix-loop.md` §4.8. (Rationale also covers a real race: N parallel fixers appending to the single `MEMORY.md` index.)

## 7. Next steps (in order)

1. **Human:** ✅ done — driver files committed.
2. **Human:** ✅ done — §6 decided. The two B-gaps + memory handoff are implemented (commit the §3 new batch). **Remaining:** decide on `sandbox.enabled: true` (§6.1) before any unattended/scaled run — it's the only thing closing Threat C.
3. **Real-finding shakeout:** pick one of the ~47 mechanical fix-fest findings (see `docs/fix-fest-handoff.md` §2 scoreboard) and run `/fix-loop` end-to-end with real planner/fix-worker/reviewer agents. Shake out the runbook before scaling.
4. **Scale** to a small batch (2–3), then the rest.
5. **Generalize** to the OpenSpec build loop (`parallel-fix-loop.md` §8): pinned-BASE in `/dispatch`, per-chain worktrees, gate split, scoped git — reusing the same primitives.

## 8. Non-obvious facts — do NOT re-derive these

- **Worktrees go under `.claude/worktrees/`** (never `/tmp`) — that's what makes the toolchain resolve.
- **`worktree.baseRef: head`** is mandatory for isolation worktrees to branch from dev/v1 (else stale `origin/main`).
- **Generated files are gitignored** → a fresh worktree must `npm run build` before typecheck/metro/invariants.
- **Pin to BASE, never HEAD** — the whole tamper-detection rework hinges on this.
- **Git run *inside* a script does NOT re-trigger the Bash hook** → `fixloop.sh` is privileged/orchestrator-only (agents are denied running, writing, and editing it). This is also the root of the §6 bypass.
- **Subagents reach a worktree ONLY via `isolation: worktree`** — they can't `cd` (not auto-allowed) and the Agent tool has no cwd param.
- **`PreToolUse(Bash)` input** carries `cwd` always; `agent_id`/`agent_type` only for subagents (main thread = absent). That's the scoped-git signal.
- **The main thread CAN write protected files** (auto-mode allows; protect-harness only hard-blocks subagents) — EXCEPT `.claude/settings.json`'s permissions/sandbox block, which the **auto-mode classifier blocks as self-modification**. So settings changes are human-applied.
- **Background subagents can't answer permission prompts** → they can only run hook-allowed/auto-allowed commands; a "FALLTHROUGH/ask" effectively blocks them.
- **The OS sandbox (Seatbelt/bubblewrap) wraps ONLY Bash subprocesses — the Write/Edit tools bypass it entirely** (they go through the permission system). So `sandbox.enabled` never breaks Write/Edit file ops (incl. memory-dir writes); it's no defense against the script-bypass's *file writes* either — but it IS process-tree-wide for Bash, so it defeats Bash-launched arbitrary execution. To allow-list a path for the *tools*, use an `Edit(...)` permission rule, not the sandbox `allowWrite`.
- **Testing hooks:** pipe sample JSON from a *file* (so trigger words like `git push`/`sudo`/protected paths don't appear in the command text and trip the live hook). Examples in `$CLAUDE_JOB_DIR/tmp/` (ephemeral) — re-create as needed.
- **The fix-worker must run one shell command per call** (chained `&&`/`;`/`|` fall outside policy and stall).

## 9. Ratified decisions — do NOT re-litigate

- **Orchestrator = main-thread async-Agent driver, NOT a Workflow script** — so fixers resume in-context via `SendMessage` (Workflow `agent()` is one-shot).
- **Orchestrator never self-approves** a protected-file change — it detects, refuses to merge, and **escalates to the human**.
- **Reject ≠ delete:** PARK (rename `fix/<id>` → `wip/<id>` + reason note); branches are resumable.
- **Bounded autonomy, then escalate — never silent-drop.** Caps: verifier revisions ≤ 2; one extended attempt on a gate cap-hit; then PARK. Merges are serialized (one writer to dev/v1). High-severity + any protected touch → human ratifies.
- **Red-check / integrity / gate-full run out-of-band** in the orchestrator's trusted context (the agent can't fake them).
- **gate-full runs in a FRESH CHECKOUT, never the fixer's worktree** — the integrity diff attests only to *tracked* content, but the gate executes against the whole tree; untracked/gitignored files (poisoned generated/* or build/ output) are the gap. `fixloop.sh gatefull` materializes exactly the committed tree so "verified == tested". (Limit: shared `node_modules` is Threat C → sandbox.)
- **`build/` is PROTECTED** — subagent-writable *and* executed by `npm run build`, so tampering runs code inside the gate. Protected across integrity + tamper-tripwire + both hooks (with a worktree carve-out).
- **Memory is propose-via-report, orchestrator-applies-with-prompt** — subagents never write the store (hook-denied; also avoids the N-fixer `MEMORY.md`-index race); they put facts in the report `MEMORY:` field; the orchestrator applies via Write/Edit (full-diff prompt). Human chose this over manual copy-paste.
- The SubagentStop hook does **not** gate worktree fixers (it inspects the main tree, which stays clean) — the fixer self-gates and the orchestrator runs the full gate. No change needed.

## 10. Source material

`docs/parallel-fix-loop.md` (spec), `docs/coding-harness-diagram.md` (diagrams), `docs/harness-build-guide.md` (the intended OpenSpec roles), `docs/fix-fest-handoff.md` (the ~47 findings + failure catalog these changes close), and `CLAUDE.md` (project ground rules). Memory: `whim-parallel-fix-loop`, `whim-build-harness`, `background-agents-cant-execute`.
