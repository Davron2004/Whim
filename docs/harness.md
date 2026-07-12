# The Whim coding harness — canonical reference

> **This is the single source of truth for how Claude Code builds this repo.** Where any other
> document disagrees with this one, this one wins. Superseded design docs (kept for their
> spike evidence and decision rationale): [`archive/harness-build-guide.md`](./archive/harness-build-guide.md)
> (the original sequential single-tree design, June 2026) and
> [`archive/parallel-fix-loop.md`](./archive/parallel-fix-loop.md) (the worktree-parallel redesign
> and its validation log — bare §references elsewhere in the repo point into it).
> Visual pipeline diagrams: [`coding-harness-diagram.md`](./coding-harness-diagram.md).
>
> Runbooks and enforcement live in **real files, not in this doc** — this doc explains the *why*
> and the map; the pointed-at file is always authoritative for the *how*.

## 1. Principles

1. **Exit codes decide, prose reports claim.** The gate scripts and `fixloop.sh` subcommands are
   the definition of done; an agent's "all good" is never evidence.
2. **Information flows through files, never through context.** research.md → proposal artifacts →
   chains.md → handoff contracts → progress.md/dispositions.md ledgers. Every artifact is markdown
   in the repo: versioned, greppable, tool-agnostic.
3. **An agent that must pass the checks can never edit the checks.** The verification layer
   (Class 2, §4) is human-edited only, enforced by hooks, the gate's own tamper tripwire, and the
   integrity diff.
4. **The only trust anchor is a pinned BASE commit SHA.** Every integrity question is
   "diff vs BASE", never "diff vs HEAD" — an agent with commit rights can move HEAD and branch
   refs, but never a recorded SHA.
5. **Bounded autonomy, then escalate — never silent-drop.** Explicit caps everywhere; on
   cap-exhaustion or any protected-file touch, a human decides. Rejected work is PARKed
   (branch renamed `wip/*` + reason note), never deleted.
6. **Verification strength buys process freedom.** Fixers get narrow allowlists because code diffs
   are expensive to verify; the git-cleaner gets near-total freedom because tip-tree identity is
   one cheap check.

## 2. Roles

| Role | Where | Runbook / definition | Job |
|---|---|---|---|
| Proposer | main thread, `/opsx:propose` | `.claude/skills/openspec-propose/` + `openspec/schemas/whim-harness/` | Writes proposal/specs/design/tasks/chains from researcher digests. Never crawls code. |
| Researcher | subagent | `.claude/agents/researcher.md` | Read-only codebase digests, ≤120 lines. The main thread never reads >3 files itself. |
| **Dispatcher** | main thread, **`/opsx:apply`** | `.claude/commands/opsx/apply.md` | Routes by schema; orchestrates the chain dispatch loop; adjudicates; merges. Never implements. |
| Implementer | subagent, one per chain | `.claude/agents/implementer.md` | One context chain in its own worktree; self-gates; commits; reports. |
| Fix orchestrator | main thread, `/fix-loop` | `.claude/commands/fix-loop.md` | The parallel mechanical-fix loop over a findings list. |
| Fix-worker | subagent, one per finding | `.claude/agents/fix-worker.md` | Smallest fix + non-vacuous test in its own worktree. |
| Reviewer | subagent | `.claude/agents/reviewer.md` | Read-only diff-vs-report audit; default-reject; flags check-weakening HIGH. |
| Critic | subagent, `/critic-run` | `.claude/agents/critic.md` | Daily read-only problems report to `openspec/critic/`; fixes nothing. |
| Git-cleaner | subagent, `/git-cleanup` | `.claude/agents/git-cleaner.md` | History rewrite in a dedicated lane; outcome gated on tip-tree identity. |

Structural facts that shape this: subagents cannot spawn subagents (the orchestrator must be the
main thread), and a subagent's context dies with it (its fixed-format report is the entire
interface — hence mandatory report blocks).

**`/dispatch` no longer exists** (folded into `/opsx:apply`, 2026-07-07). The schema picks the
loop: `whim-harness` → chain dispatch, `whim-fixloop` → `/fix-loop`. The routing is recorded in
each schema's `apply.instruction` (`openspec/schemas/*/schema.yaml`), which survives openspec CLI
regeneration of the skill bodies — if a regenerated skill ever tells you to implement inline in
the main thread, the schema instruction wins.

## 3. Trust model

- **`main` is the integration branch** — the trusted, single-writer target every fix/chain merges
  into, serialized, with a fast regate after every merge. (`dev/v1` served this role through
  2026-07; it was fully merged into `main` at `559defe` and is retired. `fixloop.sh` reads
  `FIXLOOP_INTEGRATION_BRANCH`, default `main`.)
