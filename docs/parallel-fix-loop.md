# Parallel Fix Loop — design & build spec

> **Visuals:** see [`coding-harness-diagram.md`](./coding-harness-diagram.md) (per-finding pipeline, fan-out, salvage/PARK + the colour legend). This doc is the **prose spec + build plan + handoff seed**.
>
> **Status:** design locked 2026-06-26. **Not yet implemented.** Proven facts in §2 are from a throwaway-worktree spike on that date.
>
> **Scope:** this is the *particular* — a parallel loop for **mechanical fixes** (fix-fest / critic findings). Once proven, the pattern generalizes to the whole OpenSpec build loop (see §8).

---

## 1. Why — the problem this solves

The harness was built for **attended, sequential, single-tree, human-commits** work. We are pushing it toward **unattended, parallel, multi-worktree, agent-commits**. Almost every failure we hit is that one mismatch. Two root causes mattered most:

1. **git did double duty** — version control *and* the tamper oracle. The gate's tripwire is `git diff HEAD -- <config>` and it trusts "humans are the only committers." So the moment a subagent can `git commit`, it can bake a tampered config into HEAD (HEAD == tree → no diff → gate runs green). That is why subagent git was blanket-denied — which in turn made subagents unable to commit, which made the red-check ("run newer tests against older code") impossible.
2. **Verification couldn't run isolated** — earlier worktrees lived in `/tmp` with symlinked `node_modules`, so the toolchain didn't resolve (`tsc: command not found`, `Cannot find @react-native/typescript-config`). That forced all gating back through the main tree, serializing everything and defeating parallelism.

Both are now solved (§2).

---

## 2. What we proved (spike, 2026-06-26)

A throwaway worktree under `.claude/worktrees/` settled three load-bearing facts:

1. **Worktree-from-current-branch is a one-arg fix.** `git worktree add -b fix/<id> .claude/worktrees/<id> $(git rev-parse dev/v1)` — the trailing start-point pins it to dev/v1's tip, **not main**. (The old default spawned from main.)
2. **The toolchain resolves inside an in-repo worktree — the `/tmp` tax is gone.** From inside `.claude/worktrees/spike-proof/` with *no* local `node_modules`: `tsc` ran (5.9.3), and `typescript` + `@react-native/typescript-config` both resolved to the repo's `node_modules`. Node walks **up** the directory tree, and a worktree under `.claude/worktrees/` is under the repo root, so it finds `<repo>/node_modules` for free. **Rule: worktrees live under `.claude/worktrees/`, never `/tmp`.** This is the unlock — each fixer runs the real gate *and* the red-check in its own worktree, in parallel. **Caveat (validated 2026-06-26):** `node_modules` resolves upward, but `src/runtime/generated/*` and `build/generated/*` are **gitignored** (`.gitignore` 79/83), so `git worktree add` does **not** copy them — a fresh worktree lacks them and `typecheck`/`guard:metro`/invariants fail (`TS2307 Cannot find module`) until generated. Fix: the orchestrator runs **`npm run build` once at worktree setup (measured ≈0.3s)**, which writes those gitignored outputs into the worktree; after that, typecheck + the Node suites pass in-worktree (validated: `vstore:test` → ALL GREEN).
3. **The pinned-BASE diff defeats commit-to-hide.** Committed a change inside the worktree, then: `git diff <BASE>` **showed it**; `git diff HEAD` was **empty**. The empty HEAD diff is exactly why the old tripwire failed once agents could commit. Pinning the reference to the recorded BASE SHA fixes it.

Also confirmed: **a subagent can be resumed after it returns, with full context, via `SendMessage`** (observed directly — a returned agent was resumed "from transcript"). The exact resume *window* (cross-session / timeout) is **undocumented**, so we treat in-session resume as reliable and the branch+note as the durable floor (§4.5).

---

## 3. Trust model (the one paragraph that explains everything)

