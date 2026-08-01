## Context

Roadmap #12 (lane C), the last measurement gap before v1. Its inputs exist: change #1 produced
`docs/app-corpus.md` (11 Tier-0 apps) and `docs/sdk-gap.md` §6 (22 visible prompt seeds, prose-only, no ids)
plus §7's holdout protocol; change #9 shipped `checks/` (`runStaticChecks`, pure and deterministic, closed
`DIAGNOSTIC_KINDS`). Change #10 `synthetic-run-harness` is being applied concurrently and will merge first;
this change treats its interfaces as given. Change #11 (`generation-loop`) is unbuilt, so real candidate
generation is not available yet — `server/src/pipeline.ts`'s `createStubPipeline` is the only model seam that
exists (research.md §Current behavior).

Two constraints dominate the design and are **not** re-litigated here:

1. **Decision #42 locks the holdout set out of the repository.** It lives with the user, outside the
   agent-readable tree. This change must not create, locate, name, or infer holdout content; the runner's job
   is to accept a location the user supplies attended.
2. **spec.md §16.4's reward-hacking trap.** Any eval an implementing agent can read, it can overfit to. The
   visible/holdout divergence is the only mechanical alarm we get, and it only works if the holdout can be run
   and reported *without* its content leaking back into the repo.

Everything else follows from those two plus the settled repo constraints: behavioral red-checkable Node
acceptance suites, `checks/` stays pure, `DIAGNOSTIC_KINDS` is additive-only and centrally owned, trusted-
vantage-only containment verdicts (F4), exactly one terminal `GenerationEvent` per completed stream.

## Goals / Non-Goals

**Goals:**

- A CLI a person runs attended, pointed at any eval set, producing a report that is meaningful to diff against
  last week's.
- Three tiers with *declared, testable* gating semantics rather than an implicit score blend.
- Tier B expressible entirely as data, so the user's private holdout set can carry real behavioral
  expectations without shipping code into the runner.
- Tier C runnable with zero network access in the gate, and with a rubric whose identity travels with every
  score.
- A single seam to the synthetic-run harness, so its still-unpinned field names cannot spread.

**Non-Goals:**