- **The main tree is trusted; worktrees under `.claude/worktrees/` are untrusted.** Subagents edit
  and commit freely in their own worktree; nothing is trusted until it passes integrity + the
  authoritative gate and is merged by the orchestrator.
- **BASE is recorded at worktree creation** (`git rev-parse main`) and recovered later as
  `git merge-base <branch> main`. Tamper check = `diff BASE` on protected paths; scope check =
  changed files ⊆ the declared allowlist.
- **The hermetic full gate** (`scripts/fixloop.sh gatefull <branch>`) runs `gate-full.sh` from the
  branch's *committed tip checked out into the main tree* — never the agent's worktree — because
  (a) untracked/gitignored poison in a worktree is invisible to the integrity diff but executed by
  a gate run there, and (b) Metro cannot resolve `node_modules` from a fresh worktree the way
  Node/esbuild/tsc can. "What you verified == what you tested."
- **Unattended runs** go through `.devcontainer/` (Docker, egress locked to the Anthropic API) —
  the container is the Threat-C boundary. See `.devcontainer/README.md`.

## 4. Enforcement map

The mechanical layer. Protected paths split by blast radius:

- **Class 2 — the control plane (NEVER agent-editable, never grantable):** `scripts/gate.sh`,
  `scripts/gate-full.sh`, `scripts/fixloop.sh`, `scripts/git-cleanup-check.sh`,
  `scripts/sync-codex.mjs`, `.claude/**` (hooks, settings, agents, commands, grants),
  `.codex/**` (the Codex mirror — its hooks are symlinks into `.claude/hooks/`, so an edit via
  the `.codex` path IS a control-plane edit), `invariants/`, `build/`. These *do the verifying*;
  a bad edit makes every other green check lie.
- **Class 1 — project config (grantable per-task):** `package.json`, `package-lock.json`,
  `tsconfig*.json`, eslint/knip config, `babel.config.js`, `metro.config.js`. Bounded blast
  radius; editable by a subagent only under an orchestrator-written grant
  (`.claude/fixloop/grants/<wt-id>`, agent-unwritable) and always human-ratified at merge.

| Mechanism | File | What it does |
|---|---|---|
| Fast gate | `scripts/gate.sh` | build → typecheck → lint → the five Node suites → scaffolding tripwires. Runs on every inner-loop attempt, in the agent's worktree. Refuses to run if any protected config differs from `GATE_BASE` (pinned-BASE tamper tripwire). Lint includes `plugin:sonarjs/recommended-legacy` (2026-07-12) — the same SonarJS rule implementations SonarCloud runs, so Sonar findings (cognitive complexity, nested ternaries, …) fail the inner loop locally instead of bouncing off the PR quality gate post-hoc. NOTE: the eslint plugin does NOT honor `// NOSONAR` comments — don't suppress, fix (or add a scoped `.eslintrc.js` override with a reason, a Class-1 human-ratified edit). |
| Full gate | `scripts/gate-full.sh` | `gate.sh` + knip + `guard:metro` + the three Chromium invariant suites + `openspec validate` + the codex-mirror freshness check. Once per fix/change, pre-merge, main tree. The Chromium suites generate their scenario pages from `src/runtime/generated/runtime-artifacts.json`, emitted by `npm run build` — so invariants always assert against *this* build, never a stale snapshot. |
| CI | `.github/workflows/invariants.yml` | Two blocking jobs on every push: `quality-gate` (typecheck, lint, knip, `openspec validate --all --strict`, scaffolding tripwires) and `isolation-suite` (every Node suite + `guard:metro` + `build` + all three Chromium invariant runners) — together effectively `gate-full.sh` on a fresh checkout. |
| SonarCloud (external) | GitHub PR quality gate | Automatic analysis on every push to a branch with an open PR — server-side, no repo config (`sonar-project.properties` deliberately absent), not runnable locally or in the deny-egress container. The local sonarjs lint (row 1) is the in-loop mirror of its rule set; SonarCloud stays the authoritative external check at PR time. It honors `// NOSONAR`; the local lint does not — keep code clean under the stricter of the two. |
| Deterministic toolkit | `scripts/fixloop.sh` | `integrity` (0 clean / 6 sanctioned Class-1 / 3 tamper / 4 scope), `redcheck` (0 RED / 5 vacuous-GREEN), `stale` (0 live / 7 already-fixed), `gatefull`, `park`, `finish`, `status`. Orchestrator-only: its internal git bypasses the hooks. |
| Bash policy | `.claude/hooks/bash-policy.sh` | Deterministic allow/deny on the command vocabulary: tier-1 git denies for everyone (push/fetch/config/reflog/ref-rewrites of main), scoped git for subagents inside their *own* worktree (owners binding), compound commands always fall through to a prompt, protected-path shell-writes denied. |
| Edit/Write policy | `.claude/hooks/protect-harness.sh` | Class 2 blocked for subagents everywhere (incl. inside worktrees); Class 1 blocked unless granted; memory store blocked (report `MEMORY:` field instead); main-thread edits to protected files → `ask` (the human ratifies). |
| Stop gate | `.claude/hooks/gate-on-subagent-stop.sh` | An `implementer` with a dirty main tree, or a `git-cleaner`, cannot finish until its gate passes (attempt-capped). Worktree agents self-gate instead — this hook is the legacy/backstop path. |
| Sandbox + permissions | `.claude/settings.json` | Deny-by-default egress, credential-path denies, `worktree.baseRef: head`, the auto-allow vocabulary. Sandbox-excluded (unsandboxed, attended-only) commands: the Chromium suites + `gate-full.sh` + `fixloop.sh`. |