- **Main tree / `dev/v1` / `main`** = trusted. Only the orchestrator (main thread) or a human writes here. The **authoritative** gate runs here.
- **Worktrees (`fix/<id>`)** = untrusted. Subagents edit + commit freely. Nothing here is trusted until it passes the authoritative gate in the trusted context at merge.
- **The only trust anchor is the BASE commit SHA** the orchestrator records at worktree creation. Every integrity question is "**diff vs BASE**," never "diff vs HEAD." A SHA is immutable (content-addressed) — an agent with worktree git can move a *branch ref* but cannot move a *SHA*. **git's content-addressing already is the SHA-256 baseline** — so there is no hash manifest, no hidden database, no rebaseline tool, no capability system. We retired all of that.

---

## 4. Mechanisms

### 4.1 Pinned-BASE integrity (replaces the HEAD tripwire)

The orchestrator records `BASE = git rev-parse dev/v1` when it creates the worktree. Two checks, two jobs:

- **Tamper catch (any time, incl. uncommitted):** `git -C <wt> diff <BASE> -- <PROTECTED>` must be **empty**. `git diff <commit>` compares the *working tree* to that commit, so it folds in committed + staged + unstaged in one shot — no staging needed. (This is the "straight diff" we want; commit-to-commit `<BASE>..HEAD` would *miss* uncommitted edits.)
- **Merge scope (what actually lands):** `git -C <wt> diff --name-only <BASE>..HEAD` ⊆ the fix's declared **allowlist**.

`PROTECTED` = `scripts/gate.sh scripts/gate-full.sh .claude/hooks .claude/settings.json .claude/agents .claude/commands package.json package-lock.json tsconfig*.json eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* babel.config.js metro.config.js invariants/` (the invariants suite is owner-authored — feature agents never touch it).

The **orchestrator's** check (against the BASE *it* recorded) is authoritative. A copy inside the gate (§6.2, via `GATE_BASE`) is only the fixer's self-check.

This also kills failure 4.7 from the fix-fest handoff: the gate no longer refuses to run on a dirty tree — only on a change *away from the trusted BASE*.

### 4.2 Scoped git for subagents (signal: `agent_id` + `cwd`)

`PreToolUse(Bash)` input exposes **`cwd`** (always) and **`agent_id`** (present only for subagents) — both confirmed by the §6.0 probe. We key on **both**: `agent_id` non-empty ⇒ it's a subagent; `cwd` under `.claude/worktrees/` ⇒ it's operating in a worktree.

Policy intent:

- **Hard-deny for every caller** (network / shared-ref / history rewrite): `push, pull, fetch, remote, update-ref, symbolic-ref, rebase, reflog, gc, config, branch -f/-D/-m of main|dev/v1`.
- **Allow when operating inside a worktree** (`cwd` under `.claude/worktrees/`, or explicit `git -C .../.claude/worktrees/...`): `add, commit, checkout/switch (files & own branch), restore, stash, status, diff, log, show, rev-parse, branch (create/list)`.
- **Main thread** (cwd = repo root): mutating git stays **`ask`** (orchestrator commit/merge/worktree-ops prompt the human / are approved per session policy). `git worktree add|remove` is orchestrator-only.

The matcher is best-effort string matching (an agent can alias `git` or use an absolute path); the durable backstops are the pinned-BASE diff at merge, the orchestrator's review, and the fact that worktree tampering can't land.

### 4.3 Gate split (mapped to the current `scripts/gate.sh`)

The current gate runs **everything** in one script (clean run ≈ 15s per its own header). The split's payoff under **parallelism** is (a) not running N concurrent `build` + headless-Chromium passes that contend for CPU/GPU and amplify Chromium flakiness, and (b) tight per-attempt feedback for the fixer's self-loop. So we split by **dependency on `build` / Chromium**, not by raw speed.

Measured (2026-06-26): `build` ≈ 0.3s (esbuild — effectively free); the heavy/flaky steps are `guard:metro` (Metro bundler) and the headless-Chromium invariants. So:

