## Why

Every prompt tweak, SDK change, and model swap between here and v1 silently changes generation quality, and
today nothing measures it: the corpus (`docs/app-corpus.md`, 11 Tier-0 apps) and its 22 visible prompt seeds
(`docs/sdk-gap.md` §6) exist only as prose, and there is no way to say whether a change made things better or
worse. Decision #25 still leaves the v1 model choice OPEN, and #42 makes that choice a *bakeoff decided on
corpus results* — which cannot happen without a runner. Worse, spec.md §16.4's reward-hacking trap is live
right now: every eval prompt an implementing agent can read, it can overfit to. The user already holds a
private holdout set (#42); what is missing is a runner they can point at it.

## What Changes

- **New `evals/` top-level directory** (plain dir, `checks/`-style — not an npm workspace, so `guard:metro`
  and the closed `server/` dependency budget are untouched): an on-demand corpus eval runner, its Node
  acceptance suite, the committed *visible* eval set, and the Tier-C rubric.
- **Runtime-supplied eval sets.** The runner resolves its eval set from `--eval-set <path>` or
  `WHIM_EVAL_SET`, with the flag winning. There is **no repo-embedded default and no network fetch**: with no
  location supplied the runner refuses and exits nonzero. The holdout set is never created, referenced by
  path, or described here — the user supplies it attended, at run time.
- **Holdout redaction.** A set declaring `visibility: holdout` produces reports carrying case ids and prompt
  SHA-256 digests only — never prompt or expectation text — so a holdout report is safe to keep, diff, and
  share alongside a visible one.
- **Tier A — deterministic gate.** `runStaticChecks` (change #9) plus the `synthetic-run` harness (#10)
  boot/containment verdict, normalized behind a single adapter into a `RunObservation`. Binary, deterministic,
  and the only tier that short-circuits: a Tier-A failure records Tiers B and C as `skipped: tier_a_failed`.
- **Tier B — behavioral specs.** English-first: every spec carries a human-readable statement, encoded
  alongside it as a **declarative assertion over the closed `ASSERTION_KINDS` vocabulary**. Assertions are
  data, never executable code — an eval set is an untrusted user-supplied directory and the runner must never
  execute anything it contains.
- **Tier C — LLM judge.** A versioned English rubric (originated here; none exists in the repo) scored
  through an injected `Judge` interface. Ships with a scripted judge and a recorded-transcript replay judge;
  the live OpenRouter-backed judge is constructible only under an explicit opt-in flag plus a credential env
  var, so **the gate can never make a live API call**. Tier C never gates a case verdict.
- **Diffable run reports.** Canonical JSON with stable ordering and timings segregated out of the diffable
  body, plus a Markdown summary; `diff` names per-case per-tier regressions; `compare` measures
  visible-vs-holdout divergence and raises an `overfitting_alarm` past a threshold (§16.4's signal, made
  mechanical).
- **A stable corpus slug scheme.** `evals/corpus.ts` becomes the registry of the 11 Tier-0 slugs and
  `docs/app-corpus.md` gains a matching slug column, with a drift check binding the two.
- **Offline candidate sourcing.** `--source-dir` maps case id → pre-generated source with no generation at
  all; `--generate` drives an injected `Pipeline` (today `createStubPipeline`, after #11 the real loop).
- **Not wired into CI.** Eval runs cost money and Chromium time; the gate runs only the runner's own suite.

## Capabilities

### New Capabilities

- `corpus-eval`: the on-demand three-tier corpus eval runner — runtime-supplied eval sets with holdout
  redaction, Tier-A deterministic gating, Tier-B declarative behavioral assertions over a normalized run
  observation, Tier-C rubric judging through an injected judge, and canonical diffable run reports with a
  visible-vs-holdout divergence alarm.

### Modified Capabilities

<!-- None. `static-checks`, `harness-diagnostics`, `synthetic-run`, `generation-contract`, and
     `generation-server` are all consumed unchanged: this change adds no diagnostic kinds, edits no
     `checks/` or `contract/` source, and adds no server route. -->

None.

## Impact

- **New:** `evals/` (contract, corpus registry, eval-set loader, redaction, tier evaluators, synthetic-run
  adapter, judge, rubric, report/diff/compare, CLI, Node acceptance suite, committed visible set).
- **Consumed, unchanged:** `checks/index.ts` + `checks/contract.ts`; the `synthetic-run` harness entry point
  (behind `evals/adapters/synthetic-run.ts`, the only module allowed to import it); `server/src/pipeline.ts`'s
  `Pipeline`/`createStubPipeline`; `server/src/openrouter.ts`'s `OpenRouterClient`; `@whim/contract`'s
  `GenerationEvent`/`Usage` schemas.
- **Docs:** `docs/capabilities.md` (one row), `docs/app-corpus.md` (slug column), `docs/v1-roadmap.md` (#12
  status + as-built contract notes), new `docs/evals.md` operator guide covering the attended holdout run and
  the model-bakeoff protocol.
- **Class-2 (human-applied, recorded only):** one `package.json` script, one `tsconfig.json` `exclude` entry,
  one `scripts/gate.sh` `check` line, one `knip.json` workspace extension. Recorded as an exact diff in
  `pending-class2.md`; no chain edits them.
- **Ordering:** must be applied after `synthetic-run-harness` merges. This change binds to that harness's
  report *shape* through one adapter module, never to its field names spread across the codebase.
- **Explicitly out of scope:** CI wiring of eval runs; corpus growth beyond Tier 0; creating, locating, or
  describing holdout content; making the actual model-bakeoff decision (that is an attended run plus a
  decision-log entry, and it needs live API access).
