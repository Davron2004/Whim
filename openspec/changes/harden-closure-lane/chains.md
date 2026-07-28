# Context chains: harden-closure-lane

<!--
  EVERY chain here is HUMAN-BOOTSTRAP, for the same reason as harden-gate-preconditions: the files
  touched — .claude/commands/opsx/apply.md, docs/harness.md, scripts/fixloop.sh — are Class-2
  protected. (.claude/hooks/bash-policy.sh was on this list until 2026-07-27; chain-3's re-scope
  removed it — see that chain's note.) protect-harness.sh hard-blocks
  subagents and prompts the main thread. Nothing here is dispatchable to an implementer, so the
  dispatcher's parallel-worktree machinery does not apply; the chains exist to fix ORDERING and to
  keep each sitting small enough to ratify carefully.

  Attended session required. The permission prompt IS the Class-2 ratification, and it does not fire
  in a background/auto-mode session.

  PREREQUISITE: `automate-closure` owns apply.md and is still active with task 7.2 as its only open
  item. Tick 7.2 (and preferably archive it) before starting chain-1 — otherwise two changes edit
  apply.md concurrently.
-->

## chain-0: resolve-open-question — HUMAN-BOOTSTRAP, NOT A CODE CHANGE

- tasks: 0.1
- rationale: D2 is a genuine open question about owner intent, not something measurement can settle,
  and it decides which of two files chain-3 edits. Asking it is cheap; implementing the wrong branch
  is not — one direction re-broadens a security policy without cause.
- reads: `design.md` D2; `research.md` §F2
- writes-contract: none — the answer is recorded in `design.md` itself
- edits: `design.md` only (not Class-2)
- note: blocks **only** chain-3. Chains 1, 2 and 4 proceed regardless; do not serialize the whole
  change behind an unanswered question.

## chain-1: poll-predicate — HUMAN-BOOTSTRAP

- tasks: 1.1–1.5
- rationale: One defect, one predicate, one suite file plus one runbook step. Red-check first, as in
  the predecessor change: the bug is live and reproducible right now, which makes it the only
  fixture that proves the assertion fires against the real condition. Landing the fix first destroys
  that evidence.
- reads: `specs/staging-integration-lane/spec.md` §"The closure poll requires a positive verdict
  from every required check"; `specs/gate-preconditions/spec.md` §"A partial success is never
  reported as success" (the absent-result and runbook scenarios); `design.md` D1; `research.md` §F1
- writes-contract: `handoff/poll-predicate.md` — how the predicate is invoked and classified, and
  the exact strings the suite asserts on. chain-3 must not diverge from it when rewriting 12f/12g.
- edits (Class-2, precise): EXTEND `scripts/test/fixloop-preflight.test.sh`; MODIFY
  `.claude/commands/opsx/apply.md` — step 12c only

## chain-2: park-staging-branch — HUMAN-BOOTSTRAP

- tasks: 2.1–2.4
- rationale: A different file and an independent concern from the poll. Grouped with its own test
  and its own negative control, since widening an accepted-input set is exactly the change that can
  silently become "accept anything".
- reads: `specs/staging-integration-lane/spec.md` §"A staging run can be parked by the documented
  tool"; `design.md` D5; `research.md` §F3
- writes-contract: none
- after: chain-1 — it extends `scripts/test/fixloop-preflight.test.sh`, which chain-1 also edits.
  Two chains must never touch the same file without a declared dependency.
- edits (Class-2, precise): MODIFY `scripts/fixloop.sh` — the `park)` case arm only; EXTEND
  `scripts/test/fixloop-preflight.test.sh`

## chain-3: document-what-is-enforced — HUMAN-BOOTSTRAP

**RE-SCOPED 2026-07-27.** Chain-0 resolved D2 as a void premise: the hook already implements the
relaxation and the docs already describe it correctly (`progress.md` has the probe evidence). The
original chain — "correct §4 **or** restore the hook relaxation" — would have either enshrined a
documentation error or re-broadened a security deny for no cause. **`.claude/hooks/bash-policy.sh`
is no longer edited by this chain**, and neither is its test suite: there is no behaviour change to
lock. What remains is the residual that is genuinely real (the compound exclusion), the friction
that was always real (F2b), and the new finding F5/D7.

- tasks: 3.1–3.5
- rationale: All five tasks now describe *what the policy already enforces* and *what the
  environment actually provides*, and they land in the same two documents. One reconciliation, one
  ratification sitting.
- reads: `specs/staging-integration-lane/spec.md` §"Every command a closure step instructs is a
  command the policy permits"; `design.md` D2 (resolution), D3 (reversal), D4, D7; `research.md`
  §F2b; `progress.md` §"Pre-dispatch re-measurement"; handoff: `handoff/poll-predicate.md`
- writes-contract: none
- after: chain-0 (needs the resolution) and chain-1 (both edit `apply.md`; chain-1 owns 12c, this
  chain owns step 12's preamble and 12g — sequential to avoid a conflict in one file)
- edits (Class-2, precise): MODIFY `docs/harness.md` — §4 bash-policy row (bare-form constraint,
  F2b workaround, why 12f's local check stays); MODIFY `.claude/commands/opsx/apply.md` — step 12
  preamble (false carve-out claim) and step 12g (joined forms). **NOT** `bash-policy.sh`, **NOT**
  `bash-policy.test.sh`
- note: task 3.4 is a *deliberate non-edit* — 12f keeps its local ancestor check (D3 reversed). It
  is a task because the reason must be written down, or the next reader "simplifies" it into a `gh`
  call that cannot run under the sandbox.

## chain-4: record-the-unfixable — HUMAN-BOOTSTRAP

- tasks: 4.1–4.4 (**4.4 added 2026-07-27** — CLAUDE.md's open-question paragraph, now answered by D7)
- rationale: "Everything else is already true, now write it down." The decision entry must come last
  so it can record D2's resolution as settled fact rather than as a pending question.
- reads: `specs/staging-integration-lane/spec.md` §"Teardown states the expected residue of a
  sandboxed branch deletion"; `design.md` D6, D7, D8; `research.md` §F4 and §"What the run
  validated"; `progress.md` §"Pre-dispatch re-measurement"
- writes-contract: none
- after: chain-3 — 4.3 records D2's resolution, and 4.1 edits the same step 12g that chain-3 rewrites
- edits (Class-2, precise): MODIFY `.claude/commands/opsx/apply.md` — step 12g; MODIFY
  `docs/harness.md`; APPEND `docs/decisions.md`; MODIFY `CLAUDE.md` (not Class-2, but `AGENTS.md`
  symlinks to it — both change together)

## Verification (not a chain)

Tasks 5.1–5.4 are run by the orchestrator/human after all chains merge:

- 5.1 `gate.sh`, 5.2 `gate-full.sh` from the primary tree, unsandboxed.
- 5.3 The real-condition confirmation — poll immediately after a push and verify it reports
  **pending**, not green. This is the task that distinguishes a fix from a plausible-looking edit,
  and it is the direct analogue of the predecessor change's task 6.2.
- 5.4 The runbook sweep for other absence-read-as-success predicates. File, don't fix.

## Parallelism note

chain-1 and chain-2 both touch the suite file; chain-3 and chain-4 both touch `apply.md`; chain-3
additionally waits on chain-0's answer. So the order is chain-0 ∥ chain-1 → chain-2, then chain-3 →
chain-4. Since every chain is HUMAN-BOOTSTRAP and main-thread, the dispatcher's parallel machinery
does not apply and serialization costs nothing — except for chain-0, which is a question and should
be asked at the very start so it is not on the critical path.
