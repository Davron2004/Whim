## Why

The verification harness acts on preconditions it never checks, and in four measured cases it
reported a **partial success as success**. The worst instance: `fixloop.sh gatefull` runs
`git checkout --detach <branch>`, which cannot write under `.claude/**` when sandboxed, prints
`Operation not permitted` for each file — **and still exits 0**. `fixloop.sh` discards that stderr,
so the half-applied tree reaches `gate.sh`, whose tamper tripwire then accuses the change of
editing the control plane. The symptom names the wrong cause, and the operator has to disprove a
tamper accusation to find a failed checkout. Full measured evidence, including a four-run
root-cause probe and a documentation check, is in `research.md`.

This matters more than an ergonomics complaint: a verification harness that can silently
half-apply is worse than one that refuses to run. Everything downstream — "the gate passed" —
inherits that unverified assumption. Six instances of the same defect class surfaced in a single
closure run, so this is a pattern in how the harness is written, not six unrelated bugs.

A second, independent problem: `CLAUDE.md` and `docs/harness.md` currently **assert something
false**. They claim the Chromium-dependent commands "are carved out of the host sandbox via
`excludedCommands`", and that claim is the stated justification for routing unattended runs
through the devcontainer. Measured: no `excludedCommands` entry took effect, and per Claude Code's
documentation the `.claude/**` write denial is architectural and *cannot* be lifted by
`excludedCommands` at all. A document asserting a protection works when it does not is worse than
no document, because decisions get built on it.

## What Changes

- `scripts/fixloop.sh gatefull` verifies its own pre/postconditions instead of assuming them:
  - stop redirecting the checkout's stderr to `/dev/null` — it discards the one diagnostic signal
  - after `git checkout --detach`, assert the tree actually landed; on mismatch fail naming the
    unwritten paths and the likely cause, rather than letting `gate.sh` mis-report it as tamper
  - assert it is running in the primary tree, not a linked worktree
  - assert the target branch is related to `INTEGRATION_BRANCH`, so an unset
    `FIXLOOP_INTEGRATION_BRANCH` cannot silently produce a confident verdict against a wrong baseline
  - fix the false `FAILED TO RESTORE` alarm, which fires even when the tree *did* restore correctly
- `scripts/git-cleanup-check.sh` prints an apply command that works when the target is checked out
  in a run worktree — which, under the staging lane, is always. Today it prints
  `git checkout <TARGET> && git reset --hard …`, which fails with "already used by worktree".
- New red-checkable suite `scripts/test/fixloop-preflight.test.sh`, wired into `scripts/gate.sh`.
  It asserts on the **message**, not merely the exit code: wrong-message-on-right-condition *is*
  the bug. A negative control keeps it non-vacuous, mirroring the `invariants/` discipline.
- **Documentation correction** in `CLAUDE.md` and `docs/harness.md`: replace the false
  `excludedCommands` claim with the measured behaviour — harness operations touching `.claude/**`
  require an attended explicit sandbox override or the devcontainer, **permanently, not pending a
  fix**. Preserve `research.md`'s documented / inferred / unresolved distinction rather than
  flattening it into false certainty.

Not breaking: every assertion converts a silent wrong answer into a loud correct one. A run that
passes today for good reasons still passes.

## Capabilities

### New Capabilities
- `gate-preconditions`: the verification harness checks its own preconditions and postconditions
  before trusting a result, and fails with the *accurate* cause rather than a misleading downstream
  symptom. Covers the primary-tree assertion, the checkout-landed assertion, the baseline-relation
  assertion, diagnostic-signal preservation, and the standing rule that a partial success is never
  reported as success.

### Modified Capabilities
- `staging-integration-lane`: the cleanup lane's printed apply command must be valid for the lane's
  own normal topology (target checked out in a run worktree). Adds the measured sandbox constraint
  on closure operations that touch `.claude/**`.

## Impact

- `scripts/fixloop.sh`, `scripts/git-cleanup-check.sh`, `scripts/gate.sh` — **all Class-2
  protected**. No implementer subagent can touch them; every chain is HUMAN-BOOTSTRAP and
  main-thread, ratified through the permission dialog.
- `scripts/test/fixloop-preflight.test.sh` — new suite, new `check` in the fast gate.
- `CLAUDE.md` (and its `AGENTS.md` symlink), `docs/harness.md` — documentation correction.
- No product code, no runtime/SDK/storage/launcher surface. `guard:metro` and the Chromium
  invariant suites are unaffected.

**Out of scope, deliberately.** Relocating the versioned harness sources out of `.claude/`
(`harness/hooks/`, `harness/commands/`, with `.claude/` holding thin pointers) is the candidate
structural fix for the underlying collision — this repo versions its control plane inside
`.claude/`, which the sandbox reserves as untouchable configuration. That is a separate timeboxed
spike with an explicit kill criterion, not part of this change.

**Run note.** This change is intended to double as the task-7.2 supervised-closure observation run
for the just-merged `automate-closure`. Its closure will be the first exercise of the automated
pipeline; divergences are filed as findings, not fixed inline. Note that the fixes here only take
effect once *this* change merges, so its own closure still runs against the old behaviour — which
is deliberate, and gives a clean before/after boundary.
