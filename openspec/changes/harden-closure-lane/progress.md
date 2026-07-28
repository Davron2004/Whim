# Progress ledger: harden-closure-lane

Schema `whim-harness`. **Every chain is HUMAN-BOOTSTRAP** — the files this change edits
(`scripts/fixloop.sh` and its suite `scripts/test/fixloop-preflight.test.sh`,
`.claude/commands/opsx/apply.md`, `docs/harness.md`) are Class-2 protected, so nothing is
dispatchable to an implementer. Two files named in the planning artifacts are NOT edited:
`.claude/hooks/bash-policy.sh` (removed from the edit set when chain-0 voided D2's premise) and
`scripts/gate.sh` (only ever *run*, by task 5.1). Corrected after the reviewer flagged the
inherited inventory as over-counting by one file. Per the operator's decision (2026-07-27) this run is an **attended
main-thread session**: chains run serially, each Class-2 edit ratified through the permission
dialog. The dispatcher's parallel-worktree machinery does not apply (chains.md "Parallelism note").
Same posture the predecessor `harden-gate-preconditions` ran under.

## Run start

- 2026-07-27 preconditions — `scripts/gate.sh`, `scripts/gate-full.sh`, `scripts/fixloop.sh` present
  and committed clean; primary tree clean; `git branch --list 'integration/*'` empty (no other
  active run).
- 2026-07-27 run-start — **MAIN_TIP = 3b3c7fcadc0c404c8db0187e043e3eff9df340c0**, recorded as
  `origin/main`, **not** local `main`. Local `main` was stale at `e08e06d`: the predecessor run's PR
  was squash-merged remotely, so `origin/main` carries the merged result under a new SHA. Verified
  before substituting: `git diff --stat HEAD origin/main` was **empty** (trees byte-identical) and
  `git ls-tree origin/main openspec/changes/` **contains** `harden-closure-lane`, so the staging
  branch carries the artifacts it implements and no content is lost. Staging branch
  `integration/harden-closure-lane` cut from MAIN_TIP.
  `FIXLOOP_INTEGRATION_BRANCH=integration/harden-closure-lane` for every `fixloop.sh` invocation
  this run.
- 2026-07-27 note — local `main` remains stale at `e08e06d` for the duration of this run;
  fast-forwarding it is teardown's job (step 12g), not run-start's.

## Pre-dispatch re-measurement — F2 was STALE, and a new finding (F5) surfaced

Before cutting the staging branch the dispatcher re-measured every finding this change is built on,
because `research.md` recorded measurements taken during a run in which another change
(`automate-closure`) was concurrently editing the same file. That re-measurement **invalidated F2**
and **surfaced F5**. Evidence, all taken 2026-07-27 on the attended host:

### F2 — FALSE as stated. The relaxation exists and the docs are accurate.

- `.claude/hooks/bash-policy.sh:164-179` implements a main-thread-only tier-1 relaxation for
  **exactly** the two forms the docs claim: `git fetch origin` and `git pull --ff-only origin main`.
- `git blame` dates that block to **511f024b, 2026-07-26 12:59:06 -0400**,
  `feat(automate-closure): remote-write policy for the staging integration lane, plus ruleset probe`.
  `git branch --contains 511f024b` lists `origin/main` — it is live on the base this run cuts from.
- Bare `git fetch origin` from the main thread: **ALLOWED** (ran; no policy denial).
- `git merge-base --is-ancestor main chore/archive-harden-gate-preconditions`: **rc=0**. It is not
  in the tier-1 deny list at any position, so F2's claim that "the fail-closed substring matcher
  denies any history op naming `main`" is false for this form.
- `docs/harness.md:110` and `.claude/commands/opsx/apply.md:49` describe the relaxation correctly.

**Conclusion:** `research.md` §F2 measured a hook that `automate-closure` fixed **mid-run**, at 12:59
on 2026-07-26 — during the very closure session §F2 was observing. The finding aged out in under a
day. Neither branch of design D2 ("docs wrong" / "hook regressed") is the correct fix; the premise
is void. Recorded as the resolution of D2 rather than as a choice between its two options.

### F2-residual — REAL, and it is what actually bit the research run.

`.claude/hooks/bash-policy.sh:170` excludes **compound** commands from the relaxation
(`*'&'*|*';'*|*'|'*|...` fall through to the tier-1 denies). The dispatcher reproduced this twice
in this session:

- `git fetch origin 2>&1 | tail -3; echo ...` → `git network/shared-ref/history op is
  human-approved only (class-B deviation)` — denied for being compound, not for being a fetch.
- A `grep` whose **search pattern** contained the protected vocabulary → denied on content.

`.claude/commands/opsx/apply.md:56` writes step 12g's two commands joined ("`git fetch origin` +
`git pull --ff-only origin main`"). An operator who issues them as one compound gets a denial whose
message points at the network rule rather than at the compounding — which is precisely the wrong
diagnosis, and is how §F2 reached its conclusion. The relaxed forms must be issued **bare**, and
nothing says so.

### F1, F3 — REAL, confirmed unchanged.

- **F1**: `.claude/commands/opsx/apply.md:52` (step 12c) says only "Quality gate GREEN → (e)". It
  never defines GREEN, so "no check is pending" is the natural reading and `no checks reported`
  satisfies it. Underspecified runbook with no testable predicate. chain-1 proceeds as planned.
- **F3**: `scripts/fixloop.sh:320` — `case "$branch" in fix/*|chain/*) : ;; *) die ...`. `park`
  still refuses `integration/*`. chain-2 proceeds as planned.

### F5 (NEW) — `gh` is unusable under the sandbox, and step 12's carve-out claim is false.

Surfaced by a subagent probe the operator requested (cheapest model, read-only, single bare commands,
explicitly instructed not to work around denials). Results:

| probe | main thread | subagent |
| --- | --- | --- |
| `git fetch origin` (bare) | **ALLOWED** | **DENIED** — `git network/shared-ref/history op is human-approved only` |
| `git merge-base --is-ancestor main <branch>` | **rc=0** | **DENIED** — `subagent git is permitted only inside its own .claude/worktrees/<id>` |
| `gh pr list --limit 1` | **ERROR** — `tls: failed to verify certificate: x509: OSStatus -26276` | **ERROR** — byte-identical message |
| `git status --porcelain` | allowed | allowed (probe not blanket-denied) |
| `git fetch origin 2>&1 \| tail -3` (compound control) | denied | denied |
| `printenv AGENT_ID` | — | **unset** (exit 1, no output) |

Two things follow.

1. **The `AGENT_ID` guard works as written.** The relaxation is main-thread-only by construction,
   and `AGENT_ID` is *not* exported into the subagent's command environment — the hook learns agent
   identity from its own hook payload, so a subagent cannot spoof it by unsetting a variable. The
   two subagent denials also carry *different* messages (tier-1 network vs scoped-worktree), so the
   subagent path is denied twice over for `merge-base`.

2. **`gh` fails for the same reason in both roles, and the sandbox is the cause.** The identical
   failure re-run with the sandbox disabled **succeeded** (exit 0). `OSStatus -26276` is
   `errSecInternalComponent` — a macOS **Keychain** error. `gh` verifies TLS through the system
   trust store via the Security framework, which requires Keychain access the sandbox denies. The
   dispatcher's own `git fetch origin` hit the same wall from the other side: `failed to store:
   100001`, the `osxkeychain` credential helper.

   This **resolves an open question CLAUDE.md currently records as unexplained** — "egress stayed
   blocked for `gh` too, which is filesystem-independent and remains **unexplained**". It is not
   filesystem-independent. It presents as an egress block but is a **trust-store access failure**,
   which is also why `sandbox.excludedCommands` (already measured inert) was never going to help.

   And it makes `.claude/commands/opsx/apply.md:49` false as written: "the sandbox carve-outs give
   them egress + the credential path". Measured: they do not. Every `gh` call in closure (12b, 12c,
   12f, 12g) needs an explicit unsandboxed override. Same defect class this change exists to fix —
   a runbook asserting an environmental capability nobody re-measured.

## Operator decisions (2026-07-27)

- **Run mode**: attended main-thread, serial. (Runbook step 2 would skip all-Class-2 chains; the
  operator elected the predecessor's precedent instead.)
- **D2**: resolved as *void premise* — see above. No `bash-policy.sh` edit; the deny is not
  re-broadened.
- **D3**: **REVERSED on measurement.** Step 12f keeps the local
  `git merge-base --is-ancestor main integration/<id>`. D3 proposed replacing it with
  `gh pr view --json mergeable,mergeStateStatus`; F5 shows the local check is the only one of the
  two that runs **under the sandbox** with no override, and D3's original justification ("the
  ancestor check is unrunnable") is false. The stale-local-ref concern is covered by the bare
  `git fetch origin` closure already permits main-thread.
- **F5 placement**: folded into re-scoped chain-3, which already edits both `docs/harness.md` and
  `apply.md` step 12. chain-4 updates CLAUDE.md's open-question paragraph to say it is resolved.

## Chain dispositions

### chain-0: resolve-open-question (task 0.1) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: not a code change.
- 2026-07-27 D2 resolved as **void premise** (evidence above); D3 **reversed on measurement**; D7
  (F5) and D8 added to `design.md`. `tasks.md` §3 rewritten, task 3.6 added (the spec delta still
  mandated D3's `gh` query), task 4.4 added (CLAUDE.md's open question). `chains.md` chain-3 and
  chain-4 entries re-scoped; `.claude/hooks/bash-policy.sh` and its test suite removed from this
  change's edit set entirely.
- 2026-07-27 **merged** at `547685d` — direct commit on the staging branch (attended main-thread;
  no chain branch, so no integrity run and no merge step). Class-2 files: none touched.
- 2026-07-27 note — the commit message was supplied with `git commit -F <file>`, not `-m`. The
  message text names the relaxed forms verbatim, and `-m` would have been denied by the
  content-matching rule (F2b). This is the workaround task 3.5 exists to document, used in anger.

### chain-1: poll-predicate (tasks 1.1–1.5) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: Class-2 (`scripts/fixloop.sh`,
  `.claude/commands/opsx/apply.md`), attended main-thread.
- 2026-07-27 **design decision (Class-A deviation from D1's letter, not its intent)** — D1 says
  "invert the predicate", but step 12c had no predicate to invert: it is prose, and a markdown step
  has no exit code. Implemented D1's *stated remedy* instead ("test the predicate, not the prose")
  by extracting the stop condition into a new `scripts/fixloop.sh checkverdict <tool-rc>
  <output-file>` subcommand. Exit contract: **0** settled-pass, **8** pending, **9** settled-fail,
  **2** usage error. `<tool-rc>` is reported but deliberately NOT trusted alone — `gh pr checks`
  exits 0 both when everything passed and when nothing exists, which is the entire defect.
- 2026-07-27 **RED CHECK (task 1.3) — 38 passed / 7 FAILED**, and the shape of the failures is the
  point. The red check was NOT run against a missing subcommand (all 11 assertions would have
  failed with `unknown subcommand`, proving only that the code was unwritten). Instead the **naive
  predicate the runbook's prose actually describes** was implemented first — "settle unless
  something says pending" — and the suite run against it. Observed, verbatim:

  ```text
  FAIL: no-checks-reported classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  FAIL: empty check output classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  FAIL: an unrecognised state classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  ```

  `SETTLED PASS` for the input `no checks reported on the 'integration/run' branch` **is F1**,
  reproduced as an exit code. Meanwhile all four correct-behaviour cases (all-pass, skipping,
  partial-pending, failing) PASSED against the naive predicate — so the suite discriminates the
  defect rather than merely detecting absent code. The naive implementation was never committed.
- 2026-07-27 **GREEN (task 1.5) — 45 passed, 0 failed.** The positive case (`every check passing
  classifies as SETTLED PASS`) is the group's negative control: without it a predicate that
  returned 8 unconditionally would satisfy every other assertion in the group.
- 2026-07-27 fail-safe added beyond the task list — an **unrecognised** state token classifies as
  PENDING and is named in the output. A future `gh` verdict string therefore cannot silently become
  a green; it becomes a loud pending. Same absent-is-not-success rule applied to a value that
  cannot be interpreted rather than one that is missing.
- 2026-07-27 ordering note — a definite failure outranks an uninterpretable state (`failing` is
  checked before `unknown`), because a failure is already actionable and neither order can produce
  a false green.
- 2026-07-27 **gate refused before the commit**, correctly: `GATE REFUSING TO RUN: verification
  config (or a harness hook) differs from baseline (HEAD)`, naming `scripts/fixloop.sh` and
  `.claude/commands/opsx/apply.md`. The gate compares Class-2 files against HEAD, so a Class-2 edit
  must be committed before it will run — which is what makes the commit the ratification act rather
  than a formality. Committed, then re-ran.
- 2026-07-27 **merged** at `e31bc54`; **regate: FAST GATE PASSED** on the committed tip.

### chain-2: park-staging-branch (tasks 2.1–2.4) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: Class-2 (`scripts/fixloop.sh`), attended
  main-thread. `after: chain-1` honoured — both chains extend
  `scripts/test/fixloop-preflight.test.sh`, and chain-1 was merged first.
- 2026-07-27 **RED CHECK — F3 reproduced verbatim against the COMMITTED `park`** (HEAD's
  `scripts/fixloop.sh` extracted into a throwaway fixture, so the assertion ran against the real
  refusal rather than a described one):

  ```text
  === COMMITTED park vs a staging branch ===
  rc=2
  fixloop: park expects a fix/* or chain/* branch, got 'integration/run'

  === branch state after the refusal ===
    * integration/run
  === note written? ===
    (no .claude/fixloop directory — no note)
  ```

  The command the runbook instructs refuses the branch the runbook instructs it on.
- 2026-07-27 implemented — `park` accepts `integration/*`, deriving `wip/<id>` by the same
  `${branch#*/}` rule. A staging park additionally emits a "Resuming a parked staging run" section.
- 2026-07-27 **the ancestry fact is COMPUTED, not boilerplated.** `git merge-base --is-ancestor main
  <branch>` is evaluated *before* the rename and the note states what is actually true, in both
  directions. A warning stapled on unconditionally would be noise the next reader learns to skip;
  this one is a measurement. Both directions are asserted in the suite, so the message cannot
  degrade into an unconditional string.
- 2026-07-27 **task 2.4 verified against the real case.** Generated note for the diverged-base
  condition carries every load-bearing fact the hand-rolled
  `.claude/fixloop/wip-linked-apps-data-model.md` recorded — branch, tip, reason, resume path, the
  `main`-is-not-an-ancestor caveat with the same conclusion ("do that FIRST"), and remaining work =
  runbook step 12 (a–g) — **plus one the hand-rolled note missed**: re-export
  `FIXLOOP_INTEGRATION_BRANCH=wip/<id>`, without which the toolkit resolves baselines against the
  wrong branch. Two corrections over the hand-rolled version: the resume line is `git switch` in the
  PRIMARY tree, not `git worktree add` (a staging run's remaining work is closure, which runs
  there), and the branch kind now decides which section is emitted. What the hand-rolled note had
  and this cannot generate is per-run narrative (a reviewer's open item, unrelated debris) — that
  belongs in the `reason` argument, which is preserved verbatim.
- 2026-07-27 negative control — parking an unrecognised kind is still refused, the branch is left
  untouched, and **no note is written**. Widening an accepted-input set is exactly the change that
  silently becomes "accept anything"; a half-happened rename would leave a run in a state neither
  branch name describes. Regression guard added for `fix/*`: it still parks and still gets the
  worktree resume line, with no staging-closure section.
- 2026-07-27 **GREEN — 66 passed, 0 failed.**
- 2026-07-27 **merged** at `4b0ce4b`; **regate: FAST GATE PASSED** on the committed tip.

### chain-3: document-what-is-enforced (tasks 3.1–3.6) — main-thread, HUMAN-BOOTSTRAP

Re-scoped by chain-0; `bash-policy.sh` and `bash-policy.test.sh` were removed from this change's
edit set and were not touched.

- 2026-07-27 started — no worktree, no implementer: Class-2 (`docs/harness.md`,
  `.claude/commands/opsx/apply.md`), attended main-thread. `after: chain-0, chain-1` honoured.
- 2026-07-27 **F5 narrowed on reading the target.** `docs/harness.md` §4's sandbox row was ALREADY
  correct — it records `excludedCommands` as measured inert and says in terms "do not read this row
  as 'these commands have egress'". The false claim lives only in `apply.md` step 12, which was not
  updated when the sandbox row was. So F5 is one stale runbook line, not two contradicting
  documents. What was genuinely absent from both is the **mechanism**, and that is the part worth
  recording: without it the next reader's instinct is to fix the symptom by adding more
  `excludedCommands` entries, which cannot work.
- 2026-07-27 3.1/3.5 + a new §4.1 — the bash-policy row now points to a new subsection
  **"Three policy behaviours that mislead if you meet them cold"** rather than absorbing three more
  clauses into an already-enormous table cell. The unifying property is stated explicitly: all three
  are fail-closed and correct, but each one's *denial message points somewhere other than its
  cause*. (a) the bare-command constraint and why the message blames the network rule; (b) the
  content matcher, with the file-based workaround as a call-out block and an explicit warning that
  rewording is the one response to avoid; (c) a pointer to the `gh` trust-store mechanism.
- 2026-07-27 3.4 + a new §4.2 — "Why closure's ancestor check is local and stays local". D3's
  reversal needed a *durable* reason, not a ledger line: the next reader who sees a local ancestry
  check next to an available `gh` query will otherwise "simplify" it into the form that cannot run
  under the sandbox. Recorded as measured fact (rc=0 sandboxed, main-thread, not in the tier-1 deny
  list) with the fetch-then-check answer to the stale-ref objection.
- 2026-07-27 3.3 — `docs/harness.md` sandbox row gains D7's mechanism (`OSStatus -26276` =
  `errSecInternalComponent`; trust-store access failure presenting as an egress block;
  filesystem/IPC-dependent like the `.claude/**` denial; measured identically for main thread and
  subagent, so not an agent-identity effect). `apply.md` step 12's preamble rewritten: the false
  carve-out sentence is replaced by two numbered environment facts, both flagged as measured.
- 2026-07-27 3.2 — step 12g's joined forms split into two explicitly-separate bare commands, with
  the reason and a pointer to §4.1a. Also added: park a staging run with the tool, do not hand-roll
  it (chain-2 made that possible; the runbook still implied otherwise).
- 2026-07-27 3.6 — the spec delta was itself carrying D3. Requirement renamed *"Every command a
  closure step instructs is **runnable by the caller it names**"* — the original wording
  ("a command the policy permits") could not express F5 at all, since `gh` **is** permitted by the
  policy and still cannot run. Scenario "Confirming the branch merges cleanly" no longer mandates
  the provider's report; it now requires a check that executes in the step's own environment, with
  the reason recorded so a later simplification does not reverse it. Scenario "A documented
  relaxation is not enforced" replaced by three that describe what was actually found: a relaxation
  that is *conditional*, a denial that *names a cause other than its trigger*, and a runbook that
  *asserts an environmental capability* — the last being the general form of F5.
- 2026-07-27 **merged** at `6551cc9`; **regate: FAST GATE PASSED** on the committed tip.

### chain-4: record-the-unfixable (tasks 4.1–4.4) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: Class-2 (`.claude/commands/opsx/apply.md`,
  `docs/harness.md`), attended main-thread. `after: chain-3` honoured (both edit step 12g).
- 2026-07-27 4.1 — step 12g now states the `.git/config` residue as expected and cosmetic, names
  why it cannot be cleaned in-session (`git config` tier-1 denied for every caller, orchestrator
  included), and says to leave it. Framed as "do not investigate it twice", since the cost of this
  finding was never the residue — it was the investigation it provoked.
- 2026-07-27 4.2 — `docs/harness.md` §11 records that closure step 12d has **never been exercised**:
  the first supervised run reached the ratified merge with SonarCloud green on every push, so the
  Sonar → nested-`/fix-loop` → re-push loop was skipped, not validated. Written as "unexercised, not
  known-broken", with the reason for not pre-emptively rewriting it.
- 2026-07-27 4.4 — `CLAUDE.md`'s sandbox paragraph corrected. It recorded the blocked `gh` as
  "filesystem-independent and remains **unexplained**"; both halves were wrong. Now carries D7's
  mechanism and the practical consequence. `AGENTS.md` is a symlink to this file, so the Codex-side
  instructions update in the same commit with no second edit.
- 2026-07-27 4.3 — **decision #51** appended, seven sub-decisions. It explicitly (a) resolves the
  open question decision #50 D2 left standing, and (b) records the reversal of this change's *own*
  design D3, so a reader of the design doc alone cannot act on the superseded direction. The
  verification paragraph records both red checks with their observed output, and names the two
  negative controls that keep the suite non-vacuous.
- 2026-07-27 **merged** at `0be1bde`; **regate: FAST GATE PASSED** on the committed tip.

## Verification (tasks 5.1–5.4)

- 2026-07-27 **5.1 — `./scripts/gate.sh`: FAST GATE PASSED** on the merged tip `0be1bde`.
- 2026-07-27 **5.2 — `./scripts/gate-full.sh`: FULL GATE PASSED** on the same tip, from the primary
  tree, unsandboxed. `openspec validate` 30 passed / 0 failed, including
  `change/harden-closure-lane` with the rewritten spec delta.
- 2026-07-27 **5.3 — DEFERRED TO CLOSURE, by construction.** The task is to poll immediately after a
  push and confirm the predicate reports *pending* rather than green. That condition only exists
  during step 12c of this change's own closure, so it is exercised there, not here. This is the
  task that distinguishes a fix from a plausible-looking edit — the predicate is unit-green against
  fixture text, but only closure proves it against the real tool. **Do not tick it before closure
  runs.**
- 2026-07-27 **5.4 — swept, filed, not fixed** → `findings-runbook-sweep.md`. Two instances of the
  class in `.claude/commands/opsx/archive.md` (a missing `tasks.md` proceeds *more* quietly than an
  incomplete one; absent delta specs skip the sync prompt without distinguishing "declared none"
  from "expected but absent"). Three near-misses recorded as correct so a later sweep does not
  re-examine them — notably step 12d's `sonar-pr-issues.mjs` exit-3 guard, which is exactly the
  shape the two archive.md branches lack and is worth copying rather than reinventing. Coverage
  limit stated in the file: runbooks only; `scripts/**` and `.github/workflows/**` were not swept
  for this class.
- 2026-07-27 note — the sweep was NOT filed as `openspec/critic/<date>.md`. `critic-run` uses the
  newest date-named file there as its "everything since" marker, so creating one would make the
  next critic run skip all history before today. Filed in the change folder instead.

## Closure (runbook step 12)

- 2026-07-27 **12a RULESET PRECONDITION — rc=0.** `ruleset-probe`: default branch protected by
  ruleset "Protect main" (requires PR; also `non_fast_forward`, `deletion`,
  `required_status_checks`). OK to enter closure.
- 2026-07-27 **12b** — pushed `integration/harden-closure-lane`; draft PR
  [#9](https://github.com/Davron2004/Whim/pull/9) opened. The PR body was supplied with
  `--body-file`, not `--body`: it names the protected vocabulary throughout and `--body` would have
  been denied by the content matcher (F2b). Second use of that workaround this run, both times in
  anger rather than as a demonstration.

### 12c — task 5.3 discharged, and a NEW defect found by executing the step this change rewrote

**F6 (new, found and fixed in-flight): `$TMPDIR` is remapped by the sandbox, so the step's own two
commands could not see each other's file.** Step 12c as written told the operator to capture with
`gh pr checks <n> > "$TMPDIR/whim-checks.txt"` and then classify that path. `gh` requires an
unsandboxed context (F5); `checkverdict` does not, so it ran sandboxed — and looked in a *different*
`$TMPDIR`. Observed:

```text
fixloop: checkverdict: cannot read check output '/tmp/claude-501/whim-checks.txt'
checkverdict rc=2
```

**What saved it is the part worth recording.** `checkverdict` exited **2**, not 0. A predicate that
treated "no rows parsed" as a pass would have reported SETTLED PASS on a file it never opened —
F1 reincarnated one layer down, in the very code written to remove F1. The `[ -r "$outfile" ] || die`
guard is what made an unreadable file a *usage error* rather than a verdict. Step 12c now states
that both commands must run in the same sandbox context (in practice both unsandboxed), and that
**exit 2 is never a verdict** — not pending, not passing, not failing.

This is the fixture-vs-reality gap in miniature: 66 green assertions could not have caught it,
because the fixture hands `checkverdict` a path it wrote itself. Only running the runbook did.

**Task 5.3 — polled immediately after the push, verdict PENDING, not green:**

```text
poll 1 (immediately after push, gh rc=8)
  isolation-suite  pending   quality-gate  pending
  → PENDING — 2 of 2 check(s) have not reported a verdict yet (tool rc=8).

poll 2 (gh rc=8)
  isolation-suite  pending   SonarCloud  pass   quality-gate  pass
  → PENDING — 1 of 3 check(s) have not reported a verdict yet (tool rc=8).

poll 3 (after bounded --watch, gh rc=0)
  SonarCloud  pass   isolation-suite  pass   quality-gate  pass
  → SETTLED PASS — all 3 check(s) reported an explicit passing verdict (tool rc=0).
```

**The check SET GREW between polls 1 and 2** — `SonarCloud Code Analysis` did not exist at poll 1 and
was already passing at poll 2. This is the sharper form of F1's hazard and it was *observed*, not
theorised: the set of "every required check" is not fixed at push time, so a predicate that settles
on "every check I can currently see has passed" can settle against an incomplete set. The predicate
counts what it sees each poll and re-evaluates, which is why poll 2 reported 1-of-3 rather than
concluding on the two it had already seen pass.

**Honest limit on 5.3.** The *strictest* sub-case — `no checks reported on the '<branch>' branch`
with exit 0, where the naive predicate would have said PASS — was **not** observed: CI registered
both jobs before the first poll landed. Polls 1 and 2 are real-condition evidence that the poll
reports pending rather than green, which is what 5.3 asks for; they do **not** discriminate the
naive predicate, which would also have seen the literal word `pending`. That discrimination rests on
the fixture red check (recorded under chain-1), which does exercise the exact window. Retried at the
post-cleanup force-push — see below.
- 2026-07-27 **12d SKIPPED — SonarCloud green on first analysis.** Step 12d therefore remains
  **unexercised for the second consecutive run**, exactly as chain-4 recorded in `docs/harness.md`
  §11. The note it added is now doubly earned rather than hypothetical.

### 12e — history cleanup SKIPPED, by operator decision, with the reason recorded

The branch is 8 commits: one per chain (chain-0…chain-4) plus three findings-driven follow-ups
(verification + runbook sweep; reviewer findings; the F6 fix). That is already the *output* shape
`/git-cleanup` exists to produce — task-level semantic commits — so the lane had little to do
except fold the three follow-ups.

Not folded, deliberately. The runbook's "none survive standalone" rule is written for **Sonar-fix
commits**, which are mechanical noise attached to a finding someone else raised. These three are
not: each records a distinct *discovery* — what the gates verified, what the reviewer caught, and
what executing the runbook caught. For a change whose whole subject is "assert what you actually
observed", collapsing when-and-how each problem surfaced into a tidier log destroys the part with
the most evidentiary value. Skipping also avoids a force-push and its re-analysis wait for a
cosmetic gain. Recorded here so the skip is a decision with a reason, not an omission.

- 2026-07-27 **12f ANCESTOR CHECK — rc=0**, run the way `docs/harness.md` §4.2 prescribes and the
  way this change's own D3 reversal settled: **two separate bare commands**, `git fetch origin`
  then `git merge-base --is-ancestor origin/main integration/harden-closure-lane`. Checked against
  the *fetched* published tip rather than local `main`, which was stale at `e08e06d` for this whole
  run — the exact stale-local-ref hazard D3 raised, answered by fetching rather than by swapping in
  a `gh` query that cannot run under the sandbox. Both commands ran without a policy denial,
  confirming §4.1a's bare-form rule in practice.

### Task 5.3 — second attempt at the exact F1 window, and an honest negative result

The post-`12f`-fix push gave a second chance at the discriminating condition (`no checks reported`,
exit 0). Polled within seconds of the push:

```text
gh rc=8
  isolation-suite  pending   quality-gate  pending
  → PENDING — 2 of 2 check(s) have not reported a verdict yet (tool rc=8).
```

**The exact window was again NOT observed** — GitHub registered both jobs before the poll landed,
on both pushes. Recorded as a negative result rather than glossed: on this repository CI registers
faster than a poll can be issued by hand, so the `no checks reported` window is real (it is what
`research.md` measured) but too narrow to catch reliably in the wild. The discrimination between
the fixed predicate and the naive one therefore rests on the **fixture red check** (chain-1), which
exercises that exact input deterministically. What the live polls *do* establish is the weaker but
still necessary claim 5.3 asks for: polled immediately after a push, the predicate reports PENDING
and not green, four times across two pushes.

The set-growth observation repeated on this push too — `SonarCloud Code Analysis` was absent at the
first poll (2 checks) and present at the second (3 checks). Twice observed, in two independent
pushes, so it is a property of the system rather than a one-off race.

**Incidental evidence for keeping the timeout generous.** `isolation-suite` took **1m53s** on the
first push and **11m43s** on the second — same job, same repository, 6× the wall-clock, from runner
contention alone. A tight fixed cap would have parked a perfectly healthy run. This is the reason
D1 kept the bounded timeout as a *park with a clear reason* rather than tightening it into a
liveness assumption: the poll's job is to refuse a false green, not to predict CI latency.

## Reviewer pass (runbook step 11)

Dispatched on the full range `3b3c7fc..ab42615` with the spec excerpts and six explicit targets,
including an adversarial-input brief for `checkverdict` (CRLF, header rows, whitespace-padded and
case-differing state tokens, missing trailing newline, tab-in-URL, nonexistent file).

- 2026-07-27 **VERDICT: findings — no HIGH, no MEDIUM, three LOW. SPEC CONFORMANCE: conforms.
  REPORT HONESTY: matches diff.**
- Independently reproduced rather than taken on trust: `gate.sh` (PASS), the preflight suite
  (66 passed / 0 failed, matching the ledger's claim), `openspec validate --strict` (valid),
  `git merge-base --is-ancestor 511f024b <base>` (rc=0, confirming F2 was stale), and an empty
  `git diff` on both `.claude/hooks/bash-policy.sh` and `.claude/hooks/test/bash-policy.test.sh`
  (confirming no security deny was re-broadened).
- The **one-directional invariant held** under every adversarial input: exit 0 is reachable through
  exactly one path requiring `total>0`, `failing==0`, `unknown==""`, `waiting==0`. Whitespace-padded
  and `\r`-suffixed tokens fall to the `unknown` catch-all → PENDING, never a false pass. The
  reviewer could not construct an input producing SETTLED PASS without every row being an exact
  pass-family match.
- The reviewer also confirmed the ancestry-ordering test is a **genuine** guard, not a label: were
  the check moved after the rename, the pre-rename ref would no longer resolve and the
  `advanced: no` fixture would silently report "NOT an ancestor", failing that assertion.

### LOW findings — all three accepted and fixed

A fix chain would be disproportionate for three documentation-accuracy defects; they are fixed
in place. Worth fixing rather than deferring, though: they are accuracy-of-self-description
defects, which is the exact class this change exists to remove.

1. `progress.md` / `tasks.md` headers listed **five** Class-2 files "touched", including
   `scripts/gate.sh` — which this change only ever *runs* (task 5.1) and never edits. Inherited
   boilerplate from the predecessor's file set; `bash-policy.sh`'s removal was documented but
   `gate.sh`'s was never true to begin with. Both headers corrected, and both now state explicitly
   which two files are NOT edited and why. A change whose thesis is "assert what is true rather
   than what is absent" should not over-count its own blast radius.
2. `scripts/test/fixloop-preflight.test.sh` — a comment labelled an assertion "Regression guard:
   the pre-existing kinds still park" when that assertion actually exercises the new
   `tip=`-lookup die path on a *nonexistent* branch. The real regression guard is
   `case_park_fix_branch_unchanged` below it. Comment corrected and cross-referenced. No test gap.
3. `checkverdict`'s documented exit contract said "2 usage error", but a *missing positional
   argument* exits **1** via the shell's `${N:?}` unbound-parameter check; only the unreadable-file
   path reaches `die` (2). Corrected in all three places the contract is stated (the subcommand
   list, the arm's header comment, decision #51 D1). *Not* "fixed" by adding explicit argument
   validation: every subcommand in `fixloop.sh` uses `${N:?}`, so making this one different would
   trade a documentation inaccuracy for an inconsistency. Both codes remain safely distinct from
   the three verdicts, so the invariant is untouched either way.

## Closing summary

**Chains run:** 5 (chain-0…chain-4), all main-thread HUMAN-BOOTSTRAP, serial. **Redispatches:** 0 —
no implementer was dispatched at all, since every edited file is Class-2. **Merge conflicts:** 0.
**Halts:** 0. **Parks:** 0.

**Findings, final disposition** — the planned set did not survive contact:

| # | Planned | Outcome |
| --- | --- | --- |
| F1 | poll infers a verdict from silence | **REAL, fixed** — `checkverdict`, red-checked against the naive predicate |
| F2 | hook lost a documented relaxation | **FALSE, dropped** — relaxation live since `511f024b`; finding aged out mid-run |
| F2-residual | — (not planned) | **REAL, fixed** — the compound exclusion is what actually denied; documented in §4.1a |
| F2b | matcher judges carried content | **REAL, fixed** — workaround documented in §4.1b, and used twice this run in anger |
| F3 | `park` refuses its own documented input | **REAL, fixed** — red-checked against the committed script |
| F4 | `.git/config` residue | **REAL, documented** — unpreventable, so named as expected |
| F5 | — (found at dispatch) | **REAL, fixed** — `gh` fails at the trust store; resolves #50 D2 |
| F6 | — (found during closure) | **REAL, fixed** — `$TMPDIR` is sandbox-remapped; step 12c corrected |

Four planned findings in, seven real ones out, one planned finding deleted. **Three of the seven
were found by re-measuring or by executing rather than by reading** — F2's refutation and F5 at
dispatch, F6 during closure.

**Deviations by class.** Class A: two. (1) chain-1 implemented D1's *stated remedy* rather than its
letter — "invert the predicate" was impossible because step 12c had no predicate, only prose; the
stop condition was extracted into a subcommand instead. (2) chain-2's ancestry caveat is computed
rather than boilerplated, which the task did not require but the negative control now enforces.
Class B: one, escalated and resolved by the operator — chains.md declared the whole change
undispatchable, and the operator elected the predecessor's attended main-thread precedent rather
than runbook step 2's "surface and skip". Class C: none.

**Two design decisions were overturned by measurement**, both by the operator after evidence was
put to them: D2 (resolved as a void premise rather than either of its two branches) and D3
(reversed — the local ancestor check stays). Neither was overturned by the dispatcher unilaterally.

**Gates:** `gate.sh` PASS ×5 (one per merge point), `gate-full.sh` PASS ×2, preflight suite 30 → 66
assertions, `openspec validate` 30/0. **Reviewer:** no HIGH, no MEDIUM, three LOW, all fixed;
report honesty verified against the diff.

**What this run is evidence for**, beyond its own findings: the harness caught two of its own
defects *while being used to fix its own defects*. The gate refused a dirty Class-2 tree and forced
the ratifying commit; `checkverdict`'s readable-file precondition turned what would have been a
false SETTLED PASS into a usage error, inside the code written to remove exactly that class. The
standing rule the run produced — **re-measure a finding at dispatch** (decision #51 D2) — is the one
worth carrying forward, because it is what stopped a security deny from being re-broadened on the
strength of a day-old measurement.

**Left open, deliberately:**

- The `no checks reported` window was never observed live across two pushes (see task 5.3 above).
  Discrimination rests on the fixture red check.
- Closure step 12d unexercised for a second consecutive run; recorded in `docs/harness.md` §11.
- Two absence-read-as-success instances in `opsx/archive.md`, filed in `findings-runbook-sweep.md`,
  not fixed — out of scope and worth their own change.
- `scripts/**` and `.github/workflows/**` were not swept for that class.

**MEMORY: proposals** — none. No implementer ran, so there are no implementer reports to harvest;
the transferable lessons are in decision #51 rather than in agent memory.
