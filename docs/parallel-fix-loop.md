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

`PROTECTED` = `scripts/gate.sh scripts/gate-full.sh scripts/fixloop.sh .claude/hooks .claude/settings.json .claude/agents .claude/commands package.json package-lock.json tsconfig*.json eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* babel.config.js metro.config.js invariants/ build/` (the invariants suite is owner-authored — feature agents never touch it; `build/` is the build harness, executed by the auto-allowed `npm run build`, so tampering there runs arbitrary code inside the gate — protected across the integrity check, both hooks, and the gate's own tamper tripwire).

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

### 4.7 Hermetic full-gate (committed tip in the main tree, not the fixer's worktree)

The pinned-BASE integrity check (§4.1) attests only to **tracked** content — `git diff <BASE>` shows neither **untracked** nor **gitignored** files. But the gate *executes* against the whole filesystem it runs in. That gap is exploitable: a fixer can leave poisoned **gitignored** generated files (`src/runtime/generated/*`, `build/generated/*`) or untracked artifacts (a shadowing `.npmrc`, a local config the toolchain walks up to) that make a bad gate go green while the diff you review stays clean — classic "test against X, ship Y."

So the orchestrator runs `gate-full` from the branch's **committed tip checked out into the MAIN tree**, never the fixer's worktree: `scripts/fixloop.sh gatefull <branch>` refuses on a dirty main tree, records the current ref, `git checkout --detach`es the branch's commit, exports `GATE_BASE` = recorded BASE, runs `gate-full.sh`, then restores the original ref (in a trap). Because the checkout populates the tree from committed **objects** (not the fixer's worktree directory), untracked/gitignored poison in the fixer's worktree never reaches the gate — so **what you verified (the committed diff) == what you tested**. This is the same reason CI never trusts a developer's working dir.

