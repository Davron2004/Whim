# Proposal: automate-closure

## Why

The closure phase of every harness run (push → draft PR → Sonar iteration → git-cleanup → merge) is currently attended-only *and human-executed*: the human pushes, opens the PR, transcribes Sonar findings from the web UI, runs the cleanup lane's ref-move and force-push by hand, and performs the final merge. The human's actual authority need — reviewing the finished diff — is one act, but the harness makes them the executor of five mechanical steps. Two of the guards that force this are now replaceable by stronger mechanisms: GitHub branch protection (server-side, agent-tamper-proof) can own "nothing lands on main without a human," and a compositional command-unrolling policy can make multi-step remote workflows expressible without weakening the deny kernel. The push path is also currently broken in practice: an approved scoped push still runs inside the deny-egress OS sandbox with no route to github.com and no credentials, so "granted" pushes fail.

## What Changes

- **Compound-command unrolling in `bash-policy.sh`** (new Node helper): a command joined by top-level `&&`/`||`/`;`/`|` is unrolled into segments; the compound's verdict is the worst segment verdict (deny > ask > allow). Anything containing command substitution (`$()`, backticks), eval-family wrappers (`bash -c`, `eval`, `xargs`, `env`), expansion in command position, or process substitution is never unrolled — it falls through to today's generic prompt. Redirect targets are checked as pseudo-writes against the protected-path list. Match-anywhere hard-denies (`sudo`, `curl`, …) stay checked against the raw string before any parsing.
- **Server-side main protection replaces the local ask as the merge gate**: a GitHub ruleset on `main` (require PR, block force-push, restrict deletion, require status checks) — configured once by the human, outside the repo. **BREAKING (policy):** with that in place, main-thread pushes to non-main branches (including `--force-with-lease` to `integration/*`) become auto-allow; the documented "ask-never-allow for remote writes" invariant is re-anchored to the GitHub ruleset + PR review instead of a per-push prompt. Subagent push denial stays unconditional. Local denial of any push naming `main` stays as belt-and-braces.
- **Sandbox carve-outs so approved remote commands actually work**: the push forms, `gh`, and the Sonar ingestion script get network egress (excludedCommands or allowlist); a `SONAR_TOKEN` passthrough is scoped to the ingestion script only.
- **Orchestrator-executed closure pipeline** in `apply.md` step 12 (reused by standalone `/fix-loop`): push → `gh pr create --draft` → poll `gh pr checks` → ingest Sonar issues → nested fix-loop rounds until green → git-cleanup → force-push-with-lease → wait for re-analysis → `gh pr ready`. The draft→ready flip is the "come review now" signal; the human's merge click on the protected PR is the ratification; teardown (branch deletion, local main ff-sync) is orchestrator-executed afterward.
- **`git-cleanup` executes its own ref-move and force-push** (previously printed for the human), still gated by the pinned tree-identity check and backup ref. New standing grouping rule: Sonar-fix commits are folded into the semantic commits they touch — none survive as standalone commits.
- **Sonar issue ingestion script** (`scripts/sonar-pr-issues.mjs`): pulls open issues + quality-gate status for a PR from the SonarCloud Web API (Bearer user token; the project is private, so anonymous reads 404) and emits them in the fix-loop findings-file format, feeding the existing `findings.md` → `plan.md` → `dispositions.md` flow and the sonar-ledger transcription. Must guard the verified silent-failure mode: `issues/search` returns HTTP 200 `total:0` for an invisible project, so the script hard-fails auth via `api/components/show` before trusting an empty result.
- **`docs/harness.md` §4/§8/§11 amended**: attended-only closure → automated closure on the attended host; compositional unroll policy and server-side main protection recorded as trust anchors. Tier-1 `git fetch` / `git pull --ff-only` relaxed to main-thread-allow for the ancestor check and teardown.

## Capabilities

### New Capabilities
- `compound-command-policy`: compositional unrolling of compound Bash commands in the policy hook — worst-segment verdict, fail-closed to prompt on anything not a plain word-list command, raw-string deny kernel checked first.
- `sonar-issue-ingestion`: programmatic retrieval of SonarCloud issues + quality-gate status for a PR into the fix-loop findings-file format, with auth-visibility guard.

### Modified Capabilities
- `staging-integration-lane`: the "Scoped push policy preserves human-gated remote writes" requirement is re-anchored — human gating moves from a per-push ask prompt to the GitHub ruleset on `main` plus PR review; branch pushes become main-thread auto-allow (subagents still denied all pushes). The "External quality iteration happens on a draft PR" and "History cleanup targets the staging branch" requirements gain orchestrator-executed closure: draft→ready flip as the review signal, cleanup lane executes ref-move + force-push under its existing gate, human merge click is the sole ratification act.

## Impact

- **Class-2 protected files (every edit human-ratified):** `.claude/hooks/bash-policy.sh` (+ new unroller helper under `.claude/hooks/`), `.claude/settings.json`, `.claude/commands/opsx/apply.md`, `.claude/commands/git-cleanup.md`, `.claude/commands/fix-loop.md`.
- **New repo code:** `scripts/sonar-pr-issues.mjs` (not gate-protected; the server-side quality-gate check on the PR remains the enforcement, so tampering only wastes a round).
- **Docs:** `docs/harness.md` (canonical), `docs/decisions.md` (new decision entry).
- **Human one-time setup (out of repo):** GitHub ruleset on `main`; SonarCloud user token provisioned as `SONAR_TOKEN`.
- **Unchanged:** subagent push denial, devcontainer egress boundary (closure still cannot run unattended in the container), protect-harness Class-1/2 write protection, sonar-ledger recurrence discipline, `invariants/` ownership.
