# Design: automate-closure

## Context

Closure today is human-executed end to end: the runbook labels the phase "attended only," `bash-policy.sh` surfaces exactly one push shape as a scoped ask and denies everything else, `git-cleanup.md` prints its ref-move and force-push for the human, `gh` is ungoverned, and the final merge is manual (research.md, Current behavior). Two enforcement defects compound this: (1) an *approved* push still executes inside the OS sandbox, which has no network allowlist ("deny-by-default egress") and denies `GITHUB_TOKEN`/`GH_TOKEN`, so it fails after approval (research.md, Current behavior + Risks); (2) the hook's compound-command fall-through means any `push && gh pr create` chain bypasses the scoped-ask path entirely (research.md, Integration points). The human's real authority act — reviewing the finished diff — is buried under five mechanical steps.

External facts established during proposal research (session-verified, 2026-07-18): the SonarCloud project `Davron2004_Whim` is **private** (404s anonymously while sibling org projects are public), so issue reads require a user token; `api/issues/search?componentKeys=…&pullRequest=…&resolved=false` and `api/qualitygates/project_status?projectKey=…&pullRequest=…` were verified live; `issues/search` on an invisible project returns HTTP 200 with `total:0` (silent-failure mode); SonarCloud's GitHub PR decoration is lossy (new-code-only issues, 50-annotation API cap, no rule/issue keys in annotations); the official SonarQube MCP server requires Docker and ~25 tools of standing context.

## Goals / Non-Goals

**Goals:**
- The human's closure involvement collapses to one act: reviewing and merging the ready-for-review PR on GitHub. Everything before it (push, draft PR, Sonar rounds, cleanup, force-push, ready flip) and after it (teardown) is orchestrator-executed.
- Compound commands become expressible under policy without weakening the deny kernel: piecewise-allowed segments compose to an allowed compound; everything else fails closed to a prompt.
- Sonar findings reach agent context programmatically, in the fix-loop findings-file format, with no web-UI transcription.
- Approved remote commands actually work (sandbox egress + credential path fixed).

**Non-Goals:**
- Unattended closure. The devcontainer egress boundary is untouched (research.md, Constraints); closure runs on the attended host. "Attended" now means "present," not "executing."
- Relaxing subagent git policy in any way. Subagents remain local-only: every push form denied, unconditionally (research.md, Constraints).
- Replacing the fix-loop findings flow or sonar-ledger discipline — Sonar ingestion feeds the existing `findings.md` → `plan.md` → `dispositions.md` path and the ledger transcription (research.md, Constraints).
- Adopting the SonarQube MCP server or axi.md tooling.

## Decisions

### D1. Compositional unrolling with a worst-segment verdict, implemented in a Node helper

A compound command joined by top-level `&&`, `||`, `;`, `|` is parsed into segments; each segment is evaluated against the existing per-command policy; the compound verdict is the minimum (deny > ask > allow). If any segment is ask-tier, the whole compound surfaces as one ask showing the full command line.

**The composition boundary.** Connectors compose *effects* and add no capability an agent lacks (sequential execution and temp-file relays already exist). Command substitution (`$()`, backticks), eval-family wrappers (`bash -c`, `sh -c`, `eval`, `xargs`, `env <cmd>`), variable expansion in command position, and process substitution compose *text into a future command* — the composed command's identity depends on runtime output, so piecewise evaluation is unsound. These are never unrolled; they fall through to today's generic permission flow. Fail closed **to the prompt**, never to allow.

**Parser:** a small Node helper invoked by `bash-policy.sh` (shell-parsing-in-shell is not honestly achievable; Node is already required by the harness). It implements a strict tokenizer that either fully understands the line (plain word-list commands, single/double quotes, the four connectors) or returns "not unrollable." Redirect targets (`>`, `>>`) are emitted as pseudo-segments ("write to path X") checked against the protected-path list, because shell redirects are invisible to the Edit/Write hook (`protect-harness.sh` has no Bash logic — research.md, Relevant files).