- **`scripts/gate.sh` (FAST / inner — fixer, every attempt, in its worktree):** `build` (≈0.3s, refreshes generated) → `typecheck` → `lint` → `version-store` → `storage-engine` → `capability-bridge` → `launcher` → `server` → `scaffolding tripwires`. CPU-only; no Metro, no Chromium.
- **`scripts/gate-full.sh` (FULL / per-fix pre-merge — orchestrator, once, serialized):** runs `gate.sh`, then `knip` → `guard:metro` → `invariants` → `bridge:invariants` → `deliver-by-source` → `openspec validate`.

`build` sits in the FAST gate because it's ~free **and** mandatory: `typecheck`, `guard:metro`, and all three invariant runners need `src/runtime/generated/*` to exist, and those files are gitignored (absent in a fresh worktree). The split's payoff is therefore **deferring Metro + Chromium** (browser/bundler contention + invariants flakiness under N parallel worktrees), not raw latency. Build-dependency map resolved in §7.

### 4.4 Salvage / PARK (zero-waste rejects)

A fix is committed on `fix/<id>`, so **reject ≠ delete.** On a terminal wall, instead of deleting, the orchestrator **PARKs**: rename `fix/<id> → wip/<id>`, keep the branch, write a one-line reason note (gate tail / scope diff / verifier critique). The worktree *directory* is removable (cheap to recreate); the branch persists. Anyone resumes with `git worktree add .claude/worktrees/<id> wip/<id>`. Retention: keep `wip/*` until the finding is resolved or explicitly abandoned; periodic human-triggered prune.

Most walls are **not** terminal — they bounce back and reuse the code (§4.6).

### 4.5 Re-engagement — in-context resume vs fresh-from-branch

| Mechanism | When | Context |
|---|---|---|
| **Self-gate loop** | fast-gate fail | in-context (fixer never stopped — runs `gate.sh` as pre-flight and loops itself until green/budget before reporting) |
| **`SendMessage` resume** | verifier reject, re-plan, "try harder" | in-context (same fixer resumed with full memory) |
| **Fresh agent from branch** | cross-session, or Workflow one-shot | reconstructed from `wip/<id>` diff + compressed reason note |

In-context resume is the cheap fast path; **branch-reconstruction is the mandatory floor** because the resume window is undocumented. Cooperation is turn-based: a subagent can't interrupt the orchestrator mid-run; it stops/reports, the orchestrator reviews, then closes it or resumes it with a message.

> **Architectural consequence:** because in-context resume matters, the **orchestrator is a main-thread async-Agent driver** (launch N async fixers, get completion notifications, `SendMessage` to resume) — **not** a pure `Workflow` script, whose `agent()` calls are one-shot (no in-context resume). Main-thread driving gives parallel fan-out *and* cheap revise loops. Reserve `Workflow` for purely mechanical fan-out that never needs a revise cycle.

### 4.6 Approval, escalation, caps

One rule everywhere: **bounded autonomy, then escalate — never silent-drop.** The orchestrator decides within explicit caps; the human enters only on cap-exhaustion or a protected/cross-boundary case.

| Wall | Default | Why |
|---|---|---|
| **Fast-gate cap hit** | orchestrator: one extended attempt → else PARK | mechanical "try harder once" |
| **Scope violation** (non-protected) | orchestrator: re-plan + widen *iff* it stays same-subsystem & non-protected → else escalate | often the *plan's* allowlist was too tight, not the code — re-run reuses the code verbatim |
| **Verifier reject** | orchestrator: bounce critique back, up to revision cap → else PARK | the review→revise loop is self-correcting; the critique is signal |
| **Protected-file touch** | **always human** | the one thing the orchestrator must never self-bless |

Caps (knobs): extended-attempt = 1, revision = 2, per-finding total-spend ceiling. **Merges are serialized** — a single writer to `dev/v1`, so two fixes never race the branch.

---

## 5. Orchestrator procedure (the loop)

For a batch of findings, the main-thread orchestrator:

