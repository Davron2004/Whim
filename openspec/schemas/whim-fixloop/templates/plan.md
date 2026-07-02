# Plan: <!-- batch id -->

<!--
  One DONE spec per finding, produced by a READ-ONLY planner subagent — the
  orchestrator never explores code itself. Planning rules:
  .claude/commands/fix-loop.md step 1 (+ §6.7 test classification).
  The Checklist is what `openspec status` tracks: tick a box ONLY when the
  finding reaches a terminal ledger event in dispositions.md
  (merged / parked / escalated / skipped) — never on a worker's say-so.
-->

## Checklist

- [ ] <finding-id> — <one-line>

## <finding-id>

- reconciled: <planner's evidence the defect still exists at HEAD>
- fix sketch: <the smallest fix>
- allowlist: <glob patterns, one per line — saved to a temp file for `fixloop.sh integrity`>
- test-class: <behavioral | structural-no-test | invariant>
- test: <what it asserts + expected red-without-fix — behavioral class only>
- severity: <low | med | high>
- class-1 grant: <none | config file + why the edit CORRECTS (never relaxes) the config>

### EVIDENCE

<!-- Verbatim buggy lines as they read at HEAD, inside the fence:
     "## <repo-relative-path>" then the quoted line(s). The orchestrator saves
     the fence contents to a temp file and runs `scripts/fixloop.sh stale <file>`
     BEFORE creating a worktree — exit 7 (missing at HEAD) = stale, do NOT
     dispatch; exit 0 = finding live. -->

```
## <path/to/file.ts>
<verbatim line(s) from HEAD>
```
