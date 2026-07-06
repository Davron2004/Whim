# Critic Fix-Fest — Handoff

**Status as of 2026-06-19.** Working branch `dev/v1` (pushed to remote `v1`). The git tree is **clean** — all work below is committed and pushed.

This document is the durable memory for the "fix-fest": systematically fixing the findings from the first foundational critic run. If you're picking this up, read this whole file first. **Asking the user clarifying questions is encouraged** — this handoff exists to save re-explaining context, not to make you proceed silently. When in doubt, ask.

---

## 1. What this work is

A whole-repo critic pass produced a foundational report. The user wants every finding triaged into lanes and then **fixed through a multi-agent loop that is deliberately resistant to reward-hacking** (the agent that fixes a bug must never be the agent that judges whether it's fixed). We are now executing that fix loop, finding by finding.

### Source-of-truth files (read these)
- **`openspec/critic/2026-06-18.md`** — the foundational critic report. Full untruncated problem text for all 89 findings. This is the baseline that anchors future critic runs.
- **`openspec/critic/2026-06-18-triage.md`** — the ratified cut-list + lane assignment + **per-finding `acceptance_criterion`** (objective, testable "done"). This is the contract each fix must satisfy. **Pull the acceptance criterion + full problem text from here when starting any finding.**
- **`openspec/critic/2026-06-18-protected-file-patches.md`** — the 13 protected-file patches (all applied + committed earlier this session).
- **`docs/backlog.md`** — has the C2 deferred entry (orphaned loose git objects; ratified wontfix-for-now).
- This file (`docs/fix-fest-handoff.md`).

### Lane counts (from the triage)
`mechanical-fix 52 · openspec-behavioral 7 · protected-file-human 13 · defer 15 · wontfix 2`. Adjudicator-recalibrated severities: **10 high / 33 med / 46 low**.

---

## 2. Scoreboard — what's done, what's left

### ✅ DONE
- **Protected-file-human lane (13 patches)** — applied + committed earlier this session. Includes the harness/config edits (gate.sh consolidation, CI `npx openspec validate`, `@fission-ai/openspec` devDep, knip `contract` workspace, hook path fixes, etc.) and the C2-documented-as-deferred entry in `docs/backlog.md`.
- **The 4 high-severity mechanical findings — ALL LANDED on `dev/v1`:**
  - **D1** (`5cb6176`) — `storage-engine/schema.ts`: `validateArtifact()` now rejects a field/collection **display name `'id'`** (it would overwrite the engine-assigned primary key in `list()`). + `§D` tests.
  - **C1** (`01570b3`) — `version-store/engine.ts`: wrap the best-effort `compactRepo()` in `snapshot()` in `try/catch` so a compaction failure can't **reject an already-durable snapshot**. + `§4 C1` test (`BrokenPackFs`).
  - **E1** (`df0ee75`) — `launcher/DevProbeScreen.tsx`: route the back button through `host.exit()` (was bare `onExit`, leaking the realm DB handle / leaving `alive=true`). + static-source regression test `dev-probe-back-button.test.ts`.
  - **A1** (committed + pushed by the user) — `runtime/web/loader.js`: add the `if (ev.source !== window.parent) return;` **host-channel-only guard** to the postMessage handler (mirrors `syscall.js:69`). Without it, a delivered bundle could self-post a forged `__whimDeliver` to bump `__whimGeneration`, inject a payload, and post a host frame carrying the closure-captured **real nonce** — a host-state-integrity violation (no sandbox escape). + new sandbox-isolation invariant probe `run-against-build.mjs` **scenario 3b** (with a built-in non-vacuity control + a verified red-without-fix proof).

Each of the 4 was verified with: the authoritative full `./scripts/gate.sh` **run in the main tree** + a **red-without-fix proof** (the test/probe fails when the production fix is reverted) before merge. The user reviewed each diff before it landed.

### ⏳ NEXT (not started)
- **~48 remaining mechanical-fix findings** (mediums/lows): `A2, B1, B2, B3, B4, C3, C5, D3, D4, D5, D6, D7, E2, E5, E6, F1, F3, G3, G6, I1, I2, I3, I5, I8`, and the rest of the lows. **Gated on the durable loop mechanism (Section 5) being built** — do NOT try to run these through the workflow loop until that's fixed, or you'll hit the failure modes in Section 4.
  - **`A2` is special**: `⚠ owner-authored test`, clustered with A1 (runtime/containment). Like A1, a feature-fixing subagent must NOT author its sandbox-isolation invariant — **the orchestrator (you) authors A2's guard + probe**, the user reviews. Same treatment A1 got.
- **openspec-behavioral lane (7 findings)** — e.g. `D2, A3/A4, C6, C7, B5`. These require a **behavior/contract decision**, so they route through `/opsx:propose` — the **human decides the behavior**, not the loop. Not started.
- **defer (15) + wontfix (2)** — no action. C2 already documented in `docs/backlog.md`.

---

## 3. The fix-pipeline design (the anti-reward-hacking loop)

**Core principle the user insists on:** *the context that fixes a bug must never be the context that judges it.* An agent rewarded for "marking fixed" will under-critique, bless its own workarounds, and weaken tests. So duties are split across fresh, incentive-aligned contexts:

| Role | Sees | Cannot | Why |
|---|---|---|---|
| **Planner** (read-only, e.g. `researcher`) | finding + acceptance criterion | implement | defines "done" + the regression-test assertion **before** the fixer starts, so the fixer can't redefine done |
| **Fixer** (`implementer`, isolated tree) | the plan | touch gate/config/other areas | bounded to the plan's files; must be gate-green; commits to `fix/<id>` |
| **Red-check** (separate context) | sha + which files are prod vs test | — | reverts the prod fix, keeps the test, **proves the test goes RED without the fix** — the crown-jewel anti-vacuous-test check |
| **Verifier** (`reviewer`, read-only) | finding + acceptance + the diff + gate result + red-proof — **NOT the fixer's reasoning** | ship on doubt | adversarial; rewarded for *catching* a bad fix; **default-REJECT** |
| **Orchestrator** (you / main thread) | structured verdicts only | **NEVER writes fix code** | deterministic fan-out; runs the loop; relays to the human |
| **Human** (user) | high-severity diffs | — | ratifies triage; reviews + approves merges of highs |

**Gating model the user chose:**
- **High-severity → "worktree branch review":** present `git diff` + verdict + red-proof, **merge only on the user's explicit per-fix go-ahead.** (We did this for D1/C1/E1; A1 too.)
- **Low/mechanical at scale → "lighter touch":** auto-merge on gate-green + adversarial-verify-accept, surfacing only failures. *(This is the plan for the ~47; revisit once the durable mechanism lands.)*
- **openspec-behavioral → `/opsx:propose`** (human decides behavior).
- **Owner-authored invariant tests** (jurisdiction A / sandbox-isolation, jurisdiction G) → the **runtime owner authors them, never a feature agent** (per CLAUDE.md). The user delegated A1's authoring to *you* (the orchestrator/main thread) with their review; same for A2.

**The two pieces of ground truth an agent can't sweet-talk:** (1) `./scripts/gate.sh` exit code, (2) a regression test proven to go red without the fix. Everything rests on these.

The pipeline LOGIC is **validated**: in run 1b it correctly **caught E1's vacuous test** (a test that re-implemented the exit sequence locally and stayed green when the production line was reverted) via the red-without-fix check, and the verifier rejected it. The design works; the *mechanism* (Section 4/5) is what needs fixing.

---

## 4. Failure modes already encountered + what we did

These are real, repeatedly-hit gotchas in THIS repo/harness. Don't relearn them the hard way.

### 4.1 Workflow `isolation:'worktree'` is NOT usable for landing fixes here ⚠️ (the big one)
The Workflow tool's `isolation:'worktree'` (and the Agent tool's worktree isolation) creates worktrees under `.claude/worktrees/wf_*` and has **two fatal problems in this session**:
- **Stale/frozen base.** The worktrees were seeded from an **ancient commit (`8826e0b` "worked on md files")** — *not* current HEAD, *not even* `main` (`main` = `6601ba3`; `dev/v1` is **20 commits / +23,227 lines** ahead of `8826e0b`). So fixers were editing against ~23k-lines-stale code. The base is opaque and we cannot pass the tool a base. It appears frozen for the session.
- **Unreliable commit.** The harness's auto-commit of worktree changes was inconsistent: run 1 produced committed `fix/*` branches; run 1b reported `sha == baseSha` (nothing committed) and left the work uncommitted in ephemeral worktrees.