1. **Plan** — dispatch a read-only `Planner` per finding → returns DONE spec: fix sketch, the test, the **file allowlist**, the red-without-fix expectation, severity.
2. **Create worktree** — `BASE=$(git rev-parse dev/v1)`; `git worktree add -b fix/<id> .claude/worktrees/<id> "$BASE"`; record `<id> → BASE`; then **`npm run build` in the worktree (≈0.3s)** to populate the gitignored `src/runtime/generated/*` (absent in a fresh worktree; required by typecheck/metro/invariants).
3. **Fan out fixers** — launch async `implementer` agents, each pinned to its worktree. Each writes fix + test, commits, and self-runs `scripts/gate.sh` (fast) until green or budget.
4. **Red-check** — a **separate context** on `fix/<id>` (ideally its own fresh worktree on the same branch so it doesn't disturb the fixer): `git checkout <BASE> -- <prod-file(s)>` (keep the test), run the test, assert **RED**. Green ⇒ vacuous-test reject.
5. **Integrity check (authoritative)** — §4.1: protected untouched vs BASE; changed files ⊆ allowlist. Protected touch ⇒ escalate; out-of-allowlist ⇒ scope wall (§4.6).
6. **Verify** — read-only adversarial `reviewer`: sees the diff + gate result + red-proof, **not** the fixer's reasoning; default-reject.
7. **Full gate** — orchestrator runs `scripts/gate-full.sh` against the worktree (serialized).
8. **Approve & merge** — low/med + all green ⇒ orchestrator merges `fix/<id>` → dev/v1 (serialized). High or any protected touch ⇒ human ratifies. Then `git worktree remove` + delete branch. On any wall: salvage per §4.4/§4.6.

### 5.1 Implementation — built + validated 2026-06-27

The driver is three files plus hardened hooks:
- **`scripts/fixloop.sh`** — deterministic toolkit the orchestrator runs: `integrity <branch> [allowlist]` (exit 0 ok / 3 protected-touch / 4 scope-violation), `redcheck <branch> <test> -- <prod>` (exit 0 RED / 5 vacuous-GREEN; reverts modified files via `git checkout BASE --`, new files via delete), `park`, `finish` (prints the human-gated merge — never executes it), `status`. Recovers BASE via `git merge-base <branch> dev/v1`. **Git inside it runs UNHOOKED**, so it is orchestrator-only: bash-policy denies subagents invoking it, and both hooks protect it from edits. Every subcommand exit code unit-tested.
- **`.claude/agents/fix-worker.md`** — the fixer: runs in its isolation worktree, builds first, writes the smallest fix + a non-vacuous test, self-gates with `./scripts/gate.sh`, commits, and reports `TEST` + `PROD FILES` so the orchestrator can red-check.
- **`.claude/commands/fix-loop.md`** — the orchestrator runbook (`/fix-loop`), wiring planner → fix-worker (async, resumable via SendMessage) → redcheck → integrity → reviewer → gate-full → serialized merge, with PARK + caps.

Next: a real-finding shakeout (one of the ~47 mechanical fix-fest findings) before scaling (§7 item 6).

---

## 6. Proposed harness changes (a human applies these — they are human-committed)

> **Status (2026-06-26):** the gate split + scoped-git policy below are **already written to the working tree** (uncommitted) — see `git status`. They are still human-*committed*: review the diff and commit in your editor. Remaining human TODOs are flagged inline.

### 6.0 Verify hook input fields — DONE (2026-06-26)

Probed by logging `$INPUT` from `bash-policy.sh` and triggering a worktree-isolated subagent vs the main thread (probe line since removed):

| field | main thread | subagent |
|---|---|---|
| `cwd` | repo root | the worktree path under `.claude/worktrees/` |
| `agent_id` | absent | present (the agent's id) |
| `agent_type` | absent | present (the `subagent_type`) |

So `cwd` is the reliable location signal and `agent_id` non-empty ⇔ subagent. (Also present: `session_id`, `transcript_path`, `tool_name`, `tool_use_id`, `permission_mode`, `effort`, `hook_event_name`.)

### 6.1 `.claude/hooks/bash-policy.sh` — scoped git (replaces the blanket subagent-deny, lines ~55–60)

**IMPLEMENTED & VALIDATED (2026-06-26)** — written live to `.claude/hooks/bash-policy.sh`. The rule:

- A **subagent** (`agent_id` set) may run `add/commit/checkout/switch/restore/stash/branch/rev-parse` **only** when `cwd` is under `.claude/worktrees/`; any other git, or the same git outside a worktree, is **denied**.
- **Network / shared-ref / history-rewrite git** (`push/pull/fetch/clone/remote/update-ref/symbolic-ref/rebase/reflog/gc/config`, and `branch -f|-D|-m` of `dev/v1`/`main`) is hard-denied for **every** caller — kept in the match-anywhere block so a chained segment can't smuggle it through.
- The **compound-command fall-through now sits *before* the git policy**, so neither the git nor the auto-allow vocab can auto-allow a chained payload (`git commit && rm -rf src` → falls through to the normal prompt).
- **Main-thread** mutating git stays `ask`; `git worktree` is orchestrator-only (main thread → `ask`). Read-only git (`status/diff/log/show/rev-parse/worktree list`) is allowed everywhere.

Validated against a 14-case decision matrix (`$CLAUDE_JOB_DIR/tmp/policy-tests.jsonl`), all pass — e.g. subagent-in-worktree `git commit` → allow · subagent-not-in-worktree `git commit` → deny · subagent `git push`/`rebase` → deny · `branch -D dev/v1` → deny · `git commit && rm -rf src` → fall-through · subagent write to `scripts/gate.sh` → deny · `npm run build` / `./scripts/gate.sh` → allow.

### 6.2 Split `scripts/gate.sh` → `gate.sh` (fast) + `gate-full.sh` (full)

- **`gate.sh` (FAST)** = `build` (≈0.3s) → `typecheck` → `lint` → `version-store` → `storage-engine` → `capability-bridge` → `launcher` → `server` → `scaffolding tripwires`. **`gate-full.sh` (FULL)** runs `gate.sh` first, then `knip` → `guard:metro` → `invariants` → `bridge-invariants` → `deliver-by-source` → `openspec`. (`build` is in FAST because it's ~free and required for typecheck/metro/invariants to resolve the gitignored generated files.)
- **DONE — tamper tripwire pinned to BASE.** `gate.sh` now uses `git diff --quiet "${GATE_BASE:-HEAD}" -- …` and watches `.claude/agents`/`.claude/commands` (+ `gate-full.sh`). The orchestrator exports `GATE_BASE=<recorded BASE>` for worktree runs; the in-gate tripwire is the fixer's self-check, the **orchestrator's** pinned-BASE diff (§4.1) is authoritative.
- **DONE** — `scripts/gate-full.sh` added to the `PROTECTED` set in `bash-policy.sh`. **TODO (human):** add `scripts/gate-full.sh` to `protect-harness.sh`'s block list, and **commit `gate.sh` + `gate-full.sh`** so the pinned-BASE tripwire stops refusing to run on the now-dirty config.

### 6.3 `gate-on-subagent-stop.sh` / `settings.json` — SubagentStop note

The SubagentStop hook inspects the **main** tree (`git diff --quiet`), which stays clean while a subagent works in a worktree — so it **won't gate worktree fixers**. That's fine: in the parallel model the **fixer self-gates** (fast) and the **orchestrator** runs the full gate. Keep the hook as a backstop for any legacy single-tree implementer work; document that it does not cover worktree agents. (No change required to ship; revisit only if we drop single-tree work entirely.)

### 6.4 `protect-harness.sh` — confirm the worktree carve-out

The `.claude/worktrees/` carve-out already exists (committed `b0fb25f`). Confirm it still lets fixers edit files inside their worktree while blocking the real config dirs. No change expected.

### 6.5 `.claude/settings.json` — set the worktree base ref (REQUIRED, human-applied)

**TODO (human):** add `{ "worktree": { "baseRef": "head" } }`. Confirmed by docs + the 2026-06-26 dry run: the Agent tool's `isolation:'worktree'` branches from `origin/<default-branch>` by default — here a **stale `origin/main` (`8826e0b`)** — so a fixer's worktree came up on ancient code with no `scripts/gate.sh` (gate ran exit 127). `baseRef: head` branches from local HEAD (dev/v1) instead. This is **load-bearing**: subagents can reach a worktree *only* via isolation (no `cd` — not auto-allowed; no cwd param on the Agent tool), so without this the entire fixer flow runs on the wrong base. (Claude can't write `settings.json` — the auto-mode classifier blocks self-modification of the permissions block — so apply it by hand.) **CONFIRMED (2026-06-26):** after `baseRef: head` was applied + committed, a re-test isolation subagent came up on dev/v1's tip (`0834592`), scoped-git `add`/`commit` worked, and `./scripts/gate.sh` → **FAST GATE PASSED** inside the subagent's own worktree.

---

## 7. Open / verify items

> **Dry run (2026-06-26).** Scoped-git validated **live**: a real subagent's `git add`/`git commit` inside its worktree were allowed; `git push` was denied with our exact policy message. Verification half validated end-to-end: green test → BASE-diff (changed files ⊆ allowlist, protected paths clean) → red-check (undo the fix ⇒ test goes RED) → restore. **Fix applied + re-confirmed:** isolation worktrees branched from a stale base → set `worktree.baseRef: head` (§6.5); with that, a re-test isolation subagent came up on dev/v1's tip (`0834592`), scoped-git commit worked, and `./scripts/gate.sh` → **FAST GATE PASSED**. Every loop primitive is now proven end-to-end.

1. **§6.0 probe — RESOLVED (2026-06-26).** `cwd` always present; `agent_id`/`agent_type` present only for subagents. Scoped-git rule implemented + validated (§6.1).
2. **Fast-gate build dependency — RESOLVED (2026-06-26).** Build-dependent (need `src/runtime/generated/*`): `typecheck`, `guard:metro`, `invariants`, `bridge:invariants`, `deliver-by-source`. Build-independent (safe pre-build): `lint`, `vstore:test`, `storage:test`, `bridge:test`, `launcher:test`, `server:test`. `knip` doesn't crash on missing generated (low confidence → placed in FULL). Generated files are gitignored, so a fresh worktree never has them → worktree setup runs `npm run build` (≈0.3s), which lets the FAST gate include `build`+`typecheck`.
3. **Red-check worktree** — run it in a *separate* worktree on `fix/<id>` so it doesn't disturb the fixer's tree; confirm `git checkout <BASE> -- <prod>` + test run is clean and reversible.
4. **Resume window** — undocumented; validate empirically how long an async agent stays `SendMessage`-resumable. Until known, the branch+note floor (§4.5) is mandatory.
5. **`agent_id` reliability — RESOLVED.** `agent_id` IS populated for subagents (probe-confirmed); the new rule keys on `agent_id` + `cwd` together.
6. **Re-validate on a small batch** (2–3 findings) before scaling to the ~47 remaining mechanical fix-fest findings.

---

## 8. Handoff — generalizing to the OpenSpec build loop

This loop is the **particular** (mechanical fixes). The **general** build loop (`/opsx:*` propose → design → tasks → chains → `/dispatch` → reviewer) reuses the same primitives; a future agent (likely without this conversation's context) should lift:

- **Pinned-BASE integrity** replaces the `git diff HEAD` tripwire everywhere — `/dispatch` records BASE per change and audits `diff vs BASE`. Git's content-addressing is the baseline; no manifest.
- **Worktrees under `.claude/worktrees/`** give per-chain isolation with a working toolchain — so chains can run in parallel where their files/contracts don't overlap (the guide's §8 "unsolved tax" is now paid). Serialize the **merge** to dev/v1; parallelize the work.
- **Gate split** — chains self-gate fast; the change gates full once before it's declared done.
- **Scoped git for subagents** (cwd-based) lets implementers commit per-chain and enables the red-check.
- **Salvage/PARK + bounded-autonomy-then-escalate** apply unchanged to chains.
- **Main-thread async-Agent orchestration** (not Workflow) for resumable implementer revise loops.

Source material for that agent: this doc, [`coding-harness-diagram.md`](./coding-harness-diagram.md), [`harness-build-guide.md`](./harness-build-guide.md) (the intended roles), and [`fix-fest-handoff.md`](./fix-fest-handoff.md) (the failure catalog these changes close).
