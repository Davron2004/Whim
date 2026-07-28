# Task 5.4 — runbook sweep for other "absence read as success" predicates

Filed, not fixed, per the task. Scope: `.claude/commands/**` and `.claude/agents/**`, searching for
conditions whose *absence* branch proceeds rather than verifies. Two instances of the class found,
both milder than F1 (neither produces a false green *verdict*), plus three near-misses recorded so a
later sweep does not re-examine them.

**Not filed under `openspec/critic/<date>.md` deliberately:** `critic-run` treats the newest
date-named file there as its "everything since" marker, so creating one would make the next critic
run skip all history before today. This lives in the change folder instead.

## Instance 1 — `.claude/commands/opsx/archive.md:47`

> **If no tasks file exists:** Proceed without task-related warning.

The preceding branch, when `tasks.md` *does* exist with unticked tasks, prompts the user for
confirmation. When the file is missing entirely it proceeds **silently** — the stronger signal gets
the weaker response. For a `whim-harness` change `tasks.md` is a required artifact
(`applyRequires: [tasks, chains]`), so its absence at archive time means either the change was never
planned or the file was lost, and both warrant the prompt that a merely-incomplete file gets.

Same shape as F1: an absent artifact is read as "nothing to check" rather than "establish why it is
absent". Suggested disposition: treat a missing required artifact as at least as loud as an
incomplete one.

## Instance 2 — `.claude/commands/opsx/archive.md:51`

> Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed without sync
> prompt.

A change that was supposed to carry delta specs but lost them archives with the live specs never
updated, and nothing says so. The "no deltas" case is legitimate for changes that genuinely have
none, so the fix is not to refuse — it is to distinguish *declared none* from *expected but absent*.
The schema knows which changes require specs; the runbook does not consult it.

## Near-misses — checked, correct, recorded so they are not re-examined

- `.claude/commands/critic-run.md:1` — chains fallbacks and **escalates to the human** when all are
  absent ("if none, ask me for a ref"). This is the correct shape: absence terminates in a question,
  not a default.
- `.claude/commands/fix-loop.md:6` — `git branch --list 'integration/*'` is empty → proceed. Here the
  absence *is* the precondition being asserted (no run active), not a proxy for one. Correct.
- `apply.md` step 12d — already guarded: `scripts/sonar-pr-issues.mjs` exit code 3 marks an
  auth-visibility failure and the runbook says in terms "never trust an empty result". This is the
  pattern the two archive.md branches are missing, and it is worth copying rather than reinventing.

## Note on coverage

This swept runbooks, which is what the task scoped. It did **not** sweep `scripts/**` or
`.github/workflows/**` for the same class. Decision #50 covered the gate scripts specifically; the
workflows are unexamined for this defect class and are a reasonable target for a follow-up.
