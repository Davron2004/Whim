# Context chains: eval-harness

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  DAG:  A ──┬── B ── C ──┬── E ── F
            └── D ───────┘
        G (HUMAN-BOOTSTRAP, record-only) is dependency-free and may run any time.
  B and D are dependency-free of each other and touch disjoint files, so the dispatcher may run
  them in parallel. Every other edge is a declared contract read or an explicit `after:`.

  PRE-CONDITION FOR THE WHOLE CHANGE: `synthetic-run-harness` must be merged onto the run's
  staging tip before chain-B is dispatched. Chain-B reads that change's merged `handoff/`
  contract for the real harness signature — NOT its proposal/design text, whose directory name
  and report field names its own design.md leaves to its implementer (research.md §Risks).

  NO CHAIN TOUCHES A PROTECTED FILE. `package.json`, `tsconfig.json`, `scripts/gate.sh`, and
  `knip.json` are recorded-only in chain-G. Implementer chains run their suite directly with
  `node evals/test/run.mjs` (the `evals:test` script does not exist until a human applies G),
  in addition to `./scripts/gate.sh`.
-->

## chain-A: contract-loader-corpus (1.1–1.6)

- tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
- rationale: the dependency-free type/table module, the Node suite scaffold every later chain adds
  test files to, the corpus slug registry, the eval-set loader, redaction, and the committed visible
  set — all one vocabulary (`evals/contract.ts` + `evals/eval-set.ts`), and the seam every other
  chain consumes. Nothing downstream is authorable until the loader's shapes exist.
- reads: specs/corpus-eval/spec.md §"The eval set is supplied at run time and never embedded",
  §"Holdout content never enters the repository or a report", §"Tier-B specs are English-first and
  encoded as inert data" (the loader-side rejections only), §"Corpus apps have stable slugs bound to
  the corpus document", §"Eval runs are on demand and never part of the automated gate" (the
  suite-needs-no-eval-set scenario); design.md D1, D2, D3, D5, D11, D14; handoff: none
- writes-contract: handoff/eval-contract.md
- files: `evals/contract.ts`, `evals/corpus.ts`, `evals/eval-set.ts`, `evals/redact.ts`,
  `evals/test/run.mjs`, `evals/test/harness.ts`, `evals/test/loader.test.ts`, `evals/sets/visible/**`,
  `docs/app-corpus.md` (slug column only)
- note: `handoff/eval-contract.md` MUST pin, verbatim: the `ASSERTION_KINDS` table, the
  `RunObservation` shape, the three tier-result shapes with their `skipped` reasons, `JudgeVerdict`,
  `EvalRunReport` + `EVAL_REPORT_SCHEMA_VERSION`, the redaction entry point, and **the suite's
  file-auto-discovery convention** (`evals/test/*.test.ts`, no registry file — D14; without this in
  the contract, parallel chains B and D would each invent a registry and collide). Import
  `Diagnostic`/`DiagnosticKind` **type-only** from `checks/contract.ts`; do NOT edit
  `checks/contract.ts` (synthetic-run-harness is editing it — an edit here is a merge conflict) and
  do NOT mint a new diagnostic kind. Do NOT create `evals/sets/holdout/` or any placeholder for it,
  and do NOT record a holdout location anywhere: the absence is load-bearing (design D2).

## chain-B: tier-a-and-run-adapter (2.1–2.5)

