# Open follow-ups — known, filed, not fixed

Standing backlog of things found during runs and deliberately **not** fixed in the run that found
them, because they were out of that change's scope. Each entry states what it is, why it matters,
what "done" looks like, and where the evidence lives.

**This file is deliberately NOT date-named.** `/critic-run` scopes itself to everything since the
newest `YYYY-MM-DD.md` file in this directory; a date-named file here would shift that marker and
make the next critic run skip history. Non-date-named siblings (`README.md`, `sonar-ledger.md`, this
file) are never marker candidates — see `README.md`.

Append new items; strike through and date items as they are resolved rather than deleting them, so
the file also records what turned out not to matter.

---

## 1. Closure step 12d has never been exercised

**What.** The Sonar-findings → nested `/fix-loop` → re-push loop in `.claude/commands/opsx/apply.md`
step 12d has been skipped by **both** supervised closure runs to date (`automate-closure` task 7.2,
and `harden-closure-lane`), because SonarCloud was green on every push in each.

**Why it matters.** "Supervised closure passed" is being read as "every closure step is validated",
and for 12d that is false. It is the only closure step whose first real execution is still ahead of
it, and it is the one that drives an automated fix loop against externally-sourced findings.

**Done looks like.** One run that actually goes red on SonarCloud, drives 12d end to end, and
records what broke. Do **not** pre-emptively rewrite it — it is unexercised, not known-broken, and
speculatively changing code nobody has watched fail is its own defect class.

**Evidence.** `docs/harness.md` §11; `openspec/changes/archive/2026-07-28-harden-closure-lane/progress.md`.

---

## 2. Two absence-read-as-success predicates in `opsx/archive.md`

**What.** From the `harden-closure-lane` task 5.4 runbook sweep:

- `.claude/commands/opsx/archive.md` — when `tasks.md` exists with unticked tasks the step
  **prompts**; when the file is **missing entirely** it proceeds *silently*. The stronger signal
  gets the weaker response. For a `whim-harness` change `tasks.md` is a required artifact, so its
  absence means the change was never planned or the file was lost.
- Same file — absent delta specs skip the sync prompt without distinguishing *declared none* from
  *expected but absent*. A change that lost its specs archives with the live specs never updated,
  silently.

**Why it matters.** Same class as `harden-closure-lane` F1: an absent artifact read as "nothing to
check" rather than "establish why it is absent". Milder — neither produces a false *verdict* — but
the archive step is the last gate before a change stops being tracked.

**Done looks like.** A missing required artifact is at least as loud as an incomplete one; the sync
assessment consults the schema for whether specs were expected. The pattern to copy already exists
in the same runbook: step 12d's `sonar-pr-issues.mjs` exit-3 guard, which says in terms "never trust
an empty result".

**Evidence.** `openspec/changes/archive/2026-07-28-harden-closure-lane/findings-runbook-sweep.md`.

---

## 3. `scripts/**` and `.github/workflows/**` never swept for the absence-as-success class

**What.** The 5.4 sweep scoped itself to runbooks (`.claude/commands/**`, `.claude/agents/**`).
Decision #50 covered the gate scripts specifically. Neither the remaining `scripts/**` nor the CI
workflows have been examined for predicates that read an absence as success.

**Why it matters.** Three instances of this class have now been found in three consecutive layers
(gate scripts → closure runbook → archive runbook). Assuming the untouched layers are clean is the
same assumption that made F1 survive as long as it did.

**Done looks like.** A sweep of both trees, findings filed here rather than fixed inline.

---

## 4. `dev/v1` protection is vestigial and blocks its own cleanup

**What.** `docs/harness.md` §3 records `dev/v1` as retired (fully merged into `main` at `559defe`,
superseded by the per-run staging lane). The branch still exists on the remote, and
`.claude/hooks/bash-policy.sh` still names it alongside `main` in the tier-1 protected set — so
`git push origin --delete dev/v1` is denied for **all** callers, orchestrator included:

```text
push naming a protected branch (main/dev/v1) is denied for ALL callers
```

Verified 2026-07-28: `origin/dev/v1`'s tip tree is present in `main`'s history at `559defe`, so the
branch carries no unique content.

**Why it matters.** Low stakes, but the policy now guards a dead target and prevents its removal.
Left alone, it is one more piece of "why is this here?" for the next reader, and it dilutes the
protected set — a list that is load-bearing precisely because every entry in it is meaningful.

**Done looks like.** Either the branch is deleted by a human outside the session and the policy
entry left as harmless belt-and-braces, or `dev/v1` is retired from the tier-1 list in a change of
its own. That list is Class-2, so it cannot be an incidental edit. Deciding *which* is the actual
open question — do not assume the second.