- CI wiring of eval runs (cost; roadmap #12 "Out").
- Corpus growth beyond Tier 0.
- Creating holdout content, or recording anything about where it lives.
- Making the model-bakeoff decision. The runner enables it; the decision is an attended run plus a
  decision-log entry, and it needs live API access.
- A scoring model that collapses three tiers into one number.

## Decisions

### D1 — `evals/` is a plain top-level directory, not an npm workspace

Mirrors `checks/` (research.md §Current behavior: `checks/` is deliberately not a workspace, kept
dependency-light so any consumer imports it as raw TS). A new workspace would drag `guard:metro` exposure and
either inherit or widen `server/`'s closed dependency budget (`hono`, `@hono/node-server`, `@whim/contract`).
The eval runner needs neither. **Alternative rejected:** placing it inside `server/` — it would inherit the
React/RN-free budget rule for code that never ships to a device, and put an operator CLI behind a server
workspace it does not serve.

### D2 — Location is an argument, never a default (the holdout injection point)

`--eval-set <path>` > `WHIM_EVAL_SET` > **refuse**. There is exactly one holdout injection point and it is
this resolution step. Deliberately there is no "default holdout path," no config file naming one, and no
`evals/sets/holdout/` placeholder — a placeholder is an invitation for a future agent to fill it. The
committed visible set is addressed by path like any other set, so the code path the user exercises on the
holdout is the same one the gate exercises on the visible set. **Alternative rejected:** a config file listing
known sets — it would record the holdout's location in the repo the moment anyone used it.

### D3 — Redaction happens at report construction, keyed off the set's declared visibility

An eval set's manifest declares `visibility: visible | holdout`. The report constructor takes the visibility
and, for `holdout`, emits `caseId` + `promptSha256` and nothing else derived from prompt/expectation text or
candidate source. Placing it at construction rather than at the print/serialize boundary means `diff`,
`compare`, the Markdown summary, and console output all inherit it — there is no unredacted object for a
future feature to accidentally serialize. The digest keeps holdout cases *addressable* across runs (so
`compare` and `diff` work) without being readable. **Alternative rejected:** redacting at print time — it
leaves an unredacted in-memory report that any new output path would leak.

### D4 — Gating semantics: A short-circuits, B gates the verdict, C never gates

- **Tier A** is the deterministic gate: `runStaticChecks` (any `error`-severity diagnostic fails) plus the
  synthetic-run boot/containment outcome. On failure, B and C are recorded `skipped: tier_a_failed` — a
  candidate that does not parse or does not contain has nothing to behaviorally assert about and judging it is
  wasted model spend.
- **Tier B** decides the case verdict: `pass` iff Tier A passed and every *required* assertion passed.
- **Tier C** never gates. It is non-deterministic by construction; letting it flip a pass/fail would make run
  reports undiffable and would put model noise into a regression signal. It is recorded, diffed as score
  deltas, and read by a human. B failing does **not** suppress C: a candidate that behaves wrongly can still be
  informative to judge, and the two signals are meant to be read side by side.

### D5 — Tier B assertions are inert data over a closed vocabulary

Assertions are `{ english, kind, target, ... }` records where `kind ∈ ASSERTION_KINDS`. Two reasons, both
load-bearing:

- **The holdout set is user-authored and lives outside the repo.** If assertions were JS, running the holdout
  would mean the runner importing and executing code from an arbitrary path — an execution hazard, and it would
  make the user's private set a code-supply-chain surface for a tool whose whole purpose is to be trusted.
- **English-first is a spec requirement (§16.3), not a nicety.** Making the English statement a mandatory field
  the loader enforces is what keeps it from decaying into a comment. The statement is carried verbatim into
  failure output, so a red assertion reads as a sentence.

The vocabulary starts closed and small — reachability of declared screens, presence/absence of a recorded
syscall or cue, presence/absence of a diagnostic kind, render-without-error, storage round-trip — and grows
additively, in the same spirit as `DIAGNOSTIC_KINDS`. **Alternative rejected:** letting eval sets supply
predicate functions; expressive, but unrunnable against an untrusted directory.

### D6 — One adapter owns the synthetic-run report; tiers see a `RunObservation`

research.md flags that `synthetic-run-harness`'s directory name, exact report field names, entry-point
signature, and on-disk behavior are all explicitly left to its implementer. Only the *shape* is fixed
(diagnostics in checks-contract form, containment verdict from the nonce-authenticated probes frame, per-stage
timings, syscall/cue trace, screens visited vs declared, applied budgets). So exactly one module —
`evals/adapters/synthetic-run.ts` — imports that harness and normalizes it into `RunObservation`. Tier A and
Tier B read only `RunObservation`. Consequences: when the harness's real signature lands, one file changes;
and the tier evaluators are unit-testable against synthesized observations, so the gate does not launch
Chromium per assertion. The adapter itself is pinned by one recorded-report fixture.

### D7 — Judge is an interface with three implementations; the gate can only reach two

`Judge.score(input) -> Promise<JudgeVerdict>`. `createScriptedJudge(map)` returns fixed verdicts;
`createReplayJudge(dir)` replays recorded transcripts keyed by case id + rubric version. The live judge wraps
the existing `OpenRouterClient` (already unmounted with an injectable `FetchFn`) and **throws on construction**
unless both an explicit opt-in argument and the credential env var are present — failing loudly rather than
silently degrading to a fake, which would make a "green" run meaningless. With no judge at all, Tier C is
`skipped: no_judge_configured`, which is the normal state for the gate and for a fully offline run.

Verdict validation is part of the tier, not the judge: a verdict missing a criterion, missing a rationale, or
scoring outside range is Tier C `error` — never a pass. That closes the obvious failure mode where a flaky or
truncated model response reads as a perfect score.

### D8 — Rubric is a committed English document with a version and a content hash

None exists in the repo (research.md §Risks). It is originated here as `evals/rubric/<version>.md` with a
closed criteria list. Every Tier-C result records `rubricVersion` + judge identity, because a score is
meaningless without knowing what it was scored against — and `compare` refuses to compare Tier C across rubric
versions. A checked-in hash of the rubric's scored content makes an un-versioned edit fail the suite: this is
red-checkable (edit the rubric, suite goes red) rather than a source-grep test.

### D9 — Canonical report body with timings segregated

Cases sorted by id, assertions in declared order, stable key order, JSON with a fixed indent. Durations and
wall-clock timestamps go in a `timings` section excluded from the diffable body — the same determinism rule
`synthetic-run-harness` adopted (field-content determinism, timings excluded). This is what makes "re-run on
every prompt/SDK change" (§18) actually produce a readable diff instead of a wall of noise. Tier C scores are
in the diffable body but marked non-deterministic, so a diff shows score deltas without pretending they are
regressions.

### D10 — The divergence alarm is a `compare` of two report files

Because the holdout report is redacted (D3) it can be kept next to the visible one. `compare` computes per-tier
pass rates and raises `overfitting_alarm` + exit non-zero when the holdout trails the visible set by more than
a threshold. This is §16.4's overfitting signal made mechanical without the repo ever seeing a holdout prompt.
Mismatched schema or rubric versions are refused rather than compared, because a divergence number computed
across incompatible runs is worse than no number.

### D11 — Corpus slugs, introduced here, bound to the corpus document

Today apps are matched by prose name across three documents (research.md §Corpus app inventory) — unusable as
a case key. `evals/corpus.ts` holds the 11 Tier-0 slugs; `docs/app-corpus.md` gains a slug column; a drift
check in the acceptance suite fails when the two sets differ in either direction. That check is behavioral and
red-checkable (add a corpus row, suite goes red) and it exists because the holdout set — authored outside the
repo — must reference apps by a key that cannot silently drift.

### D12 — Candidate sourcing has an offline path that needs no model at all

`--source-dir` maps case id → source file; `--generate` drives an injected `Pipeline`. This is what makes the
change useful *now*, before #11: candidates can be produced by any means and dropped in a directory. The
pipeline path is tested against `createStubPipeline` only. Stream consumption enforces exactly one terminal
event and classifies a violation as a *runner* error, not a candidate failure — otherwise a transport bug would
be recorded as a bad model.

### D13 — Class-2 config is recorded, never applied by a chain

A new top-level Node suite costs four protected edits (research.md §Current behavior): a `package.json`
script, a `tsconfig.json` `exclude` entry, a `scripts/gate.sh` `check` line, and a `knip.json` workspace
extension. No chain touches them. One task writes the exact diff to `pending-class2.md` for human application.
Until that lands, implementer chains run their suite directly via `node evals/test/run.mjs`, so no chain is
blocked on the bootstrap. `.gitignore` for the report output directory is *not* protected and is a normal
dispatchable edit.

### D14 — The runner's own suite auto-discovers `evals/test/*.test.ts`

`checks/test` and `server/test` use different harness idioms and neither is binding precedent. This change
takes `server/test`'s simpler tally harness (no phased greenBy machinery is needed — this change has no
pre-authored red corpus), but adds file auto-discovery rather than a hand-maintained registry. That is a
dispatch-level decision as much as a testing one: without it every parallel chain would edit one shared
registry file and collide on merge.

