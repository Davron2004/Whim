# Dispositions — Sonar round 1 (PR #6, `integration/automate-closure`)

Nested fix round dispatched from the `automate-closure` CLOSURE step. Run-id `automate-closure`;
staging branch reused (never cut a second). Findings: `findings-sonar-1.md` (44 open issues,
gate ERROR, ingested 2026-07-24 via `node scripts/sonar-pr-issues.mjs --pr 6`, exit 10).
All 44 transcribed to `openspec/critic/sonar-ledger.md` at ingestion time.

## Lane split (forced by the protected surface, not by preference)

`.claude/hooks/protect-harness.sh` blocks subagents (`exit 2`) on `.claude/**` and gives the
main thread `permissionDecision: "ask"`. So the 44 findings split:

| Lane | Files | Findings | Route |
|---|---|---|---|
| A1 | `scripts/sonar-pr-issues.mjs` | S1–S4 (4) | `fix-worker` in worktree → integrity → review → merge |
| A2 | `scripts/ruleset-probe.mjs` | S9–S10 (2) | `fix-worker` in worktree → integrity → review → merge |
| B1 | `.claude/hooks/bash-policy.sh` | S5–S8, S11 (5) | read-only agent authors patch → **human-ratified** main-thread write |
| B2 | `.claude/hooks/test/unroll.test.sh` | S12–S44 (33) | read-only agent authors patch → **human-ratified** main-thread write |

Neither `scripts/sonar-pr-issues.mjs` nor `scripts/ruleset-probe.mjs` appears in any protected
pattern — deliberately, per the former's own header ("NOT part of the protected gate surface":
the server-side Sonar gate is the real enforcement).

Testability class for every finding in this round: **structural — no behavioral delta**.
No new tests; assurance is the existing suites + `gate.sh`/`gate-full.sh` staying green and the
re-run Sonar gate going green. Workers were explicitly told not to fabricate source-grep tests.

## Ledger

- `2026-07-24` ingest — 44 findings, gate ERROR, exit 10 · `findings-sonar-1.md` · 44 ledger lines appended
- `2026-07-24` lane-A worktrees pre-created (Flow A) at `integration/automate-closure` tip `3793889`:
  `.claude/worktrees/sonar-a1`, `.claude/worktrees/sonar-a2`
  - NOTE: first attempt created them *nested* under the `automate-closure` worktree, which made
    their paths match the Class-2 glob `*/.claude/worktrees/*/.claude/*` and would have hard-blocked
    both workers. Recreated at the repo root. Worth remembering for any future nested-worktree run.
- `2026-07-24` A2 `dispatched` (BASE `3793889`)
- `2026-07-24` A2 `worker-complete` — branch `fix/sonar-a2`, commit `16aaf72`, gate PASS, 4 lines,
  `structural-no-test`. Worker declined the naive `e?.message ?? e` rewrite in favour of
  `e?.message ? e.message : e`, preserving the falsy-`message` fallthrough (`??` would have changed it).
- `2026-07-24` A2 `integrity` exit 0 (after setting `FIXLOOP_INTEGRATION_BRANCH=integration/automate-closure`
  — without it `base_of` merge-bases against `main` and reports the whole change as Class-2 tamper)
- `2026-07-24` A1 `dispatched` (BASE `3793889`)
- `2026-07-24` A1 `worker-complete` — branch `fix/sonar-a1`, commit `9722688`, gate PASS, 4 sites,
  `structural-no-test`. S7785 cleared by hoisting the `main()` body into the existing
  `import.meta.url` guard (top-level await inside the block) rather than adding `await main()`.
- `2026-07-24` A1 `integrity` exit 0
- `2026-07-24` A1+A2 `verify` — reviewer **ACCEPT** on both. Ran `scripts/test/sonar-pr-issues.test.mjs`
  in the a1 worktree: 10/10 pass; exercised the CLI's documented exit codes (2 on no-args, 1 on a
  bogus project) and confirmed importing the module still does not run the CLI body; grepped — no
  other reference to `main` in the repo. Confirmed no test was fabricated on either branch.
  - REVIEWER NOTE (low, no code change): `sonar-pr-issues.mjs:72` `r.json.paging?.total` is
    *conditionally* equivalent to the old `&&` form, not universally. They diverge if `paging` were
    falsy-but-not-nullish (`0`/`''`/`false`), where the old form feeds that value to `??` and the new
    one feeds `undefined`. Safe here because the SonarCloud API sends `paging` as an object or omits
    it — an external contract, not a type-enforced guarantee. Recorded rather than "fixed": the
    alternative is noise.
