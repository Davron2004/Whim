## Context

The closure lane is the last thing that runs before a change reaches `main`, and the one step whose
output a human acts on directly (the ready flip tells them "review this"). Its verdicts are
therefore load-bearing in the same way the gate's are — which is why the defect class
`harden-gate-preconditions` removed from the gate matters just as much here.

Four findings, all measured in one supervised run (`research.md`): F1 a poll that reads *no verdict*
as *passing verdict*; F2 documentation contradicted by the hook it describes; F2b a fail-closed
matcher whose friction has no documented workaround; F3 a tool refusing the input its own runbook
specifies; F4 a `git` command that warns, half-succeeds, and exits 0.

## Goals / Non-Goals

**Goals:**

- No closure step treats an absent verdict as a passing one.
- Every command a runbook instructs is a command the policy actually permits.
- Where a guard causes friction, the sanctioned workaround is documented, so the path of least
  resistance is not "reword until the matcher stops complaining".
- The standing "assert, don't assume" rule visibly binds runbooks, not only shell scripts.

**Non-Goals:**

- Weakening the bash policy. Every denial observed was **fail-closed and safe**; the problem is that
  the docs describe a different policy, not that the policy is wrong. If D2 resolves toward "the
  docs are wrong", the correct fix is to correct the docs and reroute the steps.
- Making `git config` writable under the sandbox (F4). Same architectural denial as `.claude/**`;
  the remedy is to expect it, not to defeat it.
- Fixing step 12d. It is unexercised, not known-broken; this change records that gap rather than
  speculatively changing code no one has watched fail.
- Re-litigating the substring matcher's design. Judging a compound by its worst segment is correct.

## Decisions

**D1. The poll asserts a positive verdict; absence is pending.**
Invert the predicate. Instead of "stop when nothing is pending", the poll continues while the output
matches pending **or** `no checks reported`, and stops only on an explicit pass/fail verdict for
every required check. This is the same shape as `gatefull`'s postcondition — assert the thing you
want is true, rather than that a symptom of failure is absent. *Alternative rejected:* a fixed
warm-up sleep before the first poll — it trades a correctness bug for a race, and a slow-registering
check would reintroduce it.

**D2. Which side of F2 is the defect is an OPEN QUESTION for the owner, not an inference.**
Either the docs overstate a relaxation that was never implemented, or the hook regressed and lost
one it should have. `research.md` deliberately does not guess. The distinction changes the fix:
*docs wrong* → correct §4 and reroute 12f/12g; *hook wrong* → restore the relaxation and keep the
runbook. **Resolve this before implementing**, because implementing the wrong branch either
re-broadens a security policy without cause, or enshrines a documentation error.
Note the asymmetry: correcting the docs is safe and reversible; re-relaxing a deny is neither. If
the owner has no recollection, correct the docs.

**D3. 12f's ancestor check moves to the `gh` mergeability query regardless of D2.**
`gh pr view <n> --json mergeable,mergeStateStatus` answers the question the step is actually asking —
"will this merge cleanly into the current base?" — using GitHub's own view of the real merge, rather
than inferring it from a local ref that may be stale, and it needs no local fetch. It is already
permitted for the main thread. This holds even if D2 restores the relaxation, so it is not blocked
on D2.

**D4. Document the matcher friction; do not soften the matcher.**
F2b's denials were correct. The hazard is behavioural: an operator who does not know about
`--body-file` will reword the prose until the guard stops firing, which trains exactly the wrong
reflex. So the fix is documentation plus one worked example, in the same place the policy is
described. *Alternative rejected:* exempting heredoc bodies and `--body` values from the matcher —
it would require the hook to parse quoting well enough to know what is content, and getting that
wrong is a real bypass. Fail-closed with a documented workaround is the better trade.

**D5. `park` accepts `integration/*`; the note records what a staging run needs to resume.**
Widen the case arm and derive `wip/<id>` the same way. A staging park additionally records what the
hand-rolled park had to record last time: that `main` may no longer be an ancestor, so closure needs
a merge-from-`main` before step 12f. That is not decoration — it is the fact that makes a parked run
resumable, and it was learned by hitting it. *Alternative rejected:* leaving `park` alone and
documenting the manual procedure — the runbook already tells operators to run `park`, and a tool
that refuses its documented input is the defect.

**D6. F4 is documented as expected behaviour, and teardown reports it.**
The residue cannot be prevented (sandboxed `.git/config` writes are denied) or cleaned (`git config`
is tier-1 denied for all callers). What is fixable is the surprise. Teardown states that a stale
`[branch "…"]` section is the normal outcome and is cosmetic, so nobody investigates it twice.

## Risks / Trade-offs

- **A stricter poll could hang** where the old one exited early — e.g. a required check that never
  registers. → The bounded timeout already exists and is retained; the failure mode becomes a
  *parked run with a clear reason*, which is the correct outcome, rather than a false green.
- **D2 could stall the change.** → D3, D4, D5, D6 and the F1 fix are all independent of it; only the
  §4/hook reconciliation blocks. Sequence it so D2 is not on the critical path.
- **These are Class-2 files, so a bad edit compromises the control plane.** → Same posture as
  `harden-gate-preconditions`: every chain HUMAN-BOOTSTRAP, ratified through the permission dialog,
  with the fast gate and the preflight suite covering the mechanical parts.
- **Runbook behaviour is harder to test than script behaviour** — a markdown step has no exit code.
  → Test the *predicate*, not the prose: extract the poll condition into something the preflight
  suite can drive, so F1 has a red-checkable guard rather than a documented promise.

## Open Questions

- **D2: docs or hook?** Blocking for that item only. Needs the owner's intent.
- Should the closure poll distinguish "required check missing entirely" from "not yet registered"?
  The GitHub API can express it; whether the runbook needs the distinction is unclear until step 12d
  is exercised at least once.
- Is there any other place the `no checks reported`-style predicate appears? Worth a sweep of the
  runbooks for "absence read as success" before implementing, since two instances of this class have
  now been found in two consecutive layers.