The gate's own `CONFIG_SET`, `fixloop.sh`'s `CLASS2`, and the two hooks' pattern lists are
**deliberately the same set** — when you add a protected path, add it to all four.

## 5. The feature loop (`/opsx:propose` → `/opsx:apply`)

Planning: `/opsx:propose` under the `whim-harness` schema produces research.md → proposal.md →
specs → design.md → tasks.md → **chains.md** (tasks grouped into 3–7-task context chains, each
readable from spec excerpts + declared contracts only; dependencies declared via contract
reads/writes + explicit `after:`; Class-2-touching chains marked HUMAN-BOOTSTRAP). Contracts
(`handoff/*.md`) are interfaces — signatures, shared types verbatim, invariants, error surface —
never diaries.

Execution: the `/opsx:apply` dispatch loop (runbook: `.claude/commands/opsx/apply.md`):

1. Per eligible chain (deps merged): record BASE = `main` tip, pre-create an orchestrator-owned
   worktree + `chain/<change>-<id>` branch, `npm run build` in it, write `.phase` if the change
   uses a greenBy suite (§6).
2. One implementer per chain, in parallel where the DAG allows. Each self-gates `gate.sh`,
   commits, reports. Implementers do **not** tick tasks.md — the dispatcher ticks at merge.
3. Per report: adjudicate deviations (A log / B adjudicate / C halt), `fixloop.sh integrity`,
   then a **serialized** `--no-ff` merge into `main` + fast regate (fail → revert + park).
4. After the last chain: `gate-full.sh` on the merged tip, reviewer over the whole diff range,
   closing summary in progress.md, human-gated memory proposals, `/opsx:archive`.

## 6. Phased TDD across chains — greenBy

For a change that authors one test corpus up front (strict TDD) but turns it green across several
chains. Reference implementation + full contract:
`openspec/changes/archive/2026-07-12-static-check-pipeline/handoff/greenby-harness.md`.

- Each test is tagged `greenBy: <chain>` on the house ~30-line test harness (no shared framework).
- The runner reads an untracked, gitignored `<suite>/.phase` file holding one chain id:
  `.phase = N` ⇒ tests with `greenBy ≤ N` are *due* (must pass), later ones are tolerated
  *pending*; **`.phase` absent ⇒ strict** (everything due). Exit non-zero iff a due test fails.
- **XPASS** — a not-yet-due test that already passes — is reported, never swallowed: a test green
  before its code exists is probably vacuous (same ethos as the invariants negative control).
- The **dispatcher** writes `.phase` into each chain's worktree before dispatch (§5 step 1).
  Because `.phase` is untracked, it can never reach a commit — so the final `gate-full.sh` on the
  merged main tip and CI's fresh checkout are strict *by construction*, with no delete step to
  forget.
- Why a file and not an env var: `bash-policy.sh` auto-allows `./scripts/gate.sh` anchored at
  command start; an env-assignment prefix matches nothing and stalls a subagent on a prompt it
  cannot answer.
- Don't confuse this with the fast/full gate split: that split is cost-based (Metro/Chromium
  deferred); `.phase` encodes completeness-over-time.

## 7. Test classification (decided at PLAN time, honored by workers)

- **Behavioral** (changes observable I/O, error surface, persisted state, or executable control
  flow) → a test that fails without the change and passes with it; the deterministic red-check
  (`fixloop.sh redcheck`) is the gate.
