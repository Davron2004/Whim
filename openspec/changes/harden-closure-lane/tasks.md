# Tasks: harden-closure-lane

Every file touched here is **Class-2 protected** (`.claude/commands/opsx/apply.md`,
`.claude/hooks/bash-policy.sh`, `docs/harness.md`, `scripts/fixloop.sh`, `scripts/gate.sh`). No
implementer subagent can edit them — every task is main-thread and human-ratified through the
permission dialog. See `chains.md`.

**Prerequisite:** `automate-closure` task 7.2 must be ticked and that change archived, or at least
not concurrently edited — it owns `apply.md`, which chains 1 and 3 both modify.

## 0. Resolve the open question (blocks chain-3 only)

- [ ] 0.1 Put design D2 to the owner: is the documented `git fetch` / `git pull --ff-only` relaxation for the main thread (a) a doc overstatement of something never implemented, or (b) a hook regression that lost a relaxation it should have? Record the answer and its rationale in `design.md` before touching either file. Default if there is no recollection: treat the docs as wrong, because correcting a doc is reversible and re-broadening a deny is not

## 1. The closure poll asserts a positive verdict

- [ ] 1.1 Extend `scripts/test/fixloop-preflight.test.sh` with the poll-predicate case: given tool output reporting that no checks exist for the branch and exit 0, the predicate SHALL classify it as **pending**, not settled — assert on the classification, not on a timing outcome (design D1)
- [ ] 1.2 Add the settled case and the negative control: explicit pass/fail verdicts for every required check classify as settled; a mix of pass and pending classifies as pending
- [ ] 1.3 Confirm the suite is RED against the current predicate before changing it, and record the observed output in `progress.md`
- [ ] 1.4 Rewrite `apply.md` step 12c so the poll continues while any check is pending **or** the tool reports no checks, and concludes only on an explicit verdict from every required check; keep the bounded timeout and the park-on-timeout behaviour
- [ ] 1.5 Turn the suite GREEN; re-confirm the negative control still passes

## 2. `fixloop.sh park` accepts a staging branch

- [ ] 2.1 Extend the suite with the park case: parking a staging branch renames it under `wip/*` and writes a reason note; parking an unrecognised branch kind still refuses (the negative control that keeps 2.2 from becoming "accept anything")
- [ ] 2.2 Widen `scripts/fixloop.sh`'s park case arm to accept `integration/*`, deriving `wip/<id>` the same way (design D5)
- [ ] 2.3 Make a staging park's note record that resuming closure may require reconciling with the base branch first, since the base can advance past a parked run and the ancestry check would then fail — this is the fact that makes a parked staging run resumable, learned by hitting it
- [ ] 2.4 Verify against the real case: the note `park` now generates carries the same information the hand-rolled `.claude/fixloop/wip-linked-apps-data-model.md` had to record

## 3. Reconcile policy and documentation, and fix the unrunnable steps

- [ ] 3.1 Apply D2's answer: correct `docs/harness.md` §4's bash-policy row, or restore the relaxation in `.claude/hooks/bash-policy.sh` — whichever the owner's decision indicates. Do not do both
- [ ] 3.2 Rewrite `apply.md` step 12f's ancestor check to use the provider's mergeability report (`gh pr view <n> --json mergeable,mergeStateStatus`) rather than a local ancestry check requiring a fetch (design D3 — independent of D2)
- [ ] 3.3 Rewrite `apply.md` step 12g's teardown so every command it instructs is one the policy permits for the caller named; where the human must run something themselves, say so explicitly
- [ ] 3.4 If D2 resolved as "hook wrong", extend `.claude/hooks/test/bash-policy.test.sh` with the restored form and its negative control. If "docs wrong", add no test — there is no behaviour change to lock
- [ ] 3.5 Document the content-vs-command matcher friction (F2b) beside the policy description in `docs/harness.md`, with the sanctioned workaround — supply the text through a file (`Write` + `--body-file`, or the Edit tool) rather than rewording prose until the guard stops firing (design D4)

## 4. Record what was learned but cannot be fixed

- [ ] 4.1 State in `apply.md` step 12g that a sandboxed branch deletion leaves a stale `[branch "…"]` section in `.git/config` while exiting 0, that this is expected and cosmetic, and that it cannot be cleaned in-session because `git config` is denied to every caller (design D6)
- [ ] 4.2 Record in `docs/harness.md` that closure step 12d (the Sonar-findings → nested `/fix-loop` → re-push loop) was **not** exercised by the first supervised run, since SonarCloud was green on every push — so "supervised closure passed" must not be read as "every step is validated"
- [ ] 4.3 Append a decision entry to `docs/decisions.md`: the absent-result-is-not-success rule extends to runbooks, the documented-vs-enforced reconciliation, and D2's resolution

## 5. Verification

- [ ] 5.1 `scripts/gate.sh` green on the change tip
- [ ] 5.2 `scripts/gate-full.sh` green on the change tip, from the primary tree, unsandboxed, with `FIXLOOP_INTEGRATION_BRANCH` set
- [ ] 5.3 Exercise the rewritten poll on a real closure and confirm it reports pending — not green — when polled immediately after a push, which is the condition that produced F1
- [ ] 5.4 Sweep the runbooks for any other predicate that reads an absence as success (design Open Questions); file what is found rather than fixing it inline
