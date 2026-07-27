# Context chains: harden-gate-preconditions

<!--
  EVERY chain here is HUMAN-BOOTSTRAP. All five files touched — scripts/fixloop.sh,
  scripts/git-cleanup-check.sh, scripts/gate.sh, CLAUDE.md, docs/harness.md — are Class-2
  protected: protect-harness.sh hard-blocks subagents and prompts the main thread. Nothing here is
  dispatchable to an implementer. The chains still exist to fix ORDERING, which is load-bearing for
  this change (see chain-2's `after:`), and to keep each sitting small enough to ratify carefully.

  Attended session required. The permission prompt IS the Class-2 ratification, and per the
  automate-closure run it does not fire in a background/auto-mode session.
-->

## chain-1: harness-red-check  — HUMAN-BOOTSTRAP

- tasks: 1.1–1.6
- rationale: One new file, one working vocabulary (git fixtures + message assertions). Writing the
  suite first is not ceremony here: the bug is live and reproducible right now, which makes it the
  only fixture that proves the assertion fires against the real failure rather than a synthetic
  stand-in. Landing any fix first destroys that.
- reads: `specs/gate-preconditions/spec.md` §"The precondition behaviour is locked by a
  non-vacuous suite", §"A harness checkout is verified to have fully applied",
  §"Verification runs assert their preconditions"; `design.md` D2 (assert on message), D4 (synthetic
  fixture, not simulated sandbox); handoff: none
- writes-contract: `handoff/preflight-suite.md` — the suite's invocation contract: how it drives the
  `gatefull` precondition path, the fixture-construction helper, and the exact failure-message
  substrings each case asserts on. chain-2 must satisfy these strings verbatim.
- edits (Class-2, precise): CREATE `scripts/test/fixloop-preflight.test.sh`

## chain-2: gatefull-assertions  — HUMAN-BOOTSTRAP

- tasks: 2.1–2.6
- rationale: All five edits are in one function of one file (`gatefull` in `scripts/fixloop.sh`) and
  share a single invariant — verify, don't assume. Splitting them would mean multiple ratification
  passes over the same hunk.
- reads: `specs/gate-preconditions/spec.md` §"A partial success is never reported as success",
  §"A harness checkout is verified to have fully applied", §"Verification runs assert their
  preconditions", §"Diagnostic signal is preserved…"; `design.md` D1 (assert in the caller, not the
  tripwire), D3 (preserve stderr); handoff: `handoff/preflight-suite.md`
- writes-contract: none
- after: chain-1 — ordering that contracts alone do not capture. The suite must be observed RED
  against the unfixed script (task 1.6) before this chain turns it green; reversing the order leaves
  the assertions validated only against the synthetic fixture.
- edits (Class-2, precise): MODIFY `scripts/fixloop.sh` — the `gatefull)` case arm only

## chain-3: cleanup-apply-command  — HUMAN-BOOTSTRAP

- tasks: 3.1–3.3
- rationale: A different script and a different concern (printed-command correctness, not gate
  preconditions). Independent of chain-2's file, but it extends chain-1's suite file, so it is
  ordered rather than parallel — two chains must never touch the same file without a declared
  dependency.
- reads: `specs/staging-integration-lane/spec.md` §"The cleanup lane's printed apply command is
  valid for the lane's own topology"; `design.md` D5; handoff: `handoff/preflight-suite.md`
- writes-contract: none
- after: chain-1 — extends `scripts/test/fixloop-preflight.test.sh`, which chain-1 creates.
- edits (Class-2, precise): MODIFY `scripts/git-cleanup-check.sh`; EXTEND
  `scripts/test/fixloop-preflight.test.sh`

## chain-4: gate-wiring-and-docs  — HUMAN-BOOTSTRAP

- tasks: 4.1–4.2, 5.1–5.4
- rationale: Groups the one-line gate wiring with the documentation correction — both are
  "everything else is already true, now record it." The wiring cannot land before the suite exists
  (the gate would reference a missing file), and the docs should not be corrected until the
  behaviour they describe is real.
- reads: `specs/gate-preconditions/spec.md` §"The sandbox constraint on control-plane paths is
  documented as measured"; `research.md` §"Documentation check" (the documented / inferred /
  unresolved split must survive into the docs verbatim in spirit); `design.md` D6; handoff: none
- writes-contract: none
- after: chain-3 — 4.1 requires the suite from chain-1 and its extension from chain-3 to be final,
  so the wired `check` covers the whole suite.
- edits (Class-2, precise): MODIFY `scripts/gate.sh` (one `check` line); MODIFY `CLAUDE.md`;
  MODIFY `docs/harness.md`; APPEND `docs/decisions.md`

## Verification (not a chain)

Tasks 6.1–6.3 are run by the orchestrator/human after all chains merge, not dispatched:

- 6.1 `gate-full.sh` from the primary tree, unsandboxed, `FIXLOOP_INTEGRATION_BRANCH` set.
- 6.2 The real-bug confirmation — `gatefull` sandboxed against a branch that changes `.claude/**`,
  verifying the message now names an incomplete checkout rather than tamper. This is the task that
  distinguishes a fix from a plausible-looking edit.
- 6.3 The supervised closure observation (`automate-closure` task 7.2).

## Parallelism note

There is none, and that is deliberate rather than an oversight. chain-2 depends on chain-1 for
ordering, chain-3 shares chain-1's suite file, and chain-4 depends on the suite being final. Since
every chain is HUMAN-BOOTSTRAP and main-thread anyway, the dispatcher's parallel-worktree machinery
does not apply — serialization costs nothing here.