**Deny kernel stays pre-parse:** the match-anywhere hard-denies (`sudo`, `curl`, `wget`, `npm install`…) are checked against the raw string before the unroller runs, so a parser bug can never resurrect them.

*Alternative considered:* regex-splitting inside the shell hook — rejected; quoting makes it wrong in both directions, and a wrong split in the allow direction is a policy bypass. *Alternative:* full bash AST library — rejected as dependency weight; the conservative tokenizer covers the closure pipeline's actual command shapes and everything else keeps current behavior.

### D2. GitHub ruleset on `main` replaces the per-push ask as the human gate

One-time human setup: a branch ruleset on `main` — require PR before merging, block force pushes, restrict deletions, require status checks. This is server-side and agents cannot edit it, making it strictly stronger than any local hook for the property it guards ("nothing lands on main without a human"). With it in place:

- Main-thread pushes to non-`main` branches, including `git push --force-with-lease origin integration/<id>`, become **auto-allow** in `bash-policy.sh`.
- The documented "ask-never-allow" invariant (research.md, Constraints) is **amended, not violated**: its purpose — a human ratifies everything reaching the shared remote's protected state — is re-anchored to the ruleset + PR review. Branch pushes are staging-lane traffic; the protected state is `main`, and the human ratification act is the merge click on the reviewed PR.
- The fail-closed `main`/`dev/v1` substring denial stays as belt-and-braces (a local instant deny beats a server rejection).
- Subagent push denial: unchanged, unconditional.
- Tier-1 relaxation, main thread only: `git fetch origin` and `git pull --ff-only origin main` become allowed — needed for the ancestor check and post-merge teardown (research.md, Integration points: Tier-1 denies currently block even the orchestrator).

*Alternative considered:* keep ask-per-push (~2–4 taps per run) — rejected by the owner: with server-side main protection the taps guard nothing the ruleset doesn't, and they force attendance at machine-paced moments.

### D3. Sandbox carve-outs scoped to the exact ask/allow-gated command shapes

The push forms, `gh`, and the Sonar ingestion script are added to the sandbox's `excludedCommands` (or given a network allowlist for `github.com`/`sonarcloud.io` if per-host allowlisting is available). Rationale: these commands are policy-gated *before* execution, so unsandboxing them does not widen what an agent can invoke — it fixes the verified defect where approval succeeds and execution fails (research.md, Risks: egress mechanism + HTTPS credential path unverified; the carve-out makes both moot by running the command in the normal host environment where git's credential helper works). `SONAR_TOKEN` passthrough is scoped to the ingestion script invocation only; `GITHUB_TOKEN`/`GH_TOKEN` remain sandbox-denied.

### D4. Closure is one orchestrator-executed pipeline; draft→ready is the review signal

`apply.md` step 12 becomes:

```
push → gh pr create --draft → poll gh pr checks
  ↺ [quality gate red? → sonar-issue-ingestion → nested /fix-loop on the
     staging branch → push → re-poll]
→ /git-cleanup (folding rule: sonar-fix commits absorbed into the semantic
  commits they touch) → reset + force-push-with-lease (orchestrator-executed,
  gated) → wait for re-analysis green → gh pr ready → notify human
→ [human reviews, clicks Merge — the ratification act]
→ teardown: delete integration branch local+remote, ff-sync local main
```

