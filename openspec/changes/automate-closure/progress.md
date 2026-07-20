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

## Closing summary

- **Chains run:** 2 (hook-unroller), 3 (remote-policy), 4 (sonar-script), 5 (closure-runbooks +
  gate wiring), 6 (docs) — all implemented main-thread (user-ratified per override), committed.
- **Redispatches:** 0. **Deviations:** handoff/*.md contracts skipped (single-context, no
  cross-agent handoff); gate-wiring for chains 2+4 deferred into chain-5 per chains.md; unroll suite
  wired as a `check` (not the grep tripwire block) since it's a real suite.
- **Reviewer verdict:** 3 findings (2 HIGH, 1 MED), all real; report honest. F1 (gh api mutation)
  and F3 (glob redirect) FIXED with +9 suite cases; F2 (implicit-ref push) resolved as by-design
  (ruleset is the gate — user decision) with a prose note. No regressions.
- **Verification:** fast gate GREEN (unroller 46, bash-policy 44, sonar 10, build/typecheck/lint/all
  Node suites/Codex adapters); knip + sync-codex + openspec-validate GREEN; guard:metro + Chromium
  invariants provably unaffected + CI-deferred (see 7.1).
- **MEMORY candidate (for user ratification):** in a background/auto-mode `opsx:apply` run, the
  auto-mode classifier blocks even the MAIN THREAD's edits to Class-2 protected files
  (`bash-policy.sh`, `settings.json`, `.claude/commands/*`) — HUMAN-BOOTSTRAP chains need attended
  approval, not just a bg session. (Extends [[background-agents-cant-execute]].)
- **Remaining (all attended/human, out of this session's scope):** chain-1 SONAR_TOKEN provisioning
  (ruleset done; token = personal User Token) + 1.3 verify; task 7.2 supervised first closure run;
  the closure push/PR/merge itself (CI runs authoritative gate-full there).

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
- **chain-7.1 (gate) PARTIAL/GREEN-for-affected**: fast gate GREEN in-worktree (unroller 43,
  bash-policy 38, sonar 10, build, typecheck, lint, all Node suites, Codex adapters). gate-full
  additions that can be affected: knip GREEN (new files out of scope, not flagged), sync-codex
  `--check` GREEN, `openspec validate` change VALID. `guard:metro` + Chromium invariants
  environment-blocked in a worktree (documented @babel/runtime resolution limit); provably
  unaffected (no Metro/runtime/SDK/launcher/bridge code touched). Definitive gate-full = CI fresh
  checkout at push, or `fixloop.sh gatefull` from a clean primary tree.
- **chain-1 (bootstrap) — HUMAN, OUT-OF-REPO, NOT DONE HERE**: create the GitHub ruleset on `main`
  (require PR, block force-push, restrict deletion, require checks); provision a dedicated
  `SONAR_TOKEN` on the host; verify `Davron2004_Whim` visible via `api/components/show`. The runbook
  refuses closure without the ruleset (ruleset-probe). These block the first closure run (7.2).
- **chain-7.2 — HUMAN-SUPERVISED, separate attended run** (see task note).
- **reviewer pass (step 11)**: dispatched over cccbf45..HEAD; VERDICT = 3 findings (2 HIGH, 1 MED),
  all real. Report honesty: matches diff. Resolutions:
  - F1 (HIGH, gh api mutation via `-f`/`-F`/`--input` misclassified as read-only → subagent write
    hole, NO server-side backstop) → FIXED: `gh api` is read-only only when explicit GET or no data
    param; else routes to caller rules (subagent deny / main-thread prompt). +6 suite cases.
  - F2 (HIGH per reviewer: bare `git push origin [HEAD]` auto-allows, can reach main) → NOT a code
    change — USER DECISION: the server-side ruleset is the gate; name-anchoring the hook is brittle
    (would block differently-named branches) and adds no security (main is ruleset-protected). Kept
    broad allow; added prose comment (bash-policy.sh push case) documenting the ruleset backstop.
  - F3 (MED, glob metacharacter in redirect target evades literal PROTECTED match) → FIXED: redirect
    targets with `*?[]` fail closed to deny (bash would expand `settin?s`->`settings` at run time).
    +3 suite cases.
  - reviewer confirmed PASS: compound composition, subagent push denial, refspec smuggling,
    `gh pr merge` deny-all, tier-1 relaxation not-relaxed-in-compound, sonar auth-visibility guard,
    no regressions in git -C scoping / owners / cleanup lane / fixloop deny.
- **chain-6 (docs) DONE**: `docs/harness.md` §4 (bash-policy + sandbox rows rewritten; SonarCloud
  row now cites the ingestion script), §5 step 4, §8 (ask-never-allow re-anchored to server-side
  main protection + compound policy), §9 current-stance buckets, §11 (compound-unrolling gotcha +
  closure now orchestrator-executed-on-attended-host). `docs/decisions.md` #49 (D1–D6). Fast gate
  green (docs are outside CONFIG_SET/test scope).
- **chain-5 (closure-runbooks) DONE**: `apply.md` step 12 rewritten as the orchestrator-executed
  pipeline (ruleset probe → push → draft PR → bounded/parkable poll → Sonar ingest via script →
  nested fix-loop → cleanup → orchestrator force-push → ready flip + notify → human merge click →
  teardown). `git-cleanup.md`: orchestrator executes ref-move + force-push on gate pass; Sonar-fix
  folding rule added. `fix-loop.md` CLOSURE re-pointed to the new step 12. `gate.sh`: wired
  `check "sonar ingestion"` + `check "compound unroller"` (the two deferred suites).
- **chain-4 (sonar-script) DONE**: `scripts/sonar-pr-issues.mjs` (importable module + CLI: paged
  issues/search, project_status gate, components/show auth-visibility guard, fix-loop findings-file
  output; exit 0/10/3 verdict) + `scripts/test/sonar-pr-issues.test.mjs` (10 mocked-HTTP cases:
  pagination-to-exhaustion, guard failure modes incl. the 200/total:0 masquerade, findings shape,
  clean/red gate). eslint clean (justified sonarjs disable on gh shell-out in ruleset-probe).
  gate.sh Node-suite wiring deferred to chain-5.
