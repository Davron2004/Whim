# Research digest: What does the harness's closure phase (push → draft PR → Sonar iteration → git-cleanup → merge) currently require of the human, and which enforcement layers (hook / permission / sandbox / devcontainer / remote) govern remote git and gh operations?

## Relevant files
- `docs/harness.md` — canonical trust model (§3), enforcement map (§4), attended-only gotcha (§11)
- `.claude/commands/opsx/apply.md` — step 12 CLOSURE runbook (literal sequence)
- `.claude/commands/git-cleanup.md` — cleanup lane; human-only ref-move + force-push
- `.claude/commands/fix-loop.md` — CLOSURE section (standalone vs nested reuse of apply.md step 12)
- `.claude/settings.json` — sandbox block, permissions.allow/deny, hooks wiring
- `.claude/settings.local.json` — no push/gh entries present
- `.claude/hooks/bash-policy.sh` — authoritative git-push/git-remote decision logic (lines 40-317)
- `.claude/hooks/protect-harness.sh` — Edit/Write only; no git/Bash logic
- `.git/config` — `remote "origin"` = `https://github.com/Davron2004/Whim.git` (HTTPS)
- `.github/workflows/invariants.yml` — CI jobs; no SonarCloud step present
- `.devcontainer/init-firewall.sh` — unattended-run firewall allowlist (line 26)

## Current behavior
Closure is the last stage of both `/opsx:apply` (whim-harness schema) and standalone `/fix-loop` runs: push the staging branch, open a draft PR into `main`, iterate SonarCloud findings via a nested fix-loop, run `/git-cleanup` on the staging branch, then a human final-merges into `main` and tears down. Every step is written to require a human at the point a Git ref or GitHub state actually changes. The runbook text (apply.md step 12) explicitly labels the whole phase "attended only." Push approval is mediated by `bash-policy.sh`, a `PreToolUse(Bash)` hook: subagents are denied every push form outright; the main thread's push is denied unless it is the single, uncompounded, exactly-anchored form `git push origin integration/<id>` containing neither `main` nor `dev/v1` anywhere as a substring, in which case it becomes a scoped `ask` (never `allow`) so a human reviews the literal refspec. All other remote-mutating git (`fetch`, `pull`, `clone`, `remote`, `config`, `reflog`, `gc`) is hard-denied for every caller, including the orchestrator. `gh` is unmentioned in any policy file, so `gh pr create`/etc. fall through to the ordinary interactive permission flow rather than being hook-governed. `git-cleanup.md` prints the ref-reset and `--force-with-lease` push commands for the human to run by hand rather than executing them. `.claude/settings.json`'s sandbox block has no `network`/`allowedDomains` key — only `filesystem.denyWrite`, `credentials.files/envVars`, and `excludedCommands` (which does not list `git push`) — and harness.md's enforcement table characterizes this as "deny-by-default egress." Unattended runs execute inside `.devcontainer/`, whose firewall (`init-firewall.sh`) allow-lists only `api.anthropic.com` and `console.anthropic.com`, so `github.com` is unreachable there regardless of any permission grant. SonarCloud itself has no repo-local config (no `sonar-project.properties`) and no step in `.github/workflows/invariants.yml`; per harness.md it runs as an external, server-side PR check triggered by the approved push.

