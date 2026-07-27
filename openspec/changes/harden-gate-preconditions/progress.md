# Progress ledger: harden-gate-preconditions

Schema `whim-harness`. **Every chain is HUMAN-BOOTSTRAP** — all five touched files are Class-2
protected, so nothing is dispatchable to an implementer. Per the operator's decision this run is an
**attended main-thread session**: chains run serially, each Class-2 edit ratified through the
permission dialog. The dispatcher's parallel-worktree machinery does not apply (chains.md
"Parallelism note").

## Run start

- 2026-07-26 preconditions — gate scripts present and committed clean; primary tree clean. FAILED
  the one-active-run check: `integration/linked-apps-data-model` was live, checked out in
  `.claude/worktrees/ladm-orchestrator` at 6120cef. Surfaced to the operator.
- 2026-07-26 prior run PARKED (operator decision) — ladm was complete through runbook step 11
  (4/4 chains merged, gate-full PASSED on d0e0b1c, reviewer CLEAN) but closure never ran. Note:
  `scripts/fixloop.sh park` REJECTS `integration/*` branches (accepts only `fix/*` / `chain/*`),
  so the park was performed by hand: worktree removed, `integration/linked-apps-data-model` renamed
  to `wip/linked-apps-data-model`, reason note written to
  `.claude/fixloop/wip-linked-apps-data-model.md` in the command's own format. **This is a harness
  finding in its own right** — runbook step 12g says a parked run "keeps its branch under the
  `wip/*` convention", but the command that implements parking cannot park a staging branch.
- 2026-07-26 run-start — MAIN_TIP = c8da79f33d0278b176a9477aea4ee49e65cacd8f. Staging branch
  `integration/harden-gate-preconditions` cut from **3976bc6**, not from MAIN_TIP directly:
  `main` does not contain this change's planning folder, which lives only on the local
  `harden-gate-preconditions` branch. Verified `3976bc6^ == c8da79f`, so the "every BASE traces to
  the recorded MAIN_TIP ancestor" invariant holds and the staging branch carries the artifacts it
  implements. `FIXLOOP_INTEGRATION_BRANCH=integration/harden-gate-preconditions` for every
  `fixloop.sh` invocation this run.
- 2026-07-26 note — the old `harden-gate-preconditions` branch is left in place as a backup ref
  pointing at 3976bc6; delete at closure.

## Chain dispositions

### chain-1: harness-red-check (tasks 1.1–1.6) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 started — no worktree, no implementer: Class-2, attended main-thread.
- 2026-07-26 fixture-mechanism decision (Class-A deviation from design D4) — D4 called for "a
  throwaway git fixture with a deliberately dirtied tree". A *dirtied* tree cannot work: `gatefull`
  refuses on a dirty primary tree before reaching the assertion under test. Measured alternative
  adopted instead — a **read-only parent directory**, which reproduces the defect through git's own
  mechanism rather than simulating a sandbox:

  ```
  error: unable to unlink old 'a/x.txt': Permission denied
  checkout rc=0                 <-- the entire defect, in git itself
  ```

  git warns per file, updates every path it CAN write, and still exits 0; `git diff --quiet <branch>`
  then detects the stranded path. This is the same mechanism by which `gate.sh`'s tripwire noticed
  the stranded files during the research probe, so the assertion is validated against the real
  failure shape, not a stand-in. D4's stated objection to `chmod` ("tests the OS rather than our
  contract") does not apply: the barrier is only the trigger; what is asserted is our contract.
  Root bypasses directory permissions, so the suite PROVES the barrier bit and reports a FAILURE if
  it did not — never a silent skip. Both gate environments are non-root (CI `ubuntu-latest` as
  `runner`; devcontainer `USER node`).
