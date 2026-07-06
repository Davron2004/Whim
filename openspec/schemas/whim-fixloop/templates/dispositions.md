# Dispositions: <!-- batch id -->

<!--
  Append-only run ledger, written by the orchestrator AS EACH disposition
  happens — never batched at the end, never rewritten (correct by appending).
  Initialize this file BEFORE dispatching any worker: it plus the fix/* and
  wip/* branches are the resume state if the orchestrator's context dies.

  Line shape: - <UTC time> <finding-id> <event> — <detail>
  Events: stale-ok | stale-skip
        | worktree-created (branch, BASE sha, path)
        | fix-reported | redcheck-red | redcheck-vacuous
        | integrity-<0|3|4|6> | verify-ok | verify-reject
        | gatefull-pass | gatefull-fail
        | merged (sha) | regate-pass | regate-fail (reverted)
        | parked (reason, wip/ branch) | escalated (why) | skipped (why)
  Exactly ONE terminal event per finding: merged | parked | escalated | skipped.
-->

## Ledger