## Constraints and invariants
- Ask-never-allow for remote writes: the scoped push `ask` is documented (harness.md §8) as the mechanism ensuring "nothing reaches a shared remote without a human ratifying it" — any change must preserve `ask` as the terminal decision for the one permitted push shape, never promote it to `allow`.
- Subagent push denial is unconditional (bash-policy.sh: `AGENT_ID` set → push always denied) — this must not become conditional on worktree/ownership state the way scoped git commands are.
- Fail-closed substring matching on `main`/`dev/v1` in push refspecs is deliberate (harness.md §8, bash-policy.sh comments) — "rename the branch instead" is the documented workaround, not a policy relaxation.
- `git-cleanup`'s outcome gate is tree-tip identity against a pinned `TARGET_TREE`/`TARGET_SHA` recorded before the agent runs, plus an intact `backup/pre-cleanup-<ID>` ref as the undo path (git-cleanup.md) — the two dangerous ops (ref move, force-push) must stay human-executed, never agent-executed.
- Class-2 (`.claude/**`, `scripts/gate*.sh`, `scripts/fixloop.sh`, `invariants/`, `build/`) is never agent-editable and never grantable (protect-harness.sh, bash-policy.sh PROTECTED regex) — any closure-automation work must not touch these paths itself without human ratification.
- `openspec/critic/sonar-ledger.md` promotion rule: a finding needs ≥3 distinct fix-round run-ids on the same rule/location before promotion to an `.eslintrc.js` rule (harness.md §4) — this ledger discipline is a standing process invariant, not something closure automation should bypass.
- Fix-loop findings flow (`findings.md` → `plan.md` → `dispositions.md`, stale-check before dispatch) is the sanctioned path for Sonar-finding iteration inside closure — Sonar findings must enter through this same file-based flow, not ad hoc.
- Devcontainer egress boundary (`api.anthropic.com`, `console.anthropic.com` only) is the Threat-C boundary for unattended execution — closure's remote steps cannot be moved into that container without also changing the firewall, which is itself Class-2/human-owned territory.

## Integration points
- `bash-policy.sh` git-push branch (~lines 127-156): the anchored-form check, the `main`/`dev/v1` substring denial, and the `ask()` call are the exact decision points any push-automation change would touch.
- `bash-policy.sh` Tier-1 hard-denies (~lines 165-173): `git fetch`/`git remote`/`git config`/etc., denied for every caller including orchestrator — relevant if closure automation wants read access to remote state.
- `bash-policy.sh` compound-command fall-through (~line 223): any chained command (`&&`, `;`, `|`) bypasses the scoped-push `ask` path entirely and lands in the generic permission flow — a boundary for any multi-step push+PR automation.
- `.claude/settings.json` `sandbox` block (`excludedCommands`, `filesystem`, `credentials`) and `permissions.deny` line for `Bash(git push origin main:*)` — the settings-level belt-and-braces layer that sits in front of bash-policy.sh.
- `apply.md` step 12 (a-e) — the literal closure sequence text that any new automation would replace or wrap.
- `git-cleanup.md` Setup/Dispatch/Adjudicate/Teardown sections — the grant (`.claude/fixloop/grants/git-cleanup`), the printed human-apply commands, `scripts/git-cleanup-check.sh` as the outcome gate.
- `fix-loop.md` CLOSURE section (bottom) — nested-vs-standalone reuse of apply.md step 12, the `FIXLOOP_INTEGRATION_BRANCH` handoff.
- `.github/workflows/invariants.yml` `pull_request` trigger — where CI (and implicitly SonarCloud's external hook) fires off the approved push.
- `scripts/fixloop.sh` (`gatefull`, `park`, `finish`, `status` subcommands) — orchestrator-only toolkit already wired into the closure/fix-loop sequence.

## Risks and unknowns
- I did not verify the exact enforcement mechanism behind "deny-by-default egress" for the host OS sandbox — whether it's a macOS Seatbelt profile, an environment-level proxy, or something else — nor whether an implicit default allowlist for `git`/HTTPS exists outside what's visible in `.claude/settings.json`.
- I did not verify the credential path for `git push` over HTTPS to `https://github.com/Davron2004/Whim.git` — both `GITHUB_TOKEN` and `GH_TOKEN` are explicitly sandbox-denied env vars (`settings.json` credentials.envVars), so it's unconfirmed how/whether an approved push actually authenticates.
- I did not independently verify SonarCloud's external wiring (GitHub App install, org-level webhook/config) — that configuration lives outside the readable file tree; harness.md's claim of "server-side, no repo config" is taken as documentation, not directly inspected.
- Whether `gh pr create` succeeds today depends on the ambient `gh` CLI auth state and the standard interactive permission flow — neither is governed by any file I read, so its actual behavior is unconfirmed.

## Open questions for the planner
1. Should closure automation run on the host (attended) only, or is a supervised-but-scripted variant intended that still stops at the same `ask` prompt — undecidable from code, since the current design has no partial-automation precedent to extrapolate from.
2. Is the target to automate PR creation (`gh pr create`) specifically, given it currently has zero hook governance (neither allowed nor denied) — this gap is a design choice point, not something the existing files resolve.
