## Context

`scripts/fixloop.sh gatefull` is the authoritative pre-merge verification entry point: it checks a
branch's committed tip out into the primary working tree and runs `gate-full.sh` against it. It
uses the primary tree — not a linked worktree — for one reason recorded in its own comment: a fresh
worktree has no `node_modules`, and Metro (`guard:metro`) does not walk up to the repo-root copy the
way Node does.

That design makes the command mutate the primary tree, and three of the six failures catalogued in
`research.md` trace to it. The decisive one: `git checkout --detach` cannot write under `.claude/**`
when sandboxed, prints `Operation not permitted` per file, **and still exits 0**. `fixloop.sh` sends
that stderr to `/dev/null`, so a half-applied tree reaches `gate.sh`, whose tamper tripwire compares
the working tree against `GATE_BASE` and — correctly, for the tree it was handed — reports a config
mismatch. The operator sees a tamper accusation and must disprove it to discover a failed checkout.

Two constraints from `research.md` shape every decision below:

1. The `.claude/**` write denial is **architectural**. Claude Code's documentation states the
   sandbox auto-denies writes to `settings.json` at every scope specifically so a sandboxed command
   cannot widen its own policy; it is not controlled by `excludedCommands` and survives
   `sandbox.filesystem.disabled: true`. Measured here, the denial covers `.claude/hooks`,
   `.claude/commands`, `.claude/agents`. **No configuration can make this work.**
2. This repo versions its control plane *inside* `.claude/`. So checking out any branch that changes
   the harness is sandbox-incompatible by construction, permanently.

Together these mean the fix cannot be "make the sandbox allow it." It must be "detect that it
didn't happen, and say so accurately."

## Goals / Non-Goals

**Goals:**
- No harness step reports a partial success as success.
- When a precondition fails, the message names the *actual* cause, not a downstream symptom.
- The diagnostic signal that already exists (the checkout's stderr) is preserved, not discarded.
- The behaviour is locked by a red-checkable suite that cannot go vacuous.
- The documentation stops asserting a protection that does not exist.

**Non-Goals:**
- Making `gatefull` work under the sandbox. Per `research.md` this is impossible by design, not
  merely unimplemented.
- Relocating harness sources out of `.claude/` — the candidate structural fix, deferred to a
  timeboxed spike with a kill criterion.
- Explaining why the `gh` network exclusion did not apply. Unresolved in `research.md`, filesystem-
  independent, and orthogonal to every change here.
- Changing what `gate-full.sh` verifies. Only *whether it was handed a valid tree* is in scope.

## Decisions

**D1. Assert in the caller (`gatefull`), not in `gate.sh`'s tripwire.**
`gate.sh` diffs the working tree against `GATE_BASE`. It has no way to know whether a checkout just
happened, so it cannot distinguish "human edited protected config" from "checkout half-applied" —
both present as a config diff. `gatefull` *does* know. Keeping the tripwire single-meaning and
adding the assertion where the context exists is simpler than teaching the tripwire a second
failure mode. *Alternative rejected:* have `gate.sh` classify the mismatch — it would need to infer
intent from state it does not have, which is how the misleading message arose in the first place.

**D2. Fail closed with the accurate cause, and test the message.**
The bug was never a wrong exit code — the gate correctly refused to run. It was a *correct refusal
for a wrongly-stated reason*. So the suite asserts on message content; asserting only the exit code
would pass against the current buggy behaviour and lock in the defect.

**D3. Preserve the checkout's stderr.**
Route it to stderr rather than `/dev/null`. This single line would have diagnosed the original
failure immediately every time it occurred. *Trade-off:* slightly noisier output on the failure
path; silence on the success path is unchanged.

**D4. Test against a synthetic divergent tree, not a simulated sandbox.**
The sandbox is a property of the invoking harness, not of the script, and is not reproducible from
inside a test. But the sandbox is only *one* way to produce the condition the assertion checks —
"working tree ≠ branch tree after checkout". A throwaway git fixture with a deliberately dirtied
tree produces it deterministically. *Alternative rejected:* `chmod`-based permission simulation —
platform-specific, and it tests the OS rather than our contract.

**D5. `git-cleanup-check.sh` emits a topology-aware apply command.**
Resolve where the target is actually checked out (`git worktree list --porcelain`) and print the
`git -C <worktree> reset --hard <lane>` form when it lives in a run worktree, falling back to the
current `checkout`-based form only when it is checked out nowhere. Under the staging lane the
target is *always* in a run worktree, so today's printed command fails 100% of the time it is
followed literally. *Alternative rejected:* printing both forms with a "pick one" note — it pushes
a decision onto the operator that the script can resolve mechanically.

**D6. The documentation correction preserves epistemic status.**
`research.md` separates documented fact, inference, and unresolved question. The corrected docs keep
that separation rather than flattening it into a new confident claim. The previous text was wrong
precisely because it stated an unverified mechanism as fact; replacing it with a differently-worded
overstatement would repeat the error.

**D7. Detection lands before documentation.**
While the bug is live it is a reproducible fixture, and the new assertion must be proven to fire
against the real failure — not just against the synthetic one. Reversing the order would leave the
assertion unvalidated against the case it exists for. This is the `after:` constraint in `chains.md`.

## Risks / Trade-offs

- **A false-positive assertion blocks every legitimate gate run.** `gatefull` is the pre-merge
  verification path; an over-eager assert halts all work. → Each assertion is a deterministic
  equality check on git plumbing output, not a heuristic. The negative control in the suite proves a
  clean checkout still passes, and the suite runs in the fast gate on every attempt.
- **These files are Class-2; a bad edit compromises the thing that does the verifying.** → All
  changes are additive assertions on paths that currently proceed unconditionally; no existing
  verdict changes. Every chain is HUMAN-BOOTSTRAP and ratified through the permission dialog, and
  the new suite red-checks the behaviour.
- **The suite could go vacuous** — the classic failure of a test that only ever asserts failure. →
  Negative control, mirroring the `invariants/` discipline (decision #28).
- **`git diff --quiet <branch>` semantics.** It compares tracked content only, so gitignored build
  outputs (`src/runtime/generated/*`) cannot cause a false alarm. Untracked files are likewise
  ignored — correct here, since the assertion is about what the checkout *wrote*.
- **The baseline-relation assertion could reject a legitimate unrelated branch.** → Scope it to
  refusing when the relation is absent, which is exactly the case that yields a silently wrong
  baseline; it does not constrain which branch may be gated.

## Migration Plan

No data migration and no runtime surface. Rollout is the merge itself; rollback is a revert of the
change's commits, since every edit is additive. One ordering constraint: the new `check` in
`gate.sh` must land in the same change as the suite it runs, or the fast gate references a file
that does not exist.

## Open Questions

- Why did the `gh` (network) `excludedCommands` entry not apply? Unresolved in `research.md`; the
  documentation does not specify matching semantics. Does not block this change — no decision here
  depends on the answer.
- Should the versioned harness sources move out of `.claude/` entirely? Deferred to the spike. If
  that spike succeeds, several assertions added here become belt-and-braces rather than load-bearing
  — which is an acceptable outcome, not wasted work.
