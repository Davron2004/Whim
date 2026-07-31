## 1. Contract, corpus registry, and eval-set loading

- [x] 1.1 Author `evals/contract.ts` — dependency-free types and closed tables only, no I/O: `EvalCase`,
  `EvalSetManifest`, `EvalSetVisibility` (`visible | holdout`), the closed `ASSERTION_KINDS` table,
  `TierAResult` / `TierBResult` / `TierCResult` with their `skipped` reasons (`tier_a_failed`,
  `no_judge_configured`), `RunObservation`, `JudgeVerdict`, `EvalRunReport`, and `EVAL_REPORT_SCHEMA_VERSION`.
  Import `Diagnostic`/`DiagnosticKind` type-only from `checks/contract.ts`; do **not** edit `checks/contract.ts`
  and do **not** mint any new diagnostic kind.
- [x] 1.2 Author the Node acceptance suite scaffold: `evals/test/run.mjs` (esbuild-bundle-then-run, following
  `checks/test/run.mjs`, with `tsconfigRaw: '{}'`) plus `evals/test/harness.ts` (tally-style `check`/`eq`/
  `section`/`report`, following `server/test/harness.ts`). The runner **auto-discovers** `evals/test/*.test.ts`
  — no hand-maintained registry file, so parallel chains never collide (design D14). Must exit non-zero on any
  failure and run with no eval set present.
- [x] 1.3 Author `evals/corpus.ts` — the stable slug registry for the 11 Tier-0 apps from `docs/app-corpus.md`;
  add a matching slug column to the Tier-0 rows of `docs/app-corpus.md`; add a drift check to the suite that
  parses that column and fails naming any slug present on only one side (design D11).
- [x] 1.4 Implement `evals/eval-set.ts`: resolve the set location from `--eval-set` then `WHIM_EVAL_SET` then
  **refuse**; parse and validate the manifest and cases; reject unknown app slugs, missing English statements,
  unknown assertion kinds, and any assertion expressed as a code string or module reference. No repo-embedded
  default location, no placeholder holdout directory, no network access (design D2, D5).
- [x] 1.5 Implement `evals/redact.ts` and wire it as the report-construction gate: for a `holdout` set every
  emitted case carries `caseId` + `promptSha256` only, never prompt text, expectation prose, or candidate
  source (design D3). Red test: run a synthetic holdout set and assert no prompt or expectation substring
  appears anywhere in the emitted report, summary, or console output.
- [x] 1.6 Commit the visible dev eval set under `evals/sets/visible/` encoding the 22 seed phrasings from
  `docs/sdk-gap.md` §6, each case keyed by corpus slug + phrasing index, `visibility: visible`. Tier-B specs
  are added later (task 3.4); this task lands prompts + ids + manifest only.

## 2. Tier A — the deterministic gate

- [x] 2.1 Implement `evals/tiers/tier-a.ts` static leg: call `runStaticChecks(source)`, fail Tier A on any
  `error`-severity diagnostic, and carry each diagnostic's kind, message, and fix hint into `TierAResult`.
- [x] 2.2 Implement `evals/adapters/synthetic-run.ts` — the **only** module in `evals/` allowed to import the
  synthetic-run harness. Normalize its report into `RunObservation` (diagnostics, declared vs reached screens,
  syscall/cue invocation trace, containment verdict + its vantage, applied budgets; timings kept separate).
  Read the merged harness's `handoff/` contract for its real signature, not its proposal text (design D6).
- [x] 2.3 Implement the Tier-A runtime leg over `RunObservation`: boot/mount failure fails Tier A; a
  containment verdict is accepted only from the nonce-authenticated vantage, and an observation whose verdict
  did not come from that vantage is recorded as an untrusted-verdict failure, never a pass.
- [x] 2.4 Implement the gating rule in the case evaluator: Tier A fail ⇒ Tier B and Tier C recorded
  `skipped: tier_a_failed` and not evaluated; case verdict is `pass` iff Tier A passed and every required
  Tier-B assertion passed; Tier C never contributes to the verdict (design D4).
- [x] 2.5 Tests in `evals/test/tier-a.test.ts`: an honest fixture passing both legs; a fixture with an
  `error` diagnostic failing the static leg; a synthesized observation with an un-authenticated verdict failing
  as untrusted; determinism (same source + same observation twice ⇒ equal results); one adapter test pinned to
  a recorded synthetic-run report fixture (no Chromium launch in the suite).

## 3. Tier B — behavioral specs

- [ ] 3.1 Enforce English-first at load: a Tier-B spec with a missing or empty English statement fails the
  whole eval set to load, naming the offending case id, and no case is evaluated.
- [ ] 3.2 Implement `evals/assertions.ts` — the closed `ASSERTION_KINDS` evaluator over `RunObservation`:
  screen reachability of declared screens, presence/absence of a recorded syscall or cue, presence/absence of a
  diagnostic kind, render-without-error, storage round-trip. Pure data in, result out; never evaluate, compile,
  or import anything supplied by an eval set (design D5).
- [ ] 3.3 Implement `evals/tiers/tier-b.ts`: each assertion result records pass/fail, the English statement
  verbatim, and the **concrete observed value** that contradicted it — never a bare boolean. Distinguish
  required from advisory assertions, since only required ones gate the verdict.
- [ ] 3.4 Encode Tier-B specs for the visible set's corpus apps into `evals/sets/visible/`, English statement
  first and encoded assertion beside it, using only `ASSERTION_KINDS`.
- [ ] 3.5 Tests in `evals/test/tier-b.test.ts`: a passing **and** a failing fixture for every assertion kind
  (non-vacuity — an assertion kind with no red case is a bug); missing-English load error; unknown-kind load
  error naming the accepted set; code-as-assertion refused without being imported; failure output carries the
  English statement and the observed value.