- **Standing invariant** worth locking ("no `eval` in sandbox source", "this regex has ONE
  definition") → a static/structural assertion that encodes the *invariant, not the patch*
  (litmus: sensible to someone who never saw the diff). Reviewer judges it; no revert-RED expected.
- **Structural, no lasting invariant** (rename, dead-code deletion, internal refactor) → **no
  test**. Regression (existing suite green) + inspection is the honest assurance. A source-string
  grep as a stand-in for a behavioral test is bloatware and refactor-brittle — proven live
  2026-06-30 when a §F grep forced a comment-plant.

## 8. Fix-vs-relax — the human ratification checklist

Applied by the HUMAN at the two forced gates (the grant `ask` prompt; the integrity-exit-6 merge):

- Does the diff make config *more correct* (wrong value → right value, moved path repaired,
  genuinely-public export marked used)? → grantable.
- Does it make a *checker weaker* (eslint rule off/downgraded, tsconfig strictness loosened,
  knip `ignore` silencing a real finding, a script pulled from the gate, a dependency added)?
  → NOT grantable. That is the reward-hack shape — fix the code or PARK.
- Declared in the plan up front, or appeared mid-fix? A mid-fix protected edit means the fix is
  fighting the harness → default PARK.

The mechanism *detects* rather than trusts: the reviewer flags every check-weakening diff HIGH,
and `git push` is denied to everyone, so nothing reaches a shared remote without a human.

## 9. Current stance vs deliberate future upgrades

**Current (built, validated):** worktree-parallel execution for both loops; serialized merges into
`main`; scoped git + owners binding; Class-1 grants; greenBy; the git-cleanup lane; containerized
unattended fix-loop runs.

**Future (recorded, NOT built — build deliberately, never by accident):**
- *Fully-unattended grant tier:* orchestrator auto-grants land on a throwaway dirty-area branch
  (set `FIXLOOP_INTEGRATION_BRANCH`), human reviews the whole branch before it touches `main`.
- *Dependency adds by agents:* always human-in-the-loop — a Class-1 file grant alone cannot make
  one work (`npm install` is denied for supply-chain safety).
- *Red-check for chains:* the fix-loop's per-finding red-check has no chain-level equivalent yet;
  greenBy XPASS + the reviewer carry that weight for dispatched changes.
- *Codex overflow lane:* artifacts are already portable markdown; nothing to build until wanted.

## 10. Cross-agent mirror (Codex) — one source of truth, zero drift

The repo carries a Codex/ChatGPT mirror so the same harness contract survives a provider switch
(e.g. Claude tokens run out mid-task). **`.claude/` + `CLAUDE.md` are the source of truth; the
mirror is never hand-edited.** Two mechanisms, by file kind:

- **Identical content → symlinks.** `AGENTS.md → CLAUDE.md`, and `.codex/hooks/*.sh →
  ../../.claude/hooks/*.sh`. One file, two names — drift is structurally impossible. (Runbooks
  need no mirror at all: `.claude/commands/*.md` are plain markdown any agent can read.)
- **Different format → generated.** `.codex/agents/<name>.toml` is generated from
  `.claude/agents/<name>.md` by `scripts/sync-codex.mjs` (frontmatter → TOML keys, body →
  `developer_instructions`). After editing any agent definition, run
  `node scripts/sync-codex.mjs --write`. `gate-full.sh` runs `--check` (which also asserts the
  symlinks), so a stale mirror fails the gate instead of rotting silently — same philosophy as
  `src/runtime/generated/*`.

`.agents/` (openspec CLI multi-tool skill output) is vendor-generated and non-canonical; the
schema `apply.instruction` is the durable routing anchor if any generated skill body is stale.

## 11. Operational gotchas — do NOT re-derive these

- Subagents get their cwd re-pinned to the repo root on every Bash call (`cd` does not persist) —
  location-keyed policy accepts a verifiable `git -C <path>` form for this reason.
- One shell command per Bash call in subagents: compound commands (`&&`, `;`, `|`) always fall
  through to a prompt a background agent cannot answer.
- A background/headless subagent can't answer any permission prompt — anything outside the
  auto-allowed vocabulary blocks it silently. Plan dispatched commands accordingly.
- `git worktree add` that checks out `.claude/**` needs the OS sandbox off for that one command.
- An `isolation: worktree` tree is auto-removed at turn end "if unchanged" — hence the untracked
  `.gitkeep` pin. Orchestrator-pre-created worktrees don't have this problem (preferred).
- Metro does not walk up to the repo root's `node_modules` from a fresh worktree (Node/esbuild/tsc
  do) — hence the hermetic main-tree `gatefull`, and why `npm run build` must run in every fresh
  worktree before `typecheck`.
- Test hooks by piping sample JSON from a file — trigger words in an inline test command trip the
  live hook before the hook under test runs.
- The main thread CAN edit protected files (each edit prompts the human) — except
  `.claude/settings.json`'s permissions/sandbox block, which is always human-applied by hand.
- Findings lists go stale: `fixloop.sh stale <evidence-file>` before dispatching any fix; prose
  judgment proposes, the stale check disposes.
