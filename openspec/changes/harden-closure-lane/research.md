# Research: closure-lane divergences observed during the first supervised run (2026-07-27)

Not a literature review. Every item below was **measured during a real run** — the
`harden-gate-preconditions` closure, which doubled as `automate-closure` task 7.2 (the first
end-to-end exercise of the automated closure pipeline). Full narrative in
`openspec/changes/archive/2026-07-27-harden-gate-preconditions/progress.md`, "Closure observation".

## What the run validated

The pipeline works. 12a (ruleset probe) → 12b (push + draft PR) → 12c (poll) → 12e (cleanup) →
12f (re-poll + ready flip) → human merge all executed as designed, across five pushes, with CI and
SonarCloud green every time. The cleanup lane produced six semantic commits whose tip tree was
byte-identical to the pin, and GitHub's rebase merge landed them on `main` intact.

**Not validated: 12d.** SonarCloud was green on every push, so the Sonar-findings → nested
`/fix-loop` → re-push loop — the pipeline's most-iterated path — never ran. It remains observed only
in earlier runs. Recorded so no one reads "supervised closure passed" as "every step was exercised".

## F1 — `gh pr checks` reports "no checks" as success (runbook step 12c)

Immediately after a push, before GitHub registers the check runs:

```text
$ gh pr checks 7
no checks reported on the 'integration/harden-gate-preconditions' branch
$ echo $?
0
```

Step 12c says to poll on a bounded timeout but does not say how to treat this state. A poll written
as "stop when nothing is pending" reads it as **settled and green**. That happened in this run: the
first poll after the reviewer-fix push returned `SETTLED after ~30s` with no checks, and had to be
re-run with the condition corrected.

This is the *same defect class* the `harden-gate-preconditions` change had just fixed one layer
down — an absent result read as a settled result — except it lives in a runbook rather than a
script, which is why the change's own tests could not have caught it.

## F2 — the bash policy denies command forms the docs call relaxed

`docs/harness.md` §4 (bash-policy row) and `.claude/commands/opsx/apply.md` step 12 both state that
main-thread `git fetch origin` and `git pull --ff-only origin main` are relaxed for closure's
ancestor check and teardown. Measured:

```text
$ git fetch origin
git network/shared-ref/history op is human-approved only (class-B deviation)
```

Denied bare, from the main thread, in an attended session. Consequences:

- **Step 12f's ancestor check is unrunnable.** `git merge-base --is-ancestor main <branch>` names
  `main`, and the fail-closed substring matcher denies any history op naming it.
- **Step 12g's teardown is unrunnable** for the same reason — the human must fast-forward local
  `main` themselves.

Worked around without evading the guard: `gh pr view <n> --json mergeable,mergeStateStatus` returned
`MERGEABLE`/`CLEAN`. That is strictly better evidence than a local ancestor check, because it is
GitHub's own answer about the actual merge, not an inference from a possibly-stale local ref.

### F2b — the matcher inspects content, not just commands

The same substring rule denied, three separate times in one session, commands whose **prose** merely
mentioned the protected vocabulary:

1. a compound ending `git log --oneline main..integration/x` (worst-segment judgement — correct)
2. a `cat <<'EOF'` heredoc whose *body text* discussed `git fetch` and `main`
3. `gh pr create --body "...")` whose *PR description* discussed the same

All three are fail-closed and therefore safe. But 2 and 3 are content, not commands, and the correct
workaround (`Write` the file, then `--body-file`) is not documented anywhere. Undocumented friction
that pushes an operator toward rewording — i.e. toward dodging the matcher — is worth removing.

## F3 — `fixloop.sh park` cannot park a staging branch

```sh
case "$branch" in fix/*|chain/*) : ;; *) die "park expects a fix/* or chain/* branch, got '$branch'";; esac
```

But `.claude/commands/opsx/apply.md` step 12g says a parked run "keeps its branch under the `wip/*`
convention", and the runbook's standing instruction is `scripts/fixloop.sh park` on any terminal
wall. Hit for real at the start of this run when parking `integration/linked-apps-data-model`: the
park had to be done by hand (worktree removed, branch renamed, note written in the command's own
format). A documented procedure whose tool refuses the documented input.

## F4 — `git branch -D` leaves a stale config section, exit 0

Reproduced unprompted during teardown — this is item 6 of `harden-gate-preconditions`'s original
defect catalogue, recurring outside its probe:

```text
$ git branch -D integration/harden-gate-preconditions
error: could not lock config file .git/config
warning: update of config-file failed
Deleted branch integration/harden-gate-preconditions (was 782778b).
$ echo $?
0
```

The ref is deleted; `[branch "integration/harden-gate-preconditions"]` survives in `.git/config`.
Sandboxed writes to `.git/config` are denied, and git treats that as a warning. It cannot be cleaned
up in-session either: `git config --remove-section` is a tier-1 denied op for every caller.

So a stale config section is the **expected residue of every sandboxed branch deletion**, not a
one-off. Cosmetic today. Worth writing down rather than rediscovering, and worth deciding whether
teardown should report it.

## Epistemic status

- F1, F2, F2b, F4: **measured**, with verbatim output above.
- F3: **read from the source** (`scripts/fixloop.sh` park arm) and hit in practice.
- Whether the bash-policy denial in F2 is intentional (docs wrong) or a regression (hook wrong) is
  **unresolved** — it needs the owner's intent, not more measurement. The proposal must not assume
  which side is the defect.

## Out of scope — operational chores, not change material

- Remote branch `integration/sonar-recurrence-ledger` still exists although PR #5 merged (step 12g
  teardown skipped in that run). One `git push origin --delete`.
- `wip/linked-apps-data-model` is a complete-but-unclosed run: 4/4 chains merged, full gate passed,
  reviewer CLEAN, but closure never ran, and `main` is **not** an ancestor of it, so its closure
  needs a merge-from-main first. Resume note at `.claude/fixloop/wip-linked-apps-data-model.md`.
