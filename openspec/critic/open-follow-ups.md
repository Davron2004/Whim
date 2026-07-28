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

**~~RESOLVED 2026-07-28~~ — exercised end to end by `linked-apps-data-model`'s closure (PR #13), and
it did break, in the way this entry was right to wait for.** The gate went red, `sonar-pr-issues.mjs`
exited **10 (red with findings) reporting ZERO issues**, and step 12d has no cell for that
combination. Not an ingestion bug: the gate was red on a *condition*
(`new_duplicated_lines_density` 5.71% > 3%), and a condition is a **measure**, not an **issue**, so
`api/issues/search` — the only endpoint the script reads — structurally cannot see it. Followed
literally, 12d would have handed `/fix-loop` an empty findings file, dispatched nothing, re-pushed an
identical tree, and polled a permanently-red gate forever. Decision #51's absent-result rule is the
only thing standing between that contract and a silent infinite loop. The residue is filed as item 9
below. Full transcript: `openspec/changes/linked-apps-data-model/progress.md`,
`findings-sonar-1.md`. Note the vindication of this entry's own advice: the defect was in a branch
nobody had watched execute, and no amount of pre-emptive rewriting would have predicted it.

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

**~~RESOLVED 2026-07-28~~ — unparked and driven through closure to a ready-for-review PR (#13).**
Reconciled with main first as the park note instructed (main had advanced 21 commits; exactly one
file, `docs/decisions.md`, changed on both sides, and this change's decision entry was renumbered
**#49 → #52** because `automate-closure` had taken 49 and #50 already cites it). `gate-full` was
re-earned rather than carried over, since `scripts/gate.sh` itself had grown since the original PASS.
The LOW reviewer item was recorded as a deferral on #52. Task 5.2 was also run — the **first
completed on-device acceptance in this repo**. The unrelated debris it flagged
(`integration/sonar-recurrence-ledger` on the remote) was already gone by 2026-07-28.

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

- ~~`apply.md` step 12g instructs the branch deletion **unsandboxed**, and reframes the residue note
  as "what you will see if you forget" rather than "what to expect". Class-2 file, so it needs a
  ratified edit, not an incidental one.~~ **DONE 2026-07-28** — and wider than this bullet asked.
  Tracing the 28 sections to their sources showed step 12g produces only 4 of them: `/opsx:apply`
  **step 9** strands one *per chain per run* and is the biggest producer, `/fix-loop` step 8 strands
  one per finding, and the `/git-cleanup` teardown two more. Fixing 12g alone would have addressed
  under a third of the problem. The rule now lives once in `docs/harness.md` §11, with pointers at
  all four runbook sites and in the two scripts that *print* deletion commands
  (`fixloop.sh finish`, `git-cleanup-check.sh`). Decision #51 D7 amended — it recorded the residue
  as unpreventable, which was inferred from one observation of the failure rather than from any
  attempt to avoid it.
- A one-off manual prune of the 28 existing sections, by a human outside the session. There is no
  in-session path; do not look for one. **STILL OPEN** — the fix above stops new residue from the
  harness's own deletions; it does not remove what has already accumulated.

**Residual, permanent:** `worktree-*` / `wf_*` branches (20 of the 28) are created and deleted by
the agent runtime's own worktree isolation, which no runbook here controls. Those will keep
stranding sections. This reduces the growth rate; it does not stop it.

**Evidence.** This file's own session (2026-07-28); `apply.md` step 12g; decision #51 D7;
`openspec/changes/archive/2026-07-28-harden-closure-lane/progress.md` teardown entries.

---

## 8. The delete confirmation lies about shared data

**What.** `COPY`/`deleteBody` renders **"'<name>' and all its data will be removed. This can't be
undone."** for every delete. Since `linked-apps-data-model`, that is false for any storage-group
member that is not the last one: deleting it removes the index entry but the database survives,
because another entry still resolves to the group.

**Why it matters.** It is the exact inverse of the failure the copy is written to prevent. A user
who wants their data *gone* deletes one app, is told it is gone, and it is not — it is still readable
from the fork. Directly observed, not theorised: task 5.2's on-device run deleted the founder, saw
this copy, and then read the founder's records back from the surviving fork.

**Done looks like.** `deleteBody` becomes refcount-aware — `AppIndex.storageRefCount` is already the
right primitive and is already called on the delete path in `StoreAccess.remove` — and says something
true in both cases ("your other app keeps this data" vs. "this removes it for good"). Not a copy
tweak: it is a behavioral slice needing a delta spec, tests, and product-verbs vetting, which is why
the run that found it did not fix it inside closure. The honest-copy surface chain-3 built for launch
failures (`HostState.launchFailed` → `MiniAppView`) is the precedent for tone.

**Evidence.** `openspec/changes/linked-apps-data-model/progress.md` (task 5.2 section, step 8);
`src/host/launcher/copy.ts`; decision #52 D3.

---

## 9. `sonar-pr-issues.mjs` cannot see a gate that fails on a condition

**What.** The ingestion script reads `api/issues/search` only. SonarCloud's quality gate can fail on
a **condition over a measure** (duplication density, coverage, ratings) with **zero open issues** —
and then the script exits 10 ("red with findings") while emitting an empty findings list.

**Why it matters.** Step 12d's exit-code contract is `3 = auth failure, 10 = red with findings,
0 = green`. There is no cell for *red with no findings*, and the naive reading of 10 is "run the fix
loop over these findings" — over an empty file. That dispatches nothing, re-pushes an identical tree,
and re-polls a gate that cannot change: a silent infinite loop whose only guard today is a human
noticing the arithmetic. Item 1 above hit this on its first real execution.

**Done looks like.** The script also reads `api/qualitygates/project_status`, and when the gate is
ERROR with no issues it emits the failing **conditions** as findings (metric, threshold, actual) —
plus, for duplication specifically, the `api/duplications/show` blocks, which is what makes the
finding actionable. A distinct exit code for "red on conditions, no issues" would let 12d branch
instead of relying on the operator. The manual diagnosis is transcribed in the change's
`findings-sonar-1.md`, so the API shapes do not need rediscovering.

**Evidence.** `scripts/sonar-pr-issues.mjs`; `openspec/changes/linked-apps-data-model/findings-sonar-1.md`;
`.claude/commands/opsx/apply.md` step 12d.

---

## 10. `git branch -m` is a sixth `.git/config` residue site the sweep missed

**What.** Item 7 and decision #51's D7-AMENDED swept the four runbook **deletion** sites so branches
are deleted unsandboxed. A branch **rename** writes `.git/config` exactly as a deletion does, and
`git branch -m` under the sandbox strands a `[branch "…"]` section the same way — ref renamed, config
write denied, and unlike deletion it fails **loudly** (`fatal: branch is renamed, but update of
config-file failed`, exit 128).

**Why it matters.** Small in itself, but it shows the sweep enumerated *the sites the runbooks named*
rather than *the operations that write `.git/config`*. Rename is the one park/unpark uses, so it fires
on exactly the recovery path where an operator is least expecting an unrelated failure. The exit-128
also means a script chaining on `&&` after a rename silently stops.

**Done looks like.** `docs/harness.md` §11 states the rule over the *operation class* ("any command
that writes `.git/config` — delete, rename, set upstream — runs unsandboxed") rather than a list of
four call sites, and `fixloop.sh park` inherits it.

**Evidence.** Observed 2026-07-28 unparking `wip/linked-apps-data-model`;
`openspec/changes/linked-apps-data-model/progress.md` first closure ledger line; decision #51 D7-AMENDED.