**What we did:** abandoned the worktree loop for landing. We **transplanted the verified fix content onto current `dev/v1`** by hand and re-verified (full gate in the main tree + red-proof), then cherry-picked. This is the **hotfix mechanism**; the **durable fix is Section 5.** Do NOT run the remaining ~47 through `isolation:'worktree'` until Section 5 is built.

### 4.2 The `.claude/worktrees/` path collided with the guard hooks
`protect-harness.sh` blocked all writes to `*/.claude/*`, and `bash-policy.sh`'s `PROTECTED` regex matched `\.claude/` — so fixers' legitimate edits to `src/...` files **inside** a worktree (whose absolute path contains `.claude/worktrees/`) were blocked.
**What we did (committed in `b0fb25f` "unblocked worktrees from hook rejections"):**
- `protect-harness.sh`: added an exemption — `*/.claude/worktrees/*/.claude/*) ;;` (nested config stays protected) then `*/.claude/worktrees/*) exit 0 ;;` (ordinary repo files in a worktree allowed).
- `bash-policy.sh`: narrowed the blanket `\.claude/` to `\.claude/(hooks|settings|agents|commands)` so it no longer false-positives on `.claude/worktrees/`.
This **worked** (fixers could edit in worktrees afterward) — but it does NOT fix the base/commit problems in 4.1.

