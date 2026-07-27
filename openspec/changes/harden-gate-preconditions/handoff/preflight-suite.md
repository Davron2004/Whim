# Contract: `scripts/test/fixloop-preflight.test.sh`

Written by chain-1. Consumed by chain-2 (`fixloop.sh gatefull` assertions), chain-3 (extends this
file for `git-cleanup-check.sh`), chain-4 (wires it into the fast gate).

## Invocation

```sh
bash scripts/test/fixloop-preflight.test.sh     # exit 0 = all assertions pass, 1 = one or more failed
```

No arguments, no environment inputs. Self-contained: builds throwaway git repos under `$TMPDIR`
and removes them on EXIT (including `chmod -R u+rwX` first, since it deliberately creates
unwritable directories). Runs in ~1s; safe in the fast gate.

## Fixture construction (the helpers chain-3 extends)

- `new_fixture` → prints a fixture repo path. Topology:
  - branch `base` — `locked/x.txt=v1`, `free/y.txt=v1`, plus `scripts/`
  - branch `target` — descends from `base`; both files at `v2`
  - working tree left on `base`, clean
  - `scripts/fixloop.sh` is a **verbatim copy** of the real one; `scripts/gate-full.sh` is a stub
    that prints `STUB-GATE-FULL-RAN` and exits `${STUB_GATE_FULL_RC:-0}`
  - every fixture path is appended to `FIXTURES` so the EXIT trap reclaims it
- `add_orphan_branch <fx>` → adds branch `alien` with unrelated history (no merge-base with `base`)
- `lock_dir <dir>` → `chmod 500` **and proves the barrier bit** by attempting a write; returns 1 if
  it did not (root, or a filesystem ignoring directory permissions). Callers MUST treat a return of
  1 as a FAILURE, never a skip.
- `run_gatefull <cwd> <integration-branch> <target-branch>` → sets `OUT` (stdout+stderr combined)
  and `RC`
- `fgit …` → `git` with fixture-local identity config; use it for all fixture git calls

## Assertion helpers

`pass`, `fail <name> <detail>`, `assert_contains`, `assert_not_contains`, `assert_rc_zero`,
`assert_rc_nonzero`. Message assertions are **case-insensitive substring** matches (`grep -qiF`):
they pin the claim a message makes, not its wording. Failures accumulate — the suite runs every
case and exits 1 at the end — so one broken case never hides the others.

## Failure-message substrings chain-2 MUST satisfy

These are the contract. Case-insensitive substring, so surrounding wording is free.

| Condition | Required substring | Also required |
|---|---|---|
| Checkout did not fully apply | `INCOMPLETE CHECKOUT` | names each stranded path, e.g. `locked/x.txt`; contains `NOT tamper`; must NOT reach the gate (`STUB-GATE-FULL-RAN` absent); must NOT contain `GATE REFUSING TO RUN` or `FAILED TO RESTORE` |
| Invoked outside the primary tree | `primary working tree` | must NOT reach the gate |
| Target unrelated to the integration branch | `baseline could not be established` | must NOT reach the gate |
| Checkout emitted diagnostics while failing | git's own stderr reaches the operator (`Permission denied` in the fixture) | — |
| Restore succeeded | `FAILED TO RESTORE` **absent** | HEAD back on the starting ref |

All four refusals must exit non-zero.

## Negative control (do not weaken)

Case 5 gates a complete, valid checkout and requires: exit 0, `STUB-GATE-FULL-RAN` present (the
gate was **reached**, not merely not-failed), `FULL GATE PASSED` reported, none of the three refusal
substrings present, and no permission diagnostics on the success path. This is what keeps the other
four cases from degenerating into "it refuses everything". Decision #28 discipline.

## Red-check result against the UNFIXED script (task 1.6, 2026-07-26)

11 passed / 10 failed. Observed, verbatim:

- **Case 1** — half-applied checkout **reached the gate** (`STUB-GATE-FULL-RAN` present), then
  printed `fixloop: FAILED TO RESTORE the primary working tree to base`. No `INCOMPLETE CHECKOUT`,
  no stranded path named, git's `Permission denied` stderr discarded. Two misleading messages on
  one bug.
- **Case 2** — exit **0**: the full gate ran from a linked worktree with no complaint.
- **Case 3** — worst case. `base_of` prints `no merge-base for 'alien' vs base` and calls `die`,
  but it is invoked as `base="$(base_of "$branch")"` — **`exit` in a command substitution cannot
  terminate the parent**. `base` becomes empty and the run continues to report
  `FULL GATE PASSED — primary-tree checkout of alien (base )`. A confident green against no
  baseline whatsoever.
- **Case 4** — already green: the false restore alarm does **not** fire on a clean success path.
  Task 1.6 predicted RED here; it is GREEN, and the real instance of that alarm lives in case 1.
- **Case 5** — green, all 7 assertions. The suite is non-vacuous.

## One assertion is a redundant guard, not a red-checkable one

`the gate's tripwire is not the reporting mechanism` (output must not contain `GATE REFUSING TO
RUN`) is **vacuous in this fixture by construction**: the fixture's gate is a stub that never emits
that wording, so the assertion also passed against the unfixed script. It is kept as a cheap guard
against a future refactor that lets a partial tree through to a real gate. The load-bearing
assertion for the same property is `incomplete checkout does not reach the gate` — if the gate is
never reached, its tripwire cannot be the reporting mechanism — and that one WAS red pre-fix.
Reproducing the tripwire faithfully would require the fixture's integration branch to be a
descendant of the branch under gate (the probe's accidental topology, where `GATE_BASE` equals the
branch tip); judged not worth the fixture complexity for a redundant check.

## Note for chain-2 beyond the named tasks

The `base="$(base_of …)"` subshell-`die` defect is **not** confined to `gatefull` — `integrity`
uses the identical pattern (`scripts/fixloop.sh` line 82), so an unrelated branch there also yields
an empty base rather than a refusal. Chain-2 owns this file; fix the pattern at its root rather
than only inside the `gatefull` arm.