Standalone `/fix-loop` reuses the same sequence via its existing closure reference. The GitHub check-run side is used only as **trigger and verdict** (`gh pr checks` polling); the issue list always comes from the Sonar API (decoration verified lossy: new-code-only, annotation cap, no rule keys). `gh` gains hook vocabulary: read-only forms auto-allow; `pr create --draft`, `pr ready` allow for main thread; `pr merge` denied (merging is the human's act on GitHub); all `gh` mutations denied for subagents.

*Alternative considered:* orchestrator merges via `gh pr merge` after a chat approval — rejected; the PR review UI is where the human already is, the merge button is the natural signature, and denying `gh pr merge` keeps "agent merges into main" impossible locally as well as server-side.

### D5. git-cleanup executes its own dangerous ops, still behind the same gate

The cleanup lane's safety was never the human's typing — it is the pinned `TARGET_TREE`/`TARGET_SHA` identity check, the `backup/pre-cleanup-<id>` ref, and `--force-with-lease` (research.md, Constraints). On `CLEANUP GATE PASS` the orchestrator now executes the ref move and the force-push itself. The research digest's "must stay human-executed" line records the *current* documented rule; this change amends that rule deliberately, with the gate as the retained safety property. New standing grouping guidance in `git-cleanup.md`: no Sonar-fix commit survives as a standalone commit — each is folded into the semantic commit(s) whose code it touches.

### D6. Sonar ingestion via Web API script, not MCP, not GitHub annotations

`scripts/sonar-pr-issues.mjs` (Node — `curl` stays hard-denied): fetches `api/issues/search` (paged, `resolved=false`, `pullRequest=<n>`) and `api/qualitygates/project_status` with `Authorization: Bearer $SONAR_TOKEN`, and emits fix-loop-format findings plus the quality-gate verdict. **Auth guard is mandatory:** before trusting any result it hits `api/components/show?component=Davron2004_Whim`, which honestly 404s when unauthorized — because `issues/search` returns 200/`total:0` for an invisible project, a bad token otherwise masquerades as a green gate. The script is not gate-protected: the server-side quality-gate check on the PR is the enforcement, so tampering only wastes a round.

*Alternatives considered:* official SonarQube MCP server — rejected for the harness path (Docker dependency in closure, ~25 tools of standing context weight, docs currently split across conflicting sources); remains fine for ad-hoc interactive use. GitHub check-run annotations as the issue source — rejected as structurally lossy (see Context).

## Risks / Trade-offs

- [Unroller parser bug allows a segment it shouldn't] → deny kernel is checked pre-parse on the raw string; unrollable grammar is minimal and fails closed to a prompt; unit tests in the fast gate cover quoting, nested-substitution, and redirect cases, including adversarial ones.
- [Auto-allowed branch pushes let a compromised main thread spam remote branches] → branches are free by declared policy (protected state is `main`, server-enforced); `--force-with-lease` bounds destructiveness; subagents — the actual worker population — remain fully denied.
- [GitHub ruleset misconfigured or silently edited] → closure preconditions include a one-time `gh api` probe that the ruleset exists and blocks direct pushes; the runbook refuses to enter closure without it.
- [SonarCloud analysis latency makes polling hang] → poll with a bounded timeout and surface a parked, resumable state rather than spinning; the existing `fixloop.sh park` pattern applies.
- [Force-push after cleanup races a Sonar re-analysis] → the tree is byte-identical by gate construction, so the verdict cannot change; the pipeline still waits for the check to re-report on the new SHAs before flipping to ready.
- [`SONAR_TOKEN` leakage via the carve-out] → passthrough is scoped to the single script invocation; the token is a read/write *user* token only because SonarCloud has no finer read scope — mitigate by dedicating a token to this use so revocation is cheap.
- [Amending documented invariants ("ask-never-allow", "human-executed force-push") confuses future agents] → `docs/harness.md` §4/§8/§11 and a new `docs/decisions.md` entry are updated in the same change; the spec delta for `staging-integration-lane` is the normative record.

## Migration Plan

1. Human one-time setup (blocking, out of repo): GitHub ruleset on `main`; SonarCloud user token provisioned as `SONAR_TOKEN` on the host.
2. Land hook/settings/runbook/docs edits (all Class-2 → HUMAN-BOOTSTRAP chains, batched ratification per harness convention).
3. First closure run after landing is supervised: the human watches the pipeline but executes nothing; divergences are filed as findings.
4. Rollback: revert the runbook text and hook changes; the GitHub ruleset is independently valuable and stays regardless.

## Open Questions

- Whether the sandbox supports per-host network allowlisting (preferable to `excludedCommands` for the Sonar script) — resolve at implementation time by testing; `excludedCommands` is the known-working fallback. (research.md, Risks: egress mechanism unverified.)
- Merge method on the PR (merge commit vs rebase): default to merge commit, preserving the current one-ratified-merge-per-run shape on `main`; owner may flip to linear later via the ruleset.