### 4.3 `/tmp` worktrees + symlinked `node_modules` break the toolchain
We tried gate-verifying a fix branch in a `/tmp/wv-*` worktree with a `node_modules` symlink. It failed: first `tsc: command not found` / `eslint: command not found` (npm didn't put `node_modules/.bin` on PATH through the symlink), then even with PATH forced, module resolution broke (`Cannot find @react-native/typescript-config`) — the macOS `/tmp`→`/private/tmp` realpath + symlinked `node_modules` confuses tooling.
**What we did:** **gate-verify in the MAIN repo** (real installed `node_modules`). For a fix on a branch off current HEAD, apply its files to the main working tree (`git checkout fix/<id> -- <files>`), run `./scripts/gate.sh`, then merge (`git merge --ff-only` or `git cherry-pick`). This is the proven-reliable path.

### 4.4 `git add -A` swept leftover worktree dirs into a commit
With stale `.claude/worktrees/wf_*` dirs on disk, `git add -A` added them as **embedded git repos**, polluting the commit. **Always use targeted `git add <specific files>`** for fix commits. Clean up stale worktrees first: `for w in .claude/worktrees/wf_*; do git worktree remove --force "$w"; done; git worktree prune` (note: the `fix/*` branch refs survive worktree removal).

### 4.5 `bash-policy.sh` hard-denies (for everyone) — substring traps
- `rm -rf /` is hard-denied **as a substring** — so `rm -rf /tmp/whatever` is ALSO denied (it contains `rm -rf /`). Avoid `rm -rf <absolute path>`; use `git worktree remove --force`, or `rm -f <relative>`, or remove specific files.
- Other hard-denies: `sudo`, `git push`, `npm install`, `npm uninstall`, `curl`, `wget`. `npm install` is on the **user** (suggest `! npm install`).
- **git for subagents is hard-denied; for the main thread it's "ask"** (you get a permission prompt). Read-only git (`status`/`diff`/`log`/`show`) is auto-allowed for everyone. This is *why* subagents can't commit their own work — see Section 5.

### 4.6 Background-task "exit 0" ≠ the gate passed
A backgrounded `./scripts/gate.sh > log 2>&1; echo "EXIT $?" >> log` reports the **trailing `echo`'s** exit (0) in the completion notification, masking the gate's real exit. **Always read the log tail** (`grep "GATE PASSED\|GATE FAILED\|EXIT"`) for the truth.

### 4.7 The gate's tamper tripwire blocks on dirty config
`./scripts/gate.sh` **refuses to run** (exit 2) if any of `package.json package-lock.json tsconfig*.json eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* scripts/gate.sh .claude/hooks .claude/settings.json babel.config.js metro.config.js` differs from committed HEAD. **Commit config/hook edits before gating.** Corollary: do NOT edit `.claude/hooks/*` while a gate is mid-flight (it would trip the tripwire on the next run). Sequence: gate → then edit hooks → commit → then gate again.

### 4.8 Generated-file noise
- `src/runtime/generated/**` and `build/generated/**` are **gitignored** (CI rebuilds from source). A1's commit was just the 2 source files; the build artifacts regenerate.
- `invariants/sandbox-isolation/bridge/.build-pages/*.html` are **tracked** and drift on every `bridge:invariants` run (per-run regen noise). They've been dirty since session start. **Leave them out of fix commits** (targeted add). *Minor cleanup candidate:* consider gitignoring them — but `.gitignore` / config changes are human-edited; ask the user.
- The Node acceptance runners leave `.vstore-acceptance.*.tmp.mjs` / `.launcher-acceptance.*.tmp.mjs` temp files — untracked junk; `rm -f` the specific file if it clutters `git status`.

### 4.9 Edit-tool preconditions
The Edit tool requires the file to have been read via the **Read tool** (not `cat`/`sed`/`grep`) in-conversation. Read the region first. Editing `src/` files (non-config) on the main thread needs **no approval**; editing `.claude/**` on the main thread prompts "ask" (subagent-scoped block does not apply to the main thread).

---

## 5. The durable mechanism we're designing (the user is leading this)

**Problem:** we need the parallel fix loop to run reliably — fixers on the **correct base** (current `dev/v1`) with their work **reliably committed** — without sacrificing parallelism or the role separation in Section 3. `isolation:'worktree'` gives neither (Section 4.1).

**The user's key insight (the design north-star):** subagents are git-banned not only to prevent interference / `dev/v1` corruption, **but because the harness hooks use git itself as the tamper-detection oracle** (`gate.sh`'s tripwire = `git diff HEAD -- <config>`; `bash-policy`'s "the human is the only committer" assumption). If you let an agent touch git, that oracle breaks (an agent could `commit` a tampered config so `HEAD == tree` → no diff → green gate). So:

> **Move tamper-detection off git: capture SHA-256 hashes of the gate + hook scripts at session start as the source of truth, and stop relying on `git diff` for tamper-detection.** Then a *scoped* git subset can be safely freed for in-worktree fixers.

**The mechanism that falls out (proposed, NOT yet decided):**
1. Free a **scoped git subset** for fixers operating **inside ephemeral worktrees** (`switch`/`branch`/`reset --hard <ref>`/`add`/`commit`/`restore`), while still denying `push`, `config`, protected-config writes, and any op on `dev/v1`/`main` refs.
2. The fixer **self-corrects the stale base**: first action is `git switch -C fix/<id> dev/v1` (worktrees share the ref store, so `dev/v1` resolves to the *current* tip regardless of the stale seed).
3. The fixer **self-commits** to `fix/<id>` (no more reliance on the tool's flaky auto-commit).
4. Tamper-detection no longer depends on git, so this is safe: the SHA-256 baseline catches gate/hook tampering; `protect-harness` still blocks config edits; the **authoritative gate runs in the MAIN tree at merge** (compares against `dev/v1`'s committed config); the verifier scope-checks; the human reviews highs.

**Open design decisions (for the user / to verify):**
- **What signal scopes the relaxed git permission?** Options discussed: (a) **by worktree location** — allow scoped git when the command's cwd is under `.claude/worktrees/` (clean boundary: "worktrees are the commit sandbox; the main tree is human-only"); (b) **by a dedicated `fix-worker` agent_type**; (c) **both, AND'd**. **Must first verify what the `PreToolUse(Bash)` hook input actually exposes** — does it carry `agent_type`? `cwd`? Current `bash-policy.sh` only reads `.agent_id`. A quick reversible probe: log the hook input JSON, run a trivial subagent, inspect, revert.
- Exact SHA-256-baseline implementation: where/when hashes are captured (session start), where stored, how `gate.sh` consumes them instead of (or alongside) the git tripwire.
- All of this edits **human-only files** (`.claude/hooks/*`, `scripts/gate.sh`) — **draft for the user's review + they commit** (the gate tripwire + the human-committer rule both require it).

**The user is actively thinking about this architecture** and will come back with a direction. Have the SHA-256-baseline + scoped-git design ready to detail around whatever they choose. **Ask them which scoping (a/b/c) they want and confirm the SHA-256 storage/consumption approach before writing hook edits.**

---

## 6. Key references

- **Gate:** `./scripts/gate.sh` (typecheck, lint, knip, build, metro-guard, invariants, bridge-invariants, vstore/storage/bridge/launcher/deliver/server tests, openspec validate, scaffolding tripwires). The mechanical definition of done. Human-edited only.
- **Hooks:** `.claude/hooks/bash-policy.sh` (PreToolUse Bash allow/deny), `.claude/hooks/protect-harness.sh` (PreToolUse Edit/Write config block, subagent-scoped), `.claude/hooks/gate-on-subagent-stop.sh` (gates `implementer` subagents on stop).
- **Real test suites:** `npm run invariants` (sandbox-isolation, headless Chromium — run `npm run build` first), `npm run bridge:invariants`, `npm run vstore:test`, `npm run storage:test`, `npm run bridge:test`, `npm run launcher:test`, `npm run server:test`. `npm test` is the unused RN jest template.
- **Workflow scripts authored this session** (under `.../<session>/workflows/scripts/`): `mechanical-fix-loop-batch1-*.js` (C1/D1/E1 first run), `mechanical-fix-loop-batch1b-*.js` (C1/E1 re-run). Reusable templates for the loop **once the mechanism is fixed** — they already encode plan→fix→red-check→verify with `agentType`/`schema`/`isolation`. They will need the base/commit changes from Section 5.
- **Containment runtime** (most sensitive; A1/A2 territory): `src/runtime/web/loader.js` (delivery + host-init handler; now has the `ev.source` guard), `src/runtime/web/syscall.js` (the guard pattern at ~line 69), `src/runtime/web/neutralize.js`, `probes.js`, `resolver.js`. The invariant suite `invariants/sandbox-isolation/run-against-build.mjs` is owner-authored — it has a negative control (broken-CSP) proving it isn't vacuously green; new probes must keep that discipline (build a non-vacuity control + a red-without-fix proof).

---

## 7. Suggested next actions (confirm with the user first)

1. **A2** — clustered with A1, `⚠ owner-authored test`. You (orchestrator) author the runtime guard + invariant probe (don't delegate to a fixer); the user reviews. Pull A2's full text + acceptance from `openspec/critic/2026-06-18-triage.md` + `2026-06-18.md`. This doesn't depend on the durable mechanism and can proceed now if the user wants.
2. **Finish the durable mechanism (Section 5)** — this unblocks the ~47 remaining mechanical findings. Needs the user's decisions (scoping signal, SHA-256 approach) → then draft hook/gate edits → user reviews + commits → re-validate the loop on a small batch before scaling.
3. **Scale the ~47 mechanical findings** through the fixed loop (batched by the triage's coordinated clusters to cut rounds; auto-merge low/mechanical on gate+verify, surface failures).
4. **openspec-behavioral (7)** — separately, via `/opsx:propose`; the user decides behavior.

**Remember:** the user *wants* you to ask questions when something is genuinely ambiguous — especially anything touching the containment runtime, the invariant suite, the gate, or the hooks. Don't guess on those.
