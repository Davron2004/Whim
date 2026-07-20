# Progress ledger: automate-closure

Mode: **main-thread HUMAN-BOOTSTRAP** (user override — no implementer subagents; every
protected write ratified via the Claude Code permission dialog). Isolated worktree,
stop-before-closure.

## Run context

- run-start: staging branch `integration/automate-closure`, MAIN_TIP `cccbf45`
- worktree: `.claude/worktrees/automate-closure` (session isolated here)
- concurrent run active (`integration/linked-apps-data-model`) — user approved proceeding
  in isolated scope; no primary-tree merges, stop before closure.
- propose commit: `a0e1a86 propose automate-closure`

## Scope split

- **chain-1** (bootstrap: GitHub ruleset + SONAR_TOKEN): out-of-repo HUMAN — cannot execute here; surface to user.
- **chain-2** hook-unroller: implement here.
- **chain-3** remote-policy: implement here (after chain-2).
- **chain-4** sonar-script: implement here.
- **chain-5** closure-runbooks: implement here (after chain-3, chain-4).
- **chain-6** docs: implement here (after chain-5).
- **chain-7.1** gate-full: run from primary tree against committed tip.
- **chain-7.2** supervised first closure run: HUMAN-SUPERVISED — separate attended run.

## Dispositions (append as they happen)

- (setup) run-start recorded; worktree created; planning artifacts committed (`a0e1a86`).
- (env) auto-mode classifier initially blocked editing protected `.claude/**` files; user enabled
  attended approval → protected edits now ratified via the dialog.
- (handoff) handoff/*.md contracts SKIPPED — single-context implementation (no cross-agent handoff);
  the interfaces they'd carry are inlined here. Noted as a deliberate override deviation.
- **chain-2 (hook-unroller) DONE**: `.claude/hooks/unroll-command.mjs` (parser) + `bash-policy.sh`
  integration (worst-segment lattice deny>ask>none>allow, re-entrant per-segment eval guarded by
  WHIM_BASH_POLICY_SEGMENT) + `.claude/hooks/test/unroll.test.sh` (43 cases). unroll suite 43/43,
  existing bash-policy suite 19/19 (no regression). gate.sh wiring deferred to chain-5.
- **chain-3 (remote-policy) DONE**: `bash-policy.sh` push rework (main-push deny all callers incl
  refspec smuggling; main-thread branch push + force-with-lease auto-allow; subagent deny; compound
  push judged per-segment), Tier-1 relaxation (main-thread `git fetch origin` + `git pull --ff-only
  origin main`), gh vocabulary (read-only all callers; `pr create --draft`/`pr ready` main-thread;
  `pr merge` deny all; subagent mutations deny). `.claude/settings.json`: excludedCommands +=
  git push/fetch/pull, gh, sonar + ruleset-probe scripts; SONAR_TOKEN envVars-deny (scoped via
  script exclusion). `scripts/ruleset-probe.mjs` (fail-closed closure-entry probe). Suite updated:
  bash-policy 38/38, unroll 43/43.
  - SANDBOX ASSUMPTION (verify at attended first-run, chain-7.2): excludedCommands run on the bare
    host, so they see host env (SONAR_TOKEN for the sonar script; gh/git credential helper for
    push/gh) while sandboxed commands stay denied those. If an excluded command does NOT bypass the
    envVars deny, sonar auth fails LOUDLY (guarded, chain-4) — fail-safe, file as divergence.