---

## 5. The `no checks reported` window has never been observed live

**What.** `harden-closure-lane` F1's discriminating input — the closure-check tool reporting that no
checks exist for the branch, exiting `0` — was not reproduced in the wild across **four** polls on
**two** pushes. GitHub registered the jobs faster than a hand-issued poll could land each time.

**Why it matters.** The live polls establish that the predicate reports pending rather than green,
but they do **not** discriminate the fixed predicate from the naive one, since both would have seen
the literal word `pending`. That discrimination rests entirely on the fixture red check in
`scripts/test/fixloop-preflight.test.sh`, which drives the exact input deterministically. This is
recorded so nobody later cites "it was validated in production" for a claim production never tested.

**Done looks like.** Nothing necessarily. Recorded as a known limit of the live evidence, not as
work. If a future run happens to catch the window, note it.

**Evidence.** `openspec/changes/archive/2026-07-28-harden-closure-lane/tasks.md` task 5.3 and its
annotation; poll transcripts in that change's `progress.md`.

---

## 6. `linked-apps-data-model` is parked mid-closure

**What.** A complete run (4/4 chains merged, `gate-full` PASSED on `d0e0b1c`, reviewer CLEAN) that
never ran closure. Parked as `wip/linked-apps-data-model` to free the one-active-run slot.

**Why it matters.** It is finished work that has never reached `main`, and it ages: the longer it
sits, the further the base advances past it.

**Done looks like.** Resume per its park note — reconcile with `main` first (the note records that
the ancestor check will otherwise fail), then run closure step 12 (a–g). Note the note itself was
hand-rolled, because `park` refused staging branches at the time; `harden-closure-lane` fixed that,
so a re-park would now be generated correctly.

**Evidence.** `.claude/fixloop/wip-linked-apps-data-model.md`. Also carries one LOW reviewer item
with a recommended deferral, and flags one piece of unrelated debris.

---

## 7. The `.git/config` branch residue is avoidable, not inherent — and it accumulates

**What.** `harden-closure-lane` F4 established that deleting a branch **under the sandbox** strands a
`[branch "…"]` section in `.git/config`: the ref goes, the config write is denied, the command still
exits `0`. `apply.md` step 12g now documents that as expected and cosmetic.

Measuring the *accumulated* state on 2026-07-28 sharpens both halves of that. **28 of 30
`[branch]` sections describe branches that no longer exist**, and the same session produced a clean
natural experiment on how they got there:

| Branch | Deleted | Section left behind? |
| --- | --- | --- |
| `integration/harden-closure-lane` | **sandboxed** — printed `could not lock config file .git/config` | **yes, stranded** |
| `chore/archive-harden-gate-preconditions` | unsandboxed | no — cleaned |
| `harden-gate-preconditions` | unsandboxed | no — cleaned |
| `backup/pre-cleanup-integration-harden-gate-preconditions` | unsandboxed | no — cleaned |
| `chore/archive-harden-closure-lane` | unsandboxed | no — cleaned |

Four unsandboxed deletions left nothing; the single sandboxed one stranded its section. Every stale
section contains only `vscode-merge-base = origin/main` — a key the VS Code Git extension writes per
branch — which is *what* is stranded, not *why*; git removes the whole section on a successful
delete regardless of who wrote the keys in it.

**Why it matters.** Two corrections to the current documented position, neither of which makes F4
wrong so much as incomplete:

1. **The residue is avoidable.** Step 12g tells the operator to expect it. The measured remedy is
   stronger: *delete the branch unsandboxed and there is no residue at all*. Teardown already needs
   an unsandboxed context for the `git switch` and the fast-forward (both rewrite `.claude/**`), so
   this costs nothing extra — it is the same override, extended one command further.
2. **"Cosmetic" is true per instance and misleading in aggregate.** It grows monotonically: one
   section per `chain/*` branch plus one per `integration/*` branch, every run, forever. Nothing
   prunes it, and nothing *can* in-session — `git config` is tier-1 denied for every caller
   including the orchestrator. 28 sections after a handful of runs is the current rate.

**Done looks like.** Two things, of which only the first is a change:

- `apply.md` step 12g instructs the branch deletion **unsandboxed**, and reframes the residue note
  as "what you will see if you forget" rather than "what to expect". Class-2 file, so it needs a
  ratified edit, not an incidental one.
- A one-off manual prune of the 28 existing sections, by a human outside the session. There is no
  in-session path; do not look for one.

**Evidence.** This file's own session (2026-07-28); `apply.md` step 12g; decision #51 D7;
`openspec/changes/archive/2026-07-28-harden-closure-lane/progress.md` teardown entries.
