# Research digest: what a three-tier corpus eval runner must attach to, and what already exists

<!-- Composed from THREE `researcher` subagent digests dispatched in parallel by the proposer
     (main thread never crawled the repo): (R1) static-checks + generation contract/server terrain,
     (R2) the ACTIVE `synthetic-run-harness` change, (R3) corpus/eval docs + decisions tail.
     Merged and de-duplicated to fit the 120-line cap; nothing was invented in the merge. -->

## Relevant files

- `checks/index.ts` — `runStaticChecks`, the Tier-A static leg (pure, execution-free, deterministic)
- `checks/contract.ts` — `CheckReport` / `Diagnostic` / closed `DIAGNOSTIC_KINDS`; dependency-free
- `checks/test/run.mjs`, `checks/test/harness.ts` — esbuild-bundle-then-run Node suite + greenBy harness
- `server/test/run.mjs`, `server/test/harness.ts` — the *other* Node suite idiom (plain `check`/`eq` tally)
- `server/src/pipeline.ts` — `Pipeline` interface + `createStubPipeline(delayMs)`, the only offline generation seam that exists
- `server/src/app.ts` — `createApp({ pipeline, usageStore, keepaliveMs })`; pipeline is a constructor arg, so HTTP can be bypassed
- `server/src/openrouter.ts` — `OpenRouterClient`, `OpenRouterMessage/Options/StreamResult`, typed error classes; unmounted
- `contract/src/index.ts` — `@whim/contract`: `GenerateRequest`, `GenerationEvent`, `WireAppRecord`, wire `Diagnostic`, `Usage`
- `server/guard-metro.mjs` — CI tripwire proving new workspaces don't change Metro's RN resolution
- `docs/app-corpus.md` — 19-row corpus table, 11 of them Tier 0 (the v1 corpus)
- `docs/sdk-gap.md` §6 — the 22 visible eval prompt seeds; §7 — the holdout protocol
- `docs/decisions.md` #25, #42, #44–#47, #52 — model choice, roadmap lock, holdout custody, SDK-surface closure
- `openspec/changes/synthetic-run-harness/{proposal,design,specs/synthetic-run/spec}.md` — the ACTIVE run harness
- `tsconfig.json`, `knip.json`, `scripts/gate.sh`, `package.json` — the four Class-2 config surfaces a new top-level suite touches

## Current behavior

`checks/` is a plain top-level directory, deliberately **not** an npm workspace, kept dependency-light so any
consumer can import it as raw TS. Its entry is `runStaticChecks(source, opts?) -> CheckReport`, where
`CheckReport = { ok, diagnostics, manifest? }` and `ok` is `diagnostics.length === 0` at any severity. The
checks-side `Diagnostic` is stricter than the wire one: `kind` is a closed union, `line` and `hint` are
mandatory. `DiagnosticKind` is re-exported type-only into `@whim/contract`; the wire `kind` stays an open
string. Every `/v1/*` route is gated by the `x-whim-device` header, and a stream run to completion carries
exactly one terminal `GenerationEvent` (`result` xor `failure`, always last) — an aborted stream legitimately
ends with none, which is a stream-level invariant not expressible in the per-event zod schema.

`createStubPipeline` is a fully offline canned pipeline (plan → generate token deltas → check → run → usage →
`result`, or a `failure` terminal when the prompt contains the literal `[[fail]]`), with an injectable delay.
It is the repo's only existing "fake model."

Two Node acceptance-suite idioms coexist and are **not** unified: `checks/test` (phased greenBy machinery,
chain-gated `.phase` file, `assertHasKind`/`kindsOf` helpers) and `server/test` (plain tally harness, plus a
blocking `tsc --noEmit` pre-step over both workspaces). Both esbuild-bundle then run under Node. Each such
suite costs four Class-2 config edits: a `package.json` script, a `tsconfig.json` `exclude` entry (Node
runners use `process`/dynamic import and are validated by running, not by `tsc`), a `scripts/gate.sh` `check`
line (suites are enumerated explicitly — without it the harness DONE gate never runs the suite), and a
`knip.json` workspace `entry`/`project` extension (knip's workspace map is explicit and silently skips
un-listed dirs).

Corpus identity today is **the prose app name string**, matched by eye across `docs/app-corpus.md`'s "App"
column, `docs/sdk-gap.md` §3's per-app table, and §6's numbered seed list. There is no slug, id column, or
directory-based key anywhere. §6 is a flat markdown numbered list 1–11, each line carrying the italicized
short name and exactly two quoted casual-voice phrasings separated by `·` — 22 visible seeds, prose-only,
not machine-parseable today. §7 states the holdout set (fresh phrasings + novel Tier-0 apps, with English
expectations for scoring) exists but its location is deliberately unrecorded in-repo.

