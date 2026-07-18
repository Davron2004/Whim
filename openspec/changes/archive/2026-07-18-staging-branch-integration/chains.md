# Context chains: staging-branch-integration

<!--
  Almost this entire change edits Class-2 control-plane files (scripts/, .claude/**) —
  those chains are HUMAN-BOOTSTRAP: a human applies the listed edits; no implementer is
  dispatched for them. The only dispatchable chain is docs. Regression-suite task 2.4 is
  part of the policy chain because its red-check must run against the same edit set.
-->

## chain-1: scripts-parameterization (HUMAN-BOOTSTRAP)

- tasks: 1.1–1.3
- rationale: both scripts share the target-branch/grant-schema vocabulary and are the mechanical substrate every later chain's wording refers to.
- reads: specs/staging-integration-lane/spec.md §"History cleanup targets the staging branch", §"Every harness run integrates on a per-run staging branch"; research.md (fixloop.sh + git-cleanup-check.sh sections)
- writes-contract: handoff/target-branch-params.md (final grant field names, env var seam, legacy-main mode semantics)
- human-bootstrap edits: `scripts/fixloop.sh` (gatefull prose + audit), `scripts/git-cleanup-check.sh` (grant schema + ref resolution + printed apply commands)

## chain-2: push-policy (HUMAN-BOOTSTRAP)

- tasks: 2.1–2.4
- rationale: one coherent policy edit set — hook, settings mirror, and the regression cases that red-check it must land together.
- reads: specs/staging-integration-lane/spec.md §"Scoped push policy", §"The active staging branch is protected like main"; research.md (bash-policy.sh + settings.json sections)
- writes-contract: handoff/push-policy.md (exact recognized push forms, ask-vs-deny matrix, suite case names)
- human-bootstrap edits: `.claude/hooks/bash-policy.sh`, `.claude/settings.json`; suite cases are written alongside and red-checked against the pre-change hook
- after: chain-1

## chain-3: loop-runbooks (HUMAN-BOOTSTRAP)

- tasks: 3.1–3.4
- rationale: all four runbook/agent files narrate the same run lifecycle and must tell one consistent story; they consume the exact parameter names and policy matrix fixed by chains 1–2.
- reads: specs/staging-integration-lane/spec.md (all requirements); handoff/target-branch-params.md; handoff/push-policy.md
- writes-contract: handoff/run-lifecycle.md (run-start step, closure checklist, nested-fix-loop rule — consumed by docs)
- human-bootstrap edits: `.claude/commands/opsx/apply.md`, `.claude/commands/fix-loop.md`, `.claude/commands/git-cleanup.md`, `.claude/agents/git-cleaner.md`, then `node scripts/sync-codex.mjs --write`
- after: chain-2

## chain-4: docs

- tasks: 4.1–4.3
- rationale: prose-only mirror of the settled mechanism; dispatchable (docs/ and CLAUDE.md are unprotected).
- reads: specs/staging-integration-lane/spec.md (all requirements); handoff/run-lifecycle.md; handoff/push-policy.md
- writes-contract: none
- after: chain-3