- 2026-07-26 **RED CHECK (task 1.6) — 11 passed / 11 FAILED against the unfixed `fixloop.sh`**.
  Observed messages, verbatim:
  - **case 1 (incomplete checkout)** — the half-applied checkout **REACHED THE GATE**
    (`STUB-GATE-FULL-RAN` present), then printed
    `fixloop: FAILED TO RESTORE the primary working tree to base — fix by hand before continuing`.
    No `INCOMPLETE CHECKOUT`, no stranded path named, and git's `Permission denied` stderr
    discarded to `/dev/null`. Two misleading messages stacked on one bug.
  - **case 2 (linked worktree)** — exit **0**. The full gate ran from a linked worktree with no
    complaint at all.
  - **case 3 (unrelated baseline)** — the worst finding, and BEYOND what the proposal described.
    `base_of` prints `no merge-base for 'alien' vs base` and calls `die`, but it is invoked as
    `base="$(base_of "$branch")"` — **`exit` inside a command substitution cannot terminate the
    parent**. `base` is set to the empty string, execution continues, and the run reports
    `FULL GATE PASSED — primary-tree checkout of alien (base )`: a confident green verdict against
    no baseline whatsoever. `integrity` uses the identical pattern at `scripts/fixloop.sh:82`, so
    this is not confined to `gatefull`. Recorded in the handoff contract for chain-2 to fix at the
    root.
  - **case 4 (restore alarm)** — **GREEN pre-fix**, contradicting task 1.6's expectation of RED for
    1.1–1.4. The false `FAILED TO RESTORE` does not fire on a clean success path; its real instance
    is inside case 1's half-applied path, so the assertion was added there (where it was actually
    observed) rather than fabricating a failure for case 4. Case 4 retains value as a guard against
    the fix introducing a spurious warning.
  - **case 5 (negative control)** — GREEN, all 7 assertions. Suite is non-vacuous.
- 2026-07-26 tasks 1.1–1.6 complete; `handoff/preflight-suite.md` written (contract: the exact
  failure-message substrings chain-2 must satisfy). Committed dfba574.

### chain-2: gatefull-assertions (tasks 2.1–2.6) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-26 **Class-A deviation, scope**: chains.md declares chain-2's edit as "`scripts/fixloop.sh`
  — the `gatefull)` case arm only". The fix went wider *within the same file*: `base_of` no longer
  calls `die` (it returns non-zero and prints nothing), and all four call sites — `integrity`,
  `redcheck`, `gatefull`, `finish` — now check the assignment's status. Rationale: the case-3 defect
  is in the shared helper, not in `gatefull`. Fixing only the `gatefull` arm would have left
  `integrity` — the harness's own tamper detector — able to run against an EMPTY baseline and
  report a confident verdict. The handoff contract flagged this for chain-2 explicitly. No file
  outside chain-2's declared scope was touched.
- 2026-07-26 assertions landed: primary-tree refusal (2.3), baseline refusal + root-cause fix (2.4),
  checkout stderr preserved to stderr (2.1), post-checkout landed assertion naming stranded paths
  and explicitly disclaiming tamper (2.2), restore judged by TREE CONTENT + HEAD rather than by
  git's exit status (2.5).
- 2026-07-26 **task 2.6 — SUITE GREEN: 23 passed / 0 failed**, negative control intact (7
  assertions, all still passing — nothing went vacuous).
- 2026-07-26 one assertion corrected mid-chain: `assert_not_contains "$OUT" "TAMPER"` failed against
  the *fixed* script because the new message reads "This is NOT tamper" — a case-insensitive
  substring cannot distinguish an accusation from a disclaimer. Replaced with two precise
  assertions: output must not contain `GATE REFUSING TO RUN` (gate.sh's actual tripwire wording),
  and must contain `NOT tamper`. The test was wrong, not the message.
- 2026-07-26 anti-vacuity re-check for the two assertions added *after* the red check. The obvious
  route (restore the old script, re-run) was **blocked by `protect-harness.sh`** — twice, including
  a scratch-tree copy, because the redirect target's path ends in `scripts/fixloop.sh`. Not routed
  around; verified read-only instead: `git show HEAD:scripts/fixloop.sh` contains neither
  `NOT tamper` (0) nor `INCOMPLETE CHECKOUT` (0), so `incomplete checkout actively disclaims tamper`
  is certainly RED pre-fix. `GATE REFUSING TO RUN` is also absent (0) — that assertion is therefore
  **vacuous in this fixture** and is documented in the contract as a redundant guard; the
  load-bearing assertion for the same property is `does not reach the gate`, which was red pre-fix.
- 2026-07-26 note — `gate.sh` cannot run until this is committed: its tamper tripwire refuses while
  `scripts/fixloop.sh` differs from `GATE_BASE`. That is the designed flow (a human commits the
  deliberate change, which advances the baseline), not an obstacle.