## Constraints and invariants

- **Decision #42** (roadmap lock): held-out eval prompts live with the user, outside the agent-readable
  tree, never committed. Model strategy refined over #25 — tune against a strong coding model first,
  DeepSeek becomes a *bakeoff candidate*, model access via OpenRouter; the rewrite model is picked in the
  same bakeoff. Synthetic runs happen server-side in headless Chromium reusing the invariants machinery;
  on-device stays the acceptance tier, never the per-generation smoke test.
- **Decision #25** leaves the v1 model choice explicitly OPEN pending eval-corpus results.
- **spec.md §16.3** defines the tiers: A = deterministic gate (the static-check loop doubling as a hard
  gate), B = behavioral, English-first then encoded, C = subjective quality via LLM-judge against an English
  rubric plus human eyeball. **§16.4** is the reward-hacking section: any test the implementing agent can
  see, it can satisfy without solving the real problem; the two defenses are non-implementer-authored
  invariants and a held-out prompt portion whose divergence from the visible set is the overfitting signal.
  **§18** contributes "diffable run reports, re-run on every prompt/SDK change." spec.md's §18 numbers
  (20 apps, 20–50 prompts) are **stale** — superseded by the real 11-app / 22-seed artifacts.
- Nothing in the decision log supersedes the three-tier structure or the holdout protocol; #42 only refines
  methodology around them. #44–#47 closed the SDK gap, so `sdk-gap.md`'s gap tables are historical.
- `checks/` must stay pure and execution-free; `DIAGNOSTIC_KINDS` is centrally owned and additive-only — a
  consumer must never mint parallel kind strings.
- `server/`'s dependency budget is closed (`hono`, `@hono/node-server`, `@whim/contract` + zod) and must stay
  React/RN-free; `guard:metro` is CI-blocking on new workspaces.
- Trusted-vantage-only observation (spike2 finding F4): a containment verdict may come only from a
  nonce-authenticated frame or CDP-level observation, never from bundle self-report.

## Integration points

- `runStaticChecks(source, opts)` — per-candidate Tier-A static verdict.
- `Pipeline` / `createStubPipeline` — substitutable generation seam; a runner can inject its own.
- `createApp({ pipeline, usageStore })` — in-process HTTP/SSE if a runner wants wire-shaped access.
- `GenerationEvent` / `WireAppRecord` / `Usage` zod schemas — validating captured events.
- `OpenRouterClient` — the only existing model client; unmounted, injectable `FetchFn`.
- `docs/app-corpus.md` Tier-0 rows + `docs/sdk-gap.md` §6 — the visible corpus and seeds.
- `synthetic-run-harness` (capability `synthetic-run`) — candidate source string in, run report out. Its
  report is specified to carry diagnostics (checks-contract shape), a containment verdict from the
  nonce-authenticated probes frame, per-stage timings, a syscall/cue invocation trace, screens visited vs
  declared, and applied budget values. Determinism is **field-content** determinism; timings are explicitly
  excluded. Its proposal names #12 as the intended consumer of the report and syscall trace.

## Risks and unknowns

- **`synthetic-run-harness` is proposed but not yet implemented.** Its directory name (`synthrun/` vs
  `runharness/`), exact report field names, entry-point signature, and whether the report is ever written to
  disk are all explicitly left to the implementer in its own design.md Open Questions. Only the *shape*
  above is fixed. I did not verify any of it against code, because no code exists yet.
- **`synthetic-run-harness` provides no LLM/model seam at all.** Its "offline" story is about hardware
  effectors and ephemeral `:memory:` SQLite, not about faking a model. A fake/recorded *judge* is not
  something it supplies.
- **No judge rubric text exists anywhere in the repo.** spec.md §16.3 and the roadmap brief both name "an
  English rubric" without drafting one. It is a genuine gap to originate, not adapt.
- No stable corpus id scheme exists; introducing one is an open planner decision.
- I did not verify whether any partial eval-runner scaffolding exists outside `checks/`, `server/`,
  `contract/`, and the top-level `package.json`; a repo-wide `eval` grep was not run.
- Two divergent Node-suite harness idioms exist and precedent does not settle which a new suite should follow.

## Open questions for the planner

1. Introduce a stable per-corpus-app slug now (none exists — apps are matched by prose name across three
   docs), or accept name-matching for v1?
2. Is drafting the Tier-C English rubric in scope for this change, or expected to pre-exist? (It does not.)
3. Given `synthetic-run-harness`'s report type is not yet pinned, does this change bind to the shape behind
   an adapter, or defer Tier A's runtime leg?