**Why the MAIN tree and not a fresh worktree (shakeout finding, 2026-06-29):** the first design used a separate `git worktree`, but a fresh worktree has **no `node_modules`** (gitignored) and **Metro does not walk up** to the repo-root copy the way Node does — `guard:metro` fails with `Unable to resolve module @babel/runtime/...` (symlinking the dir doesn't help; Metro treats the ancestor copy as a duplicate RN dep). esbuild/tsc/the Node suites *do* resolve up from a worktree, so this only bites at the full gate, on Metro. The main tree has the real `node_modules`, so Metro resolves. `--detach` is what lets the main tree check out a commit whose branch ref is still checked out in the fixer's worktree.

**Limits (scope the claim):** main-tree gate-full shares the real `node_modules` (Threat C — shared-dep tampering, the OS sandbox's job) and runs unsandboxed (Chromium + worktree/checkout writes need it); it also **occupies the main tree** for the duration (serialized; restored via trap; refuses if the tree is dirty). It closes the **worktree-local** untracked/ignored gap (Threat B); the sandbox closes the shared-resource gap (Threat C). Complementary, not redundant.

### 4.8 Memory handoff (subagents propose, orchestrator applies — human-gated)

The per-project memory store (`~/.claude/projects/*/memory/`) is a **shared, cross-session, single-writer** resource. Letting N parallel fixers write it directly would (a) race the single `MEMORY.md` index and (b) mutate persistent state with no review. So fixers **never write the store** — `protect-harness.sh` hard-denies subagent writes to it. Instead a fixer puts any durable, load-bearing fact in its report's `MEMORY:` section; the orchestrator collects proposals across the batch, dedupes, and applies the worthwhile ones itself with the Write/Edit tool — which prompts the human with the full diff (Write/Edit bypass the OS sandbox, so the **permission prompt**, not the sandbox, is the gate on memory). Unattended runs don't apply — they list proposals for the human to ratify. This is the propose-only/ledger pattern (decision #42) applied to memory; the report is the ledger channel (no stray files in the worktree to pollute the integrity diff).

### 4.9 Protected-file classes & the scoped-grant model (design ratified 2026-06-29; BUILT 2026-07-01)

The PROTECTED set is not monolithic — it splits into two classes by **blast radius**:

- **Class 1 — project config the agent owns:** `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.*`, `knip.json`, `babel.config.js`, `metro.config.js`. A bad edit is *bounded*: it breaks the build (the gate catches it) or is visibly wrong (the reviewer catches it). Nothing's trust derives from these.
- **Class 2 — the integrity & control plane:** `scripts/gate*.sh`, `scripts/fixloop.sh`, `.claude/**` (hooks, settings, agents, commands), `invariants/`, `build/`. These ARE the harness that judges the work; a bad edit makes every *other* green check lie — *unbounded* blast radius. The line: **Class 2 is the thing doing the verifying; Class 1 is the thing being verified.**

**Class 2 is NEVER grantable to a subagent.** Hitting it is a class-B stop; the human (or main thread) makes that change. Letting an agent author its own gate/hooks/invariants would mean "gate-full passed" at final review carries no information — the one review you can't shortcut.

**Class 1 is grantable per-task.** For the mechanical-fix loop it still *defaults* to a class-B stop (mechanical fixes shouldn't need protected edits), but a lane that genuinely needs a Class-1 edit can now be granted without mid-flight prompts, keeping the human as final ratifier — because **the control point is the *merge*, not the edit** (a Class-1 change in a worktree is harmless until merged: visible in `diff BASE`, gated, ratified). The model:

1. **Plan declares it** — the planner's allowlist includes the Class-1 file (= declared protected scope); the orchestrator approving the plan approves the scope, *once, upfront, no per-edit prompt*.
2. **Orchestrator writes an unforgeable grant** — a manifest keyed by worktree (`.claude/fixloop/grants/<wt-id>`, agent-unwritable since `.claude/**` is hook-blocked *and* `.claude/fixloop/grants` is in bash-policy's PROTECTED set) listing the granted Class-1 globs.
3. **Hook honors the grant** — `protect-harness` allows a subagent's Class-1 edit iff it matches the grant (Class-2 never; ungranted → block). The agent never stalls, never prompts you mid-flight.
4. **Integrity distinguishes** — `fixloop integrity`: a protected change ∈ the declared allowlist → *sanctioned* (flag "needs ratification"); ∉ allowlist → exit-3 *tamper*.
5. **Automated scrutiny** — the reviewer specifically audits the protected change; the orchestrator's "proper solution?" adjudication is the pre-pass.
6. **Human ratifies the whole lane at merge** — all protected changes + code, approve/disapprove. The *only* touchpoint.

**As built (2026-07-01):**
- **The grant only removes the class-B *stop* — it does not widen access.** Class-1 files were *already* worktree-editable under the old blanket `*/.claude/worktrees/*) exit 0` carve-out; that same blanket carve-out also silently let a subagent edit `scripts/gate.sh`/`fixloop.sh`/`invariants/` in-worktree (Class-2!), caught only post-hoc by the integrity diff. The rebuild **tightens** the hook: Class-2 is now hard-blocked in-worktree (immediate, not just post-hoc), and Class-1 is gated behind the grant instead of blanket-allowed. Net security is *higher*, not lower.
- **`integrity` exit codes:** `0` clean · **`6` sanctioned Class-1** (⊆ declared allowlist — needs ratification, `finish` prints the merge with a ⚠ ratify banner) · `3` tamper (any Class-2 touch — *even if allowlisted* — or a Class-1 touch not covered by the allowlist) · `4` scope violation (non-protected file outside allowlist). The load-bearing invariant, unit-tested: **an allowlist/grant can never launder a Class-2 edit into "sanctioned."**
- **Grants unlock the Edit/Write tool path only.** The Bash write path (`sed -i package.json`, redirects, `cp`/`tee`) stays fully denied for granted files — a granted file is edited *structurally*, never shell-mutated, for a clean audit surface.

**Ratification checklist (fix-vs-relax) — the criteria the HUMAN applies at the two forced gates (the grant `ask` prompt, and the exit-6 merge), NOT a rule we trust the orchestrator to self-apply:**
- Does the diff make the config *more correct* — a wrong value → right value, a moved path repaired, a genuinely-public export marked used? → **grantable.**
- Or does it make a *checker weaker* — an eslint rule → off/downgrade; a tsconfig strictness flag (`strict`/`noImplicitAny`/`noUncheckedIndexedAccess`/`strictNullChecks`) loosened; a knip `ignore` added to silence a real unused-code finding; a script pulled from the gate; a dependency added? → **NOT grantable.** That is the reward-hack shape — fix the code, or PARK for a human to weigh the config change on its own merits.
- Was it *declared in the plan up front*, or did it appear *mid-fix*? A protected edit discovered halfway is a signal the fix is fighting the harness → default PARK.

The point of writing it down is not to make the orchestrator obey it — it's to give the human a checklist at gates the mechanism already forces. What can't be mechanized (intent: correct-vs-relax) is *detected* not *trusted*: `reviewer` flags every check-weakening diff HIGH severity (`.claude/agents/reviewer.md`), so the risky subset is always surfaced, never silently merged; and no run can push to a shared remote without a human (`git push` is bash-policy-denied), so even a bad grant is contained to a branch a human reviews.

**Future — a fully-unattended tier (recorded, NOT built):** the near-term model keeps the human at grant-creation — you approve each grant's `ask` prompt during setup, then leave *execution* unattended (grants are consumed, never minted, while you're away). A future tier would let the orchestrator *auto-grant* with no human at all; that earns an extra isolation ring. Each fully-unattended run lands on its own throwaway **"dirty-area" branch** (not `dev/v1` directly), which a human reviews and merges into `dev/v1` afterward. The push-deny already forces whole-branch review before anything reaches a shared *remote*; the dirty-area branch extends that so even the *local* `dev/v1` is insulated from an unreviewed auto-granted run. Build it deliberately when that tier is wanted — not by accident.

**Dependency adds are a separate, higher bar even after grants exist:** they also need `npm install` (network + lockfile regen), which we deny for supply-chain safety. Keep those human-in-the-loop (or a dedicated, audited "install one package" grant) — a Class-1 *file* grant alone can't make a dependency add work.

---

## 5. Orchestrator procedure (the loop)

For a batch of findings, the main-thread orchestrator:

1. **Plan** — dispatch a read-only `Planner` per finding → returns DONE spec: fix sketch, the test, the **file allowlist**, the red-without-fix expectation, severity.
2. **Create worktree** — `BASE=$(git rev-parse dev/v1)`; `git worktree add -b fix/<id> .claude/worktrees/<id> "$BASE"`; record `<id> → BASE`; then **`npm run build` in the worktree (≈0.3s)** to populate the gitignored `src/runtime/generated/*` (absent in a fresh worktree; required by typecheck/metro/invariants).
3. **Fan out fixers** — launch async `implementer` agents, each pinned to its worktree. Each writes fix + test, commits, and self-runs `scripts/gate.sh` (fast) until green or budget.
4. **Red-check** — a **separate context** on `fix/<id>` (ideally its own fresh worktree on the same branch so it doesn't disturb the fixer): `git checkout <BASE> -- <prod-file(s)>` (keep the test), run the test, assert **RED**. Green ⇒ vacuous-test reject.
5. **Integrity check (authoritative)** — §4.1: protected untouched vs BASE; changed files ⊆ allowlist. Protected touch ⇒ escalate; out-of-allowlist ⇒ scope wall (§4.6).
6. **Verify** — read-only adversarial `reviewer`: sees the diff + gate result + red-proof, **not** the fixer's reasoning; default-reject.
7. **Full gate** — orchestrator runs `scripts/fixloop.sh gatefull <branch>` (serialized): `gate-full.sh` from the branch's **committed tip checked out into the main tree** (real `node_modules` so Metro resolves), not the fixer's worktree (§4.7).
8. **Approve & merge** — low/med + all green ⇒ orchestrator merges `fix/<id>` → dev/v1 (serialized). High or any protected touch ⇒ human ratifies. Then `git worktree remove` + delete branch. On any wall: salvage per §4.4/§4.6.

### 5.1 Implementation — built + validated 2026-06-27

The driver is three files plus hardened hooks:
- **`scripts/fixloop.sh`** — deterministic toolkit the orchestrator runs: `integrity <branch> [allowlist]` (exit 0 ok / **6 sanctioned Class-1**, ⊆ allowlist, needs ratification / 3 tamper — Class-2 touch or ungranted Class-1 / 4 scope-violation; the PROTECTED set is split into `CLASS2` never-grantable and `CLASS1` grantable arrays), `redcheck <branch> <test> -- <prod>` (exit 0 RED / 5 vacuous-GREEN; reverts modified files via `git checkout BASE --`, new files via delete), `gatefull <branch>` (runs `gate-full.sh` from the branch's committed tip checked out into the main tree — §4.7 — passing through its exit code), `park`, `finish` (prints the human-gated merge — never executes it), `status`. Recovers BASE via `git merge-base <branch> dev/v1`. **Git inside it runs UNHOOKED**, so it is orchestrator-only: bash-policy denies subagents invoking it, and both hooks protect it from edits. Every subcommand exit code unit-tested.
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

### 6.6 Threat-B hardening — DONE (2026-06-29)

Two gaps from the security review (handoff §6.2), both closed:

- **`build/` is now PROTECTED.** It is subagent-writable *and* executed via the auto-allowed `npm run build`, so a tampered `build/build.mjs` runs arbitrary code inside the gate. Added to: `fixloop.sh` integrity set, `gate.sh`'s tamper tripwire (the gate now refuses to run — and refuses to *execute* the build — when `build/` differs from BASE), `bash-policy.sh`'s protected-write regex, and `protect-harness.sh`'s block-list (with a carve-out so it stays protected even inside a fixer's worktree). `build/generated/*` is gitignored output, untouched by these.
- **Full gate runs from the committed tip in the MAIN tree** (§4.7), via `fixloop.sh gatefull` — closes the untracked/gitignored poisoning gap while giving Metro the real `node_modules` (a fresh worktree can't resolve the RN graph). Caveat: shared `node_modules` (Threat C) remains the sandbox's job; the run occupies the main tree (serialized, trap-restored).

Also folded in: **memory handoff** (§4.8) — `protect-harness.sh` now hard-denies subagent writes to `~/.claude/projects/*/memory/*` and routes main-thread memory writes to `ask`; fixers propose via the report `MEMORY:` field. (Correction to handoff §6.1: Write/Edit **bypass** the OS sandbox — only Bash is sandboxed — so memory writes via the tools are never broken by `sandbox.enabled` and need no allow-list; the permission prompt is the gate.)

> **Still pending the human:** the sandbox decision itself (handoff §6.1, `sandbox.enabled: true`) — settings self-mod is agent-blocked, so it's human-applied. Closing Threat C (arbitrary execution / shared-resource tampering) still needs it.

---

### 6.7 Test classification — don't force a behavioral test on a non-behavioral fix (PROPOSED, 2026-06-30)

The fix-worker contract mandates "a test that FAILS without your fix and PASSES with it" *unconditionally* — but that silently assumes every fix changes behavior. For a no-behavioral-delta fix (dedup a regex, delete dead code) the only move left is a source-string grep: bloatware, and un-red-checkable (reverting prod yields no behavioral failure). Classify the change at PLAN time:

- **Behavioral** (changes observable I/O, error surface, persisted state, or executable control flow) → mandate the red-checkable test; red-check is the gate.
- **Structural + a standing invariant worth locking** ("no `eval` in sandbox source", "the injection regex has ONE definition", "CSP never gains `unsafe-eval`") → a *static/structural* invariant check — legitimate **only if it encodes the invariant, not the patch** (litmus: would the assertion make sense to someone who never saw the diff?). Its home is the static-check pipeline / lint, NOT a behavioral unit test. Red-check is **skipped honestly**; VERIFY-by-inspection is the gate.
- **Structural, no lasting invariant** (rename, dead-code deletion, internal refactor) → **no test**; the existing suite staying green (regression) + inspection is the honest assurance.

**Implication for the loop:** PLAN emits the classification; the loop must *allow* a fix to land with no behavioral test (or a static-invariant check instead) rather than fabricating a red/green test. Demonstrated 2026-06-30 — D3/D7's §F tests were anti-revert source-greps, and one *induced a comment-plant* the moment the guard it grepped was refactored out (§7). This subsumes the earlier "make VERIFY grade greps harder" idea: the real fix is upstream, at classification.

### 6.8 Containerized unattended execution — DONE (2026-06-30)

`.devcontainer/` runs the loop in Docker with egress locked to Anthropic (`init-firewall.sh`, the resolved /24 — iptables can't wildcard a domain). The **container is now the Threat-C boundary**, replacing the macOS Seatbelt sandbox + its `excludedCommands` holes (Chromium can't run under Seatbelt) AND retiring the "illusory attended gate in background" worry: with `sandbox.enabled:false` inside (managed-settings, image-baked), there is no `dangerouslyDisableSandbox` override dance, and unattended is safe because untrusted fixer work is firewall-bounded while Threats A (hooks) + B (integrity/redcheck/fresh-gate/reviewer) run unchanged. Run via `.devcontainer/run-loop.sh setup` then `run`. Auth = Claude **subscription** OAuth token (`claude setup-token` → `~/.config/whim/oauth-token`, line 1 token + line 2 expiry), NEVER `ANTHROPIC_API_KEY` (that bills the pay-per-token API; the wrapper refuses to forward it). Full operating guide + threat-model table: **`.devcontainer/README.md`**.

### 6.9 OpenSpec bookkeeping + three hardenings — DONE (2026-07-01)

A fix-loop batch is now an OpenSpec change: `openspec new change fix-<batch> --schema whim-fixloop` (schema: `openspec/schemas/whim-fixloop/` — findings → plan → dispositions; `apply.requires` all three; tracks plan.md's checklist; the change folder's `.openspec.yaml` carries the schema, so `whim-harness` stays the config.yaml default for features). Deliberately no proposal/design/specs — a fix with a spec-visible behavior delta needs a delta spec and belongs in a whim-harness change. Three hardenings landed with it, each mechanizing a convention that had already failed (or had no incident *yet*):

- **Deterministic staleness check** (mechanizes the §7-shakeout "reconciliation-as-prose stays best-effort"): the DONE spec carries a fenced EVIDENCE block (`## <repo-relative-path>` headers + verbatim buggy lines); `scripts/fixloop.sh stale <evidence-file>` checks each line at HEAD — exit 7 (missing → likely already fixed, do NOT dispatch) / 0 (live). Prose judgment proposes; the stale check disposes.
- **Post-merge regate** (closes the gated-vs-merged-state gap): after every serialized merge, `./scripts/gate.sh` runs on the new dev/v1 tip before the next merge — each fix was gated against its own BASE, never against the other fixes, so two individually-green fixes that break each other are now caught at the merge that caused it, not smeared across the batch end. Fail → `git revert --no-edit -m 1 HEAD` + park. `finish` prints the command.
- **Durable ledger + unconditional worktree pin** (the die-before-first-commit hole): `dispositions.md` is appended as each disposition happens (`dispatched` with BASE at launch, `worktree-created` on the worker's notification, every check result, one terminal event) — it plus the fix/wip branches are the resume state if the orchestrator's context dies mid-batch. The worker's untracked `.gitkeep` pin is now its UNCONDITIONAL first action (fix-worker.md step 0), not just the grant-block edge case — so a worker that dies before its first tracked change no longer silently loses its worktree. **Structural close (PENDING, human-applied): make 1b's Flow A — orchestrator pre-creates `git worktree add -b fix/<id> .claude/worktrees/<id> dev/v1` — the default for every finding, so the pin stops being worker convention. Blocker: a worker launched without `isolation` must `cd` into the pre-created worktree, and `cd` is not in bash-policy's auto-allow; the narrow rule (simple `cd` into `.claude/worktrees/`, no `..`) must be human-added to `.claude/hooks/bash-policy.sh` — the auto-mode classifier rightly refuses agent-authored permission rules. This dependency was latent in the ORIGINAL Flow A too ("launch the worker into it" never said how the worker gets there).**

## 7. Open / verify items

> **Dry run (2026-06-26).** Scoped-git validated **live**: a real subagent's `git add`/`git commit` inside its worktree were allowed; `git push` was denied with our exact policy message. Verification half validated end-to-end: green test → BASE-diff (changed files ⊆ allowlist, protected paths clean) → red-check (undo the fix ⇒ test goes RED) → restore. **Fix applied + re-confirmed:** isolation worktrees branched from a stale base → set `worktree.baseRef: head` (§6.5); with that, a re-test isolation subagent came up on dev/v1's tip (`0834592`), scoped-git commit worked, and `./scripts/gate.sh` → **FAST GATE PASSED**. Every loop primitive is now proven end-to-end.

1. **§6.0 probe — RESOLVED (2026-06-26).** `cwd` always present; `agent_id`/`agent_type` present only for subagents. Scoped-git rule implemented + validated (§6.1).
2. **Fast-gate build dependency — RESOLVED (2026-06-26).** Build-dependent (need `src/runtime/generated/*`): `typecheck`, `guard:metro`, `invariants`, `bridge:invariants`, `deliver-by-source`. Build-independent (safe pre-build): `lint`, `vstore:test`, `storage:test`, `bridge:test`, `launcher:test`, `server:test`. `knip` doesn't crash on missing generated (low confidence → placed in FULL). Generated files are gitignored, so a fresh worktree never has them → worktree setup runs `npm run build` (≈0.3s), which lets the FAST gate include `build`+`typecheck`.
3. **Red-check worktree** — run it in a *separate* worktree on `fix/<id>` so it doesn't disturb the fixer's tree; confirm `git checkout <BASE> -- <prod>` + test run is clean and reversible.
4. **Resume window** — undocumented; validate empirically how long an async agent stays `SendMessage`-resumable. Until known, the branch+note floor (§4.5) is mandatory.
5. **`agent_id` reliability — RESOLVED.** `agent_id` IS populated for subagents (probe-confirmed); the new rule keys on `agent_id` + `cwd` together.
6. **Re-validate on a small batch — DONE (2026-06-30).** F3+D6+E2 ran in parallel (3 subsystems, zero conflicts, clean serialized merge); container + test-quality shakeout below.

**Container + test-quality shakeout (2026-06-30; dev/v1 @ `efc6973`).** The loop now runs headless in its container (§6.8) — validated end-to-end (firewall /24 Anthropic, subscription OAuth, streaming logs). Findings:
- **The "duplicate" D3/D7 commits were `--no-ff` merge topology** (a fixer commit + a merge commit per finding), NOT a double-apply — the tree had each §F test exactly once (157 checks green). Don't re-alarm on this.
- **The §F (D3/D7) tests were weak source-greps** (anti-revert only; one satisfiable by a comment). The post-hoc reviewer caught it → tightened into real invariants (D3: single-source pattern-literal; D7: live `if/throw` match) — feeding §6.7.
- **D7's assertion wasn't Node-testable** (`op-sqlite.ts` imports the native module — *that* is why the worker grepped). Extracted the guard into a pure `assertExecuteSyncAvailable` helper + a real behavioral test, dispatched to a **Sonnet 5** fix-worker (clean minimal diff, self-verified non-vacuity, honest deviation disclosure; merged `c07818a`, reconciled `efc6973`). The extraction then broke the §F grep and forced a comment-plant — the cleanest demonstration of §6.7 (source-greps are refactor-brittle; behavioral tests are not).
- **Reconciliation-as-prose (the PLAN HEAD-check) stays best-effort** — it didn't fire this run; deterministic hardening deferred to §8. The red-check partially backstops a redundant re-fix (revert-to-BASE stays green → flagged vacuous → park). **Hardened 2026-07-01: §6.9's `fixloop.sh stale` EVIDENCE check.**

---

## 8. Handoff — generalizing to the OpenSpec build loop

This loop is the **particular** (mechanical fixes). The **general** build loop (`/opsx:*` propose → design → tasks → chains → `/dispatch` → reviewer) reuses the same primitives; a future agent (likely without this conversation's context) should lift:

- **Pinned-BASE integrity** replaces the `git diff HEAD` tripwire everywhere — `/dispatch` records BASE per change and audits `diff vs BASE`. Git's content-addressing is the baseline; no manifest.
- **Worktrees under `.claude/worktrees/`** give per-chain isolation with a working toolchain — so chains can run in parallel where their files/contracts don't overlap (the guide's §8 "unsolved tax" is now paid). Serialize the **merge** to dev/v1; parallelize the work.
- **Gate split** — chains self-gate fast; the change gates full once before it's declared done.
- **Scoped git for subagents** (cwd-based) lets implementers commit per-chain and enables the red-check.
- **Salvage/PARK + bounded-autonomy-then-escalate** apply unchanged to chains.
- **Main-thread async-Agent orchestration** (not Workflow) for resumable implementer revise loops.
- **Scoped protected-file grants (§4.9) — built HERE.** Class-1 config (package.json, tsconfig, eslint, knip, babel, metro) becomes grantable per-chain via an orchestrator-written, agent-unforgeable grant manifest + a `protect-harness` grant check + a sanctioned-vs-tamper split in `fixloop integrity` — so a chain that legitimately touches Class-1 config proceeds autonomously and the human ratifies the lane at merge (never mid-flight). Class-2 (gate/fixloop/`.claude/**`/invariants/`build/`) stays human-authored, full stop. Dependency adds remain a separate higher-bar case (they also need `npm install`).

Source material for that agent: this doc, [`coding-harness-diagram.md`](./coding-harness-diagram.md), and [`harness-build-guide.md`](./harness-build-guide.md) (the intended roles).

---

## 9. Operational notes — do NOT re-derive these

Folded in from the build/validation handoff (now superseded by this doc + the implementation itself):

- **The main thread CAN write protected files** — auto-mode allows it; `protect-harness.sh` only hard-blocks subagents. The one exception is `.claude/settings.json`'s permissions/sandbox block, which the auto-mode classifier refuses as self-modification regardless of caller. So sandbox/permission changes are always human-applied by hand, even though other protected-file edits from the main thread just prompt.
- **A background/headless subagent can't answer a permission prompt.** It can only run hook-allowed or auto-allowed commands — anything that would fall through to `ask` effectively blocks it rather than pausing for input. Plan fixer/orchestrator commands accordingly when dispatching unattended.
- **Test hooks by piping sample JSON from a file**, not inline on the command line — trigger words (`git push`, `sudo`, a protected path) appearing in the *test* command's own text will trip the live hook before the hook under test ever runs.
- **The fix-worker must issue one shell command per `Bash` call.** A chained `&&`/`;`/`|` command falls outside the scoped-git policy's matcher and stalls rather than running or being cleanly denied.
