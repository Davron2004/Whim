# Corpus-eval operator guide

The corpus-eval harness (`evals/`, spec `openspec/specs/corpus-eval/spec.md`,
roadmap #12) is an **on-demand, human-run** CLI — it costs model spend and browser time, so it is
never part of `scripts/gate.sh` or CI. This is the operator's guide to running it. It assumes
`node evals/test/run.mjs` passes (the harness's own acceptance suite) — see that suite for the
harness's own contract; this document is about USING the CLI, not its internals.

**Run it with `npm run evals`.** The Class-2 wiring was applied attended on 2026-07-31
(`openspec/changes/archive/2026-07-31-eval-harness/pending-class2.md`, pruned 2026-10-09 and kept in git history at `8c6cb385`, records the exact diff):
`npm run evals -- <run|diff|compare> ...` drives the CLI, and `npm run evals:test` runs the
harness's own acceptance suite — which `scripts/gate.sh` now invokes as `corpus-eval` on every
fast-gate run. Invoking `node evals/cli.mjs <run|diff|compare> ...` directly still works and is
equivalent. Note the `--` in `npm run evals -- ...`: without it npm swallows the arguments.

## Pointing the runner at a set

The eval set is **always** supplied at run time — there is no built-in default and no config file
naming one:

```sh
node evals/cli.mjs run --eval-set <path> --source-dir <dir>
# or, equivalently:
WHIM_EVAL_SET=<path> node evals/cli.mjs run --source-dir <dir>
```

`--eval-set` wins when both are present. `<path>` is a directory containing a `manifest.json` (see
`evals/sets/visible/manifest.json` for the committed dev set's shape). Refusing when neither is
supplied is the correct behavior, not a rough edge — it is what keeps a holdout set from ever
being loaded by accident.

### Sourcing candidates

`run` needs exactly one of:

- `--source-dir <dir>` — fully offline. Reads `<dir>/<caseId>.ts` for every case in the set; no
  pipeline is constructed, no model is contacted. A case with no matching file is logged and
  excluded from the report (the rest of the run still proceeds).
- `--generate` — drives the harness server's stub generation pipeline
  (`server/src/pipeline.ts`'s `createStubPipeline`) once per case. This is a placeholder until
  roadmap #11 lands a real pipeline; a generation stream that completes with anything other than
  exactly one terminal event is logged as a **runner** error (a transport/harness bug), never
  read as a bad candidate.

A real run against real candidate source launches a headless Chromium session (`synthrun`) for
Tier A's runtime leg — this is where the "browser time" cost comes from, and why the harness's own
acceptance suite never does this.

### Reading the output

`run` prints a Markdown pass-rate summary to stdout and writes the full JSON report under
`evals/.reports/<setId>.json` by default (git-ignored — pass `--out <dir>` to write elsewhere).
The CLI refuses to write into any directory that already holds git-tracked content, so it can
never silently overwrite something committed. Exit code: `0` clean, `1` if any case failed
(including a sourcing error), `2` on a config problem (missing/unreadable eval set, bad
arguments).

## The attended visible → holdout → compare protocol

The harness's whole point is catching overfitting to the visible set — tuning prompts/SDK/checks
against cases the eval set exposes. The protocol:

1. Run the **visible** set (`evals/sets/visible/`, committed, safe to iterate against freely):
   ```sh
   node evals/cli.mjs run --eval-set evals/sets/visible --source-dir <dir> --out /tmp/visible-run
   ```
2. Run a **holdout** set. **This repo never records or infers where a holdout set lives** —
   that absence is load-bearing (decision #42, design D2): a holdout the harness could resolve on
   its own is not a holdout. The operator supplies the location themselves, out of band, the same
   way as any other `--eval-set`:
   ```sh
   node evals/cli.mjs run --eval-set <your-own-holdout-path> --source-dir <dir> --out /tmp/holdout-run
   ```
3. Compare the two reports:
   ```sh
   node evals/cli.mjs compare /tmp/visible-run/visible-dev-v1.json /tmp/holdout-run/<holdoutSetId>.json --threshold 0.1
   ```
   `compare` reports the per-tier (A, B, and combined A+B) pass-rate divergence
   (`visibleRate − holdoutRate`) and raises `overfitting_alarm` when the combined A+B divergence
   exceeds `--threshold` (default `0.1`, i.e. 10 percentage points). Exit code `0` clean, `1`
   alarm, `2` refused (the two reports have different schema versions, or their rubric versions
   disagree while Tier C is in play on either side — a divergence number computed across
   incompatible runs is worse than no number).
4. An alarm means: stop tuning against the visible set's specifics and generalize instead. It is
   a signal, not an automatic failure of anything — there is no gate wired to it.

## Reading a report diff

`diff` compares two reports of the **same** eval set (e.g. before/after a prompt or SDK change)
and names regressions down to the specific case and assertion:

```sh
node evals/cli.mjs diff /tmp/before.json /tmp/after.json
```

Only pass→fail transitions are named as regressions (fail→pass is out of scope — an improvement
is not a red flag). Tier-C score changes are listed separately, explicitly marked
non-deterministic (an LLM judge's score naturally drifts run to run), never folded into the
regression list. Exit code `0` when nothing regressed, `1` when a regression is named, `2` when a
report file is missing or unreadable.

## The model-bakeoff protocol

The flow benchmark measures the same clarify → rewrite → generate path the device uses. Run the
same eval set once for each candidate roster, keeping the prompts, set, SDK version and server
configuration fixed apart from the roster.

For each candidate:

1. Start the server with that candidate's roster, for example with the relevant `WHIM_*_MODEL`
   variables in its environment.
2. Run the benchmark and save both the JSON report and delivered TypeScript sources:

   ```sh
   node server/flowbench.mjs \
     --url http://127.0.0.1:8799 \
     --eval-set evals/sets/visible \
     --save-sources /tmp/flowbench-model-a \
     --json /tmp/flowbench-model-a.json
   ```

3. Score exactly those delivered sources with the corpus-eval runner:

   ```sh
   node evals/cli.mjs run \
     --eval-set evals/sets/visible \
     --source-dir /tmp/flowbench-model-a
   ```

Repeat the two commands for every roster, then compare the benchmark timings and the scorer's
per-case Tier-A/B results. `run --generate` remains the corpus-eval harness's stub-only path; it
does not replace the flow benchmark for a roster bakeoff. Record the chosen roster in the
append-only decision log rather than treating temporary reports as the decision record.

## Measuring a clarify rate

One flow benchmark run is one sample of a stochastic clarify call. To measure how often clarify
answers `limit` for a prompt, run each case several times and stop after clarify, so no run pays
for a build:

```sh
node server/flowbench.mjs --url <server> --eval-set <set> --repeat 10 --stop-after clarify --json <report.json>
```

Each run uses a fresh device id. The Markdown and `summary.tallies` in the JSON give, per case,
how many runs clarify answered with a `limit`, with questions, with no question, or with a failure.
`--save-sources` is refused with `--repeat` above 1 and with `--stop-after clarify`.

## Recorded result: beta-1 flow benchmark (2026-09-25/26)

Production `https://api.whim.anycognition.ca`, parallel 2, no retries. Before = image `0fb65d51`
(pre-beta-1 server); after = staging tip `78e59059`; rate runs after fix-6. Sets: `evals/sets/visible`
(22 cases) and a 4-case impossible-prompt set (2 live-weather, 2 ping-a-roommate). Phase times are
medians (max in brackets), in ms. The raw JSON reports are in `beta-1/flowbench.tar.zst`
(`openspec/changes/beta-1/EVIDENCE.md`).

| Run | Results / failures / limits | Clarify | Rewrite | Generate |
|---|---|---|---|---|
| Visible, before | 20 / 2 / – | 1320 (10385) | 2335 (13241) | 51373 (142830) |
| Visible, after | 21 / 1 / 0 | 1840 (10292) | 2277 (4964) | 52981 (225318) |
| Impossible, before | 3 / 1 / – | 2397 (2976) | 3194 (34619) | 94474 (148765) |
| Impossible, after | 0 / 0 / 4 | 2114 (2409) | – | – |
| Impossible, rate (×10 each, stop after clarify) | 40 of 40 runs answered `limit` | 585 (11845) | – | – |
| Visible, rate (×3 each, stop after clarify) | 66 runs: 0 `limit`, 56 with questions, 8 empty, 2 failures | 1057 (14886) | – | – |

Before failures: `habit-tracker-p1` repair exhausted; `tip-splitter-p2` clarify 503 `policy_unavailable`
(#119). Before, no clarify could answer "can't build", so the impossible prompts built fake apps
(a city-name "forecast", a reminder log pretending to send). After failure: `recipe-box-p1` repair
exhausted. One clarify sample per prompt overstated the limit rate (the app saw `limit` on ~27% of
weather prompts), hence the repeated-sample rate runs above; see "Measuring a clarify rate".