- `2026-07-24` A1 `merged` → `integration/automate-closure` + `regate-pass` (FAST GATE PASSED)
- `2026-07-24` A2 `merged` → `integration/automate-closure` + `regate-pass` (FAST GATE PASSED)
- `2026-07-24` B1+B2 **PARKED — needs an attended session.** Patches authored and vetted
  (`pending-class2-sonar-1.md`, covers 37 of 44 findings) but NOT applied: the auto-mode classifier
  denies main-thread `Edit` on `.claude/**` in a background run. Not routed around — the `ask` prompt
  IS the Class-2 ratification, so bypassing it would defeat the control. Confirms the standing
  lesson: land `.claude`-heavy work attended.
- `2026-07-24` `push` **HELD.** 37 findings remain open, so a push now would spend a CI + Sonar cycle
  on a guaranteed-red gate. Push once Lane B lands, then re-poll for round 2.
- `2026-07-26` B1+B2 **LANDED** in an attended session — commit `1f38341`, all 38 patches from
  `pending-class2-sonar-1.md` applied main-thread through the permission dialog, exactly as the
  parked note prescribed. S5332 (§B2.8) ruled by the user as **(a) `http://` → `https://`**.
  Red-check: unroller **46**, bash-policy **44** — both identical to the pre-patch baseline, so no
  assertion was silently dropped. Fast gate PASSED.
  - Two deviations from the vetted patch text, both behaviour-preserving and both recorded rather
    than silently absorbed:
    1. The negative-control line's `printf 'PASS: negative control …\n'` was also routed through the
       new `pass()` helper. Not required by S1192 (that literal is distinct, not one of the four
       repeated `'PASS: %s\n'`), but the output is byte-identical and the file is now internally
       consistent.
    2. B1.5's comment was reworded from "falls through to the **auto-allow** vocabulary below" to
       "falls through to the **vocabulary case** below" — see the classifier divergence below.
- `2026-07-26` `gate.sh` refused the pre-commit run: uncommitted Class-2 edits are compared against
  HEAD, so a protected change must be **committed** before the gate will run it. Working as designed
  (the commit IS the deliberate-human-change signal), but worth knowing — it inverts the usual
  gate-then-commit order for Class-2 work.
- `2026-07-26` `gatefull` **FULL GATE PASSED** at `1f38341` from the clean primary tree. Task 7.1
  closed definitively (Metro + all three Chromium suites now actually executed, not reasoned about).

## Divergences found while landing Lane B (candidates for the 7.2 divergence log)

Three, all in the closure path this change is supposed to automate. None is a Lane-B regression —
each was latent and only surfaced because this was the first attended end-to-end attempt.