- tasks: 2.1, 2.2, 2.3, 2.4, 2.5
- rationale: the static leg, the single synthetic-run adapter, the runtime leg, and the tier-gating
  rule all sit on one data structure (`RunObservation`) and one question ("did this candidate
  survive?"). Splitting the adapter from its consumers would force a half-built normalization across
  a handoff.
- reads: specs/corpus-eval/spec.md §"Tier A is deterministic and trusts only authenticated vantages",
  §"Three tiers with declared gating semantics"; design.md D4, D6; handoff: handoff/eval-contract.md
- writes-contract: handoff/run-observation.md
- files: `evals/tiers/tier-a.ts`, `evals/tiers/case.ts`, `evals/adapters/synthetic-run.ts`,
  `evals/test/tier-a.test.ts`, `evals/test/fixtures/candidates/**`,
  `evals/test/fixtures/synthetic-run-report.json`
- note: `evals/adapters/synthetic-run.ts` is the ONLY module in `evals/` permitted to import the
  synthetic-run harness — the whole point is that its field names cannot spread (D6). Read the
  MERGED harness's `handoff/*.md` for its real entry signature and report field names; its proposal
  text is planning-stage and explicitly leaves them open. The suite must NOT launch Chromium: unit-
  test the tiers against synthesized `RunObservation` values and pin the adapter with one recorded
  report fixture. Containment verdicts are trusted only from the nonce-authenticated vantage (F4) —
  a bundle self-report is an untrusted-verdict FAILURE, never a pass.
  `handoff/run-observation.md` must pin the normalized field names and the vantage flag chain-C
  asserts over.

## chain-C: tier-b-assertions (3.1–3.5)

- tasks: 3.1, 3.2, 3.3, 3.4, 3.5
- rationale: the English-first load rule, the closed assertion evaluator, the tier, and the encoded
  corpus specs are one vocabulary over one input (`RunObservation`). Sequenced after B because every
  assertion reads the normalized observation B defines.
- reads: specs/corpus-eval/spec.md §"Tier-B specs are English-first and encoded as inert data",
  §"Tier-B assertions evaluate against the normalized run observation"; design.md D5; handoff:
  handoff/eval-contract.md, handoff/run-observation.md
- writes-contract: none
- after: chain-B
- files: `evals/assertions.ts`, `evals/tiers/tier-b.ts`, `evals/test/tier-b.test.ts`,
  `evals/sets/visible/**` (Tier-B specs added to the cases chain-A landed)
- note: assertions are INERT DATA. Never `eval`, `import()`, `require`, compile, or otherwise execute
  anything an eval set supplies — the holdout set is a user-authored directory outside the repo and
  running it must never mean running its code (D5). An unknown assertion kind is a LOAD error naming
  the closed accepted set, not a silently-skipped assertion. Non-vacuity: every kind in
  `ASSERTION_KINDS` needs both a green and a red fixture; a kind with no red case is a bug in this
  chain, not a gap to leave. Failure output carries the English statement verbatim plus the concrete
  observed value — never a bare boolean.

## chain-D: tier-c-judge-and-rubric (4.1–4.5)

- tasks: 4.1, 4.2, 4.3, 4.4, 4.5
- rationale: the rubric document, the judge interface and its three implementations, verdict
  validation, and their tests are one self-contained subsystem reading nothing from B or C. Files are
  disjoint from both, so the dispatcher runs this in parallel with chain-B.
- reads: specs/corpus-eval/spec.md §"The Tier-C judge is injected and the gate never calls a live
  model", §"The rubric is versioned and recorded with every judgement", and §"Three tiers with
  declared gating semantics" (the Tier-C-never-gates scenario only); design.md D7, D8; handoff:
  handoff/eval-contract.md
- writes-contract: handoff/judge.md
- files: `evals/rubric/v1.md`, `evals/rubric/index.ts`, `evals/judge/*.ts`,
  `evals/tiers/tier-c.ts`, `evals/test/tier-c.test.ts`, `evals/test/fixtures/judge/**`
- note: parallel with chain-B — do NOT touch `evals/tiers/tier-a.ts`, `evals/tiers/case.ts`,
  `evals/assertions.ts`, `evals/adapters/**`, or `evals/sets/**`. No rubric text exists anywhere in
  the repo (research.md §Judge rubric material): originate it, do not hunt for a draft. The suite must
  make NO network request — only the scripted and replay judges are ever constructed there. The live
  judge THROWS on construction without both the opt-in argument and the credential env var; a silent
  fallback to a fake would make a green run meaningless. Verdict validation belongs to the tier, not
  the judge: missing criterion / missing rationale / out-of-range score ⇒ Tier C `error`, never a
  pass. `handoff/judge.md` pins the `Judge` interface, `JudgeVerdict` validation rules, the rubric
  version + criteria list, and the `no_judge_configured` skip reason chain-E serializes.

## chain-E: report-diff-compare (5.1–5.5)

- tasks: 5.1, 5.2, 5.3, 5.4, 5.5
- rationale: canonical serialization, the Markdown summary, `diff`, and `compare` all operate on the
  finished `EvalRunReport` and share one ordering/redaction discipline. Sequenced after C and D so the
  determinism and redaction tests run over real tier results rather than hand-built stubs.
- reads: specs/corpus-eval/spec.md §"Run reports are canonical and diffable", §"Visible-versus-holdout
  divergence raises an overfitting alarm", §"Holdout content never enters the repository or a report";
  design.md D3, D9, D10; handoff: handoff/eval-contract.md, handoff/run-observation.md,
  handoff/judge.md
- writes-contract: handoff/report.md
- after: chain-C, chain-D
- files: `evals/report/serialize.ts`, `evals/report/summary.ts`, `evals/report/diff.ts`,
  `evals/report/compare.ts`, `evals/test/report.test.ts`
- note: redaction is applied where the report is CONSTRUCTED, not where it is printed (D3) — so
  `diff`, `compare`, the Markdown summary, and console output all inherit it and no unredacted object
  exists for a future output path to leak. Durations and wall-clock timestamps live in a `timings`
  section OUTSIDE the diffable body; the determinism test asserts byte-identical bodies across two
  runs while timings differ. Tier-C score deltas are shown as deltas marked non-deterministic, never
  as regressions. `compare` REFUSES mismatched schema versions, and mismatched rubric versions when
  Tier C is compared — a divergence number across incompatible runs is worse than none.
  `handoff/report.md` pins the canonical body's field order and the exit-code semantics chain-F wires.

## chain-F: cli-sourcing-docs (6.1–6.5)

- tasks: 6.1, 6.2, 6.3, 6.4, 6.5
- rationale: the CLI composes every prior chain, candidate sourcing is its only remaining input seam,
  and the docs describe the assembled whole. Runs last because nothing else can be documented or
  exit-coded until it exists.
- reads: specs/corpus-eval/spec.md §"The eval set is supplied at run time and never embedded",
  §"Candidate sourcing is offline-capable and consumes exactly one terminal event", §"Eval runs are on
  demand and never part of the automated gate"; design.md D12, D13; handoff: handoff/eval-contract.md,
  handoff/report.md, handoff/judge.md
- writes-contract: none
- after: chain-E
- files: `evals/cli.mjs`, `evals/producer.ts`, `evals/test/cli.test.ts`, `.gitignore`,
  `docs/capabilities.md`, `docs/v1-roadmap.md`, `docs/evals.md`
- note: `.gitignore`, `docs/**` and `evals/**` are all dispatchable — the CLI's npm script is NOT, and
  is chain-G's to record only. Resolution order is `--eval-set` > `WHIM_EVAL_SET` > REFUSE: there is
  no built-in default, no config file naming a set, and `docs/evals.md` must describe the attended
  holdout protocol WITHOUT recording or inferring where the holdout lives (decision #42, design D2).
  A stream carrying other than exactly one terminal `GenerationEvent` is a RUNNER error, not a
  candidate failure — otherwise a transport bug reads as a bad model. The gate-configuration test
  asserts `scripts/gate.sh` contains the suite entry and NO eval-run invocation; it only READS that
  file (reading a protected file is fine, editing it is not).

## chain-G: class2-bootstrap-record (7.1) — HUMAN-BOOTSTRAP

- tasks: 7.1
- rationale: the four protected config edits a new top-level Node suite needs are isolated into one
  record-only task so that no implementer chain touches a protected file.
- reads: design.md D13; handoff: none
- writes-contract: none
- files: `openspec/changes/eval-harness/pending-class2.md` ONLY
- note: **RECORD ONLY — APPLY NOTHING.** `.claude/hooks/protect-harness.sh` hard-blocks subagents on
  `package.json`, `tsconfig*.json`, `scripts/gate*.sh`, and `knip.json`; this chain writes the exact
  diff into `pending-class2.md` and stops. The four edits a human applies: (a) `package.json` scripts
  `"evals:test": "node evals/test/run.mjs"` and `"evals": "node evals/cli.mjs"`; (b) `tsconfig.json`
  `exclude` += `"evals/test"` with a comment matching the existing Node-runner entries (the runner
  uses `process`/dynamic import and is validated by running, not by `tsc`); (c) `scripts/gate.sh` +=
  `check "corpus-eval" npm run -s evals:test` (suites are enumerated explicitly — without the line the
  DONE gate never runs the suite; `gate-full.sh` inherits); (d) `knip.json` `"."` workspace entry +=
  `evals/test/**` and `evals/cli.mjs`, project += `evals/**/*.ts` (knip's workspace map is explicit
  and silently skips un-listed dirs). Nothing sequences on this chain: until it is applied every other
  chain runs its suite as `node evals/test/run.mjs` in addition to `./scripts/gate.sh`.