## Risks / Trade-offs

- **`synthetic-run-harness`'s real signature differs from its planning docs** → D6 confines the blast radius to
  one adapter module and one recorded fixture. The chain that writes the adapter reads the harness's *merged*
  `handoff/` contract, not its proposal text.
- **The closed assertion vocabulary is too small for a real holdout expectation** → the user discovers this
  attended, and the vocabulary is additive. The failure mode is a load error naming the unknown kind, which is
  a clear signal, not a silent wrong answer.
- **The judge is non-deterministic, so Tier C diffs are noisy** → mitigated by never letting C gate (D4), by
  recording rubric + judge identity (D8), and by refusing cross-rubric comparison (D10). Residual noise is
  accepted; Tier C is a human-read signal.
- **The divergence threshold is a guess** → it is configurable and recorded in the report, and the alarm is
  advisory-by-exit-code rather than a silent gate. A wrong threshold is visible and cheap to retune.
- **A future agent adds an unredacted output path** → D3 puts redaction at construction so there is no
  unredacted object to serialize; the red test asserts no prompt substring appears anywhere in holdout output.
- **A future agent "helpfully" seeds a holdout set** → the spec forbids a default location and a placeholder
  directory; the loader's refusal path is a tested requirement, so the absence is load-bearing, not an
  oversight someone can tidy up.
- **Eval runs get wired into CI for convenience and burn money** → made a tested requirement (gate config must
  contain no eval-run invocation) rather than a convention.

## Migration Plan

Additive: a new directory, no existing module changes behavior. Apply strictly after `synthetic-run-harness`
merges. The four Class-2 edits are applied by a human from `pending-class2.md` — before that the suite is
runnable but not gate-enforced, which is a strictly-additive intermediate state. Rollback is deleting `evals/`
and reverting the four config lines and the doc rows.

## Open Questions

- Threshold default for the overfitting alarm: a starting value is set here and recorded in every report;
  retuning is expected after the first attended holdout run.
- Whether the visible eval set should carry both seed phrasings per app (22 cases) or one, given per-case
  Chromium cost. Both are encoded; running a subset is a CLI concern.
- Which rubric criteria survive first contact with a real judge — the rubric is versioned precisely so the
  first attended run can revise it without invalidating stored reports.