**D-a. `fixloop.sh gatefull` silently half-applies its checkout under the command sandbox.**
The sandbox denies writes under `.claude/**` in the primary tree, so `git checkout --detach <branch>`
prints `Operation not permitted` for each protected file — and **still exits 0**. The result is a
mixed tree (`scripts/` at branch content, `.claude/` at `main` content) that the gate's own tamper
tripwire then correctly reports as a mismatch. The failure presents as a *tamper accusation*, which
reads like the change is malformed; the actual fault is an incomplete checkout. `fixloop.sh` already
assumes otherwise in its own comment ("this whole command runs unsandboxed anyway for Chromium +
checkout") — the assumption is simply unenforced. Fix candidate: have `gatefull` verify the checkout
landed (`git diff --quiet <branch>` right after) and `die` with *that* reason. Filed, not fixed —
`scripts/fixloop.sh` is Class 2 and this is out of scope for a Sonar round.

**D-b. `gatefull` needs `FIXLOOP_INTEGRATION_BRANCH` or it accuses the whole change of tampering.**
Same trap the round-1 `integrity` step hit. Unset, `base_of` merge-bases against `main`, so this
change's own human-ratified `gate.sh` edit is diffed against a baseline that predates it. Now a
documented prerequisite in task 7.1. Fix candidate: `gatefull` could refuse when the target branch
is not an ancestor-or-descendant of `INTEGRATION_BRANCH`, rather than proceeding with a wrong base.

**D-c. The closure push cannot be executed by the harness that authorizes it.**
`git push origin integration/automate-closure` is denied — correctly — because the *primary tree is
on `main`*, and Claude Code loads hooks from the primary project root. The new scoped main-thread
push rule exists only on the branch, so it cannot take effect until the branch is merged. Every
closure push for THIS change is therefore human-executed; the automation this change delivers goes
live for the *next* run. Structural bootstrapping, not a bug — but it means task 7.2's supervised
first run must be a *subsequent* change, and the first closure here is unavoidably manual.

## Harness lesson — NEVER run `gatefull` in the tree you are working in

The first `gatefull` was invoked from inside `.claude/worktrees/automate-closure` — the same tree
this round was committing into. That single mistake produced **two** distinct failures:

**1. A bogus `FULL GATE FAILED: metro-guard`.** `gatefull` checks the branch out into *whatever tree
it is invoked from*. A linked worktree has no `node_modules` (gitignored, never installed there),
and per the script's own comment "Metro (`guard:metro`) does NOT walk up to the repo-root copy the
way Node does". Every other check passed (Node resolution *does* walk up); only Metro failed. The
tell was in the summary line: `restored to integration/automate-closure` — `start_ref` is the branch
only when the command ran in the worktree; from the primary tree it reads `restored to main`.
Re-run from the primary tree: **FULL GATE PASSED** (all 28 openspec items, all three Chromium
invariant suites, `metro-guard`, `codex-sync`).

**2. A silently orphaned commit.** `gatefull` does `git checkout --detach <branch>` then restores with
`git checkout --force <start_ref>`. Commits made in that tree *while the gate is running* land on the
detached HEAD; the forced restore then rewinds the branch ref and abandons them. The docs commit
`0efdc6c` was orphaned exactly this way — `git log` still showed it on top, but the branch ref had
moved back to `90eae02`. Recovered with `git merge --ff-only 0efdc6c` (its parent was the tip, so it
fast-forwarded cleanly). Nothing lost, but this would be easy to miss and hard to diagnose later.

Two follow-ups worth considering for the harness (NOT done here — out of scope for a Sonar round,
and `scripts/fixloop.sh` is Class-2 anyway):
1. `gatefull` could assert it is in the primary tree (e.g. `git rev-parse --git-common-dir` ==
   `git rev-parse --git-dir`) and `die` with that reason, instead of surfacing a misleading
   `metro-guard` failure and quietly detaching the caller's HEAD.
2. The primary tree carried an **untracked** `openspec/changes/automate-closure/` (the pre-branch
   proposal draft — `tasks.md` was the stale all-unticked version, the other 8 files byte-identical
   to the branch). It blocked `git checkout --detach` with "untracked working tree files would be
   overwritten", which `gatefull` reports only as "checkout … failed". Removed (backed up first;
   fully recoverable from the branch, which carries the newer `tasks.md`).

## Round-1 outcome

| | Findings | State |
|---|---|---|
| Lane A (merged) | 6 | ✅ cleared, reviewed, gated, merged |
| Lane B (landed `2026-07-26`) | 37 | ✅ ratified main-thread, suites unchanged at 46/44, gate-full green |
| S5332 @ `unroll.test.sh:94` | 1 | ✅ ruled (a) — `http://` → `https://`; deny kernel matches `*curl*` with no scheme inspection, so the assertion is unchanged |

All 44 addressed. **Confirmed by re-analysis `2026-07-26` — NO ROUND 2.**

- `2026-07-26` `push` `db7a420` → CI green: `isolation-suite` pass (2m7s), `quality-gate` pass (37s),
  `SonarCloud Code Analysis` pass (1m58s).
- `2026-07-26` `re-ingest` — `node scripts/sonar-pr-issues.mjs --pr 6` → `gate: OK`, `issues: 0`,
  **exit 0**. Round 1 closed at 44/44; the round-2 findings file is empty by construction, so the
  nested fix-loop does not open.
- Incidental but load-bearing: this is the first end-to-end exercise of `sonar-pr-issues.mjs`
  against a real PR rather than mocked HTTP. The auth-visibility guard passed (a `components/show`
  200 precedes the empty-findings report), so `issues: 0` is a genuine clean read and not the
  200/total:0 masquerade the guard exists to catch — exactly the failure mode test case 4.2 mocks.

Note: `S1192 @ unroll.test.sh:84` and one `S7679 @ 84` are counted in Lane B's 37; the round's
44 = 6 + 37 + 1.