## 4. Tier C — the rubric judge

- [x] 4.1 Author `evals/rubric/v1.md` — the English rubric: a closed list of scored criteria, each with what a
  low and a high score mean, plus the human-eyeball protocol; carry an explicit version identifier. Add
  `evals/rubric/index.ts` exposing the version, the criteria table, and the content hash of the scored section.
- [x] 4.2 Define the `Judge` interface (`score(input) => Promise<JudgeVerdict>`) and implement the two offline
  judges: `createScriptedJudge(map)` and `createReplayJudge(dir)` replaying recorded transcripts keyed by case
  id + rubric version, with fixtures under `evals/test/fixtures/judge/`.
- [x] 4.3 Implement the live judge adapter over `server/src/openrouter.ts`'s `OpenRouterClient`: construction
  **throws** unless both the explicit opt-in argument and the credential environment variable are present, and
  never silently substitutes a fake. With no judge configured at all, Tier C is `skipped:
  no_judge_configured`.
- [x] 4.4 Implement `evals/tiers/tier-c.ts` with verdict validation owned by the tier, not the judge: a verdict
  missing a rubric criterion, missing a rationale, or scoring outside range is Tier C `error` naming the
  defect, never a passing score. Every result records `rubricVersion` + judge identity.
- [x] 4.5 Tests in `evals/test/tier-c.test.ts`: scripted and replay judges score offline with no network; the
  live judge refuses construction without opt-in and without credential; each malformed-verdict shape becomes
  `error`; the rubric content hash drift test fails when the rubric's scored content changes without a version
  bump (design D8).

## 5. Reports, diff, and the divergence alarm

- [ ] 5.1 Implement `evals/report/serialize.ts`: canonical JSON — cases sorted by id, assertions in declared
  order, stable key order, fixed indent — with measured durations and wall-clock timestamps confined to a
  `timings` section excluded from the diffable body (design D9). Record schema version, resolved eval-set id
  and visibility, runner version, candidate-producer label, and rubric version when Tier C ran.
- [ ] 5.2 Implement `evals/report/summary.ts`: the human-readable Markdown summary, per-tier pass rates and a
  failure list, inheriting redaction from the constructed report.
- [ ] 5.3 Implement `evals/report/diff.ts`: compare two reports and name per-case, per-tier regressions down to
  the specific assertion; show Tier-C score deltas marked non-deterministic rather than as regressions.
- [ ] 5.4 Implement `evals/report/compare.ts`: per-tier pass-rate divergence between a visible and a holdout
  report, `overfitting_alarm` + non-zero exit past the configured threshold (recorded in the output), and a
  refusal — naming the mismatch — when schema versions differ or rubric versions differ while Tier C is
  compared (design D10).
- [ ] 5.5 Tests in `evals/test/report.test.ts`: byte-identical diffable bodies across two identical runs while
  timings differ; diff naming a Tier-B regression by case and assertion; alarm firing beyond and staying quiet
  within threshold; mismatched-version refusal; redaction preserved through both `diff` and `compare`.

## 6. CLI, candidate sourcing, and docs

- [ ] 6.1 Implement `evals/cli.mjs` with `run` / `diff` / `compare` subcommands: argument and environment
  parsing, the eval-set resolution order, `--out` defaulting to the git-ignored report directory, and an exit
  code contract (non-zero on missing eval set, on unreadable set, on any case failure, on an overfitting alarm).
- [ ] 6.2 Implement `evals/producer.ts`: `--source-dir` maps case id → source file with no pipeline constructed
  and no model contacted, recording a per-case `error` for a missing file while other cases still run;
  `--generate` drives an injected `Pipeline`, treating a completed stream with other than exactly one terminal
  `GenerationEvent` as a **runner** error, not a candidate failure (design D12).
- [ ] 6.3 Add the report output directory to `.gitignore` (not a protected file) and make it the CLI's default
  `--out`.
- [ ] 6.4 Docs: add the `corpus-eval` row to `docs/capabilities.md`; update `docs/v1-roadmap.md` #12 with
  status and as-built contract notes; write `docs/evals.md` — the operator guide covering how to point the
  runner at a set, the attended visible→holdout→compare protocol, how to read a report diff, and the
  model-bakeoff protocol (run the same set per candidate model, compare reports, record the decision in
  `docs/decisions.md`). Never record or infer a holdout location.
- [ ] 6.5 Tests in `evals/test/cli.test.ts`: the refusal path with neither flag nor environment variable set;
  flag-beats-environment resolution; the exit-code matrix; the fully offline `--source-dir` path; the
  `createStubPipeline` generation path; the two-terminal-event runner error; and the gate-configuration check
  asserting no eval-run invocation is present in the gate.

## 7. Class-2 bootstrap record (HUMAN-BOOTSTRAP — record only, never apply)

- [ ] 7.1 Write `openspec/changes/eval-harness/pending-class2.md` recording the **exact** diff a human must
  apply, and apply none of it: (a) `package.json` — add `"evals:test": "node evals/test/run.mjs"` and
  `"evals": "node evals/cli.mjs"`; (b) `tsconfig.json` — add `"evals/test"` to `exclude` with a comment
  matching the existing Node-runner entries; (c) `scripts/gate.sh` — add `check "corpus-eval" npm run -s
  evals:test` alongside the other suite lines; (d) `knip.json` — extend the `"."` workspace with entry
  `evals/test/**`, `evals/cli.mjs` and project `evals/**/*.ts`. Note in the file that until these land the
  suite is run directly as `node evals/test/run.mjs`, so no chain is blocked on this task.
