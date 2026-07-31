# Design: generation-loop

## Context

Everything the loop needs is built and idle. `server/src/pipeline.ts` defines
`Pipeline.run(request, signal?) → AsyncIterable<GenerationEvent>` and ships a stub behind it;
`server/src/openrouter.ts` is a complete streaming client with typed errors, an injectable transport, a
forwarded `AbortSignal`, and a captured generation id — and, per its own header comment, "No route imports
this module in this change (#8); it is wired in #11." `checks/index.ts` exposes
`runStaticChecks(source, {appliedSchema?, filename?}) → CheckReport` with the extracted `defineApp`
manifest already on the report. `synthrun/` boots a candidate in the unmodified production page and returns
a deterministic `RunReport`. `docs/sdk-reference.md` is a prompt-ready SDK reference. The device already
renders `plan`/`generate`/`check`/`run`/`repair` stage events it has never received (#53). (research.md,
"Current behavior".)

Two recorded debts also fall due. #52 D5 requires the applied schema to come from the live engine's
accumulated `_meta` union for grouped entries, with new burned IDs allocated past its maximum — and no
public read for that union exists (research.md, "Current behavior"). #53 D7 records that
`StoreAccess.activeSource()` is literally an alias of `activeBundle()`, so the edit flow re-sends compiled
bundle text; #11 must "either track a `source.ts` artifact by then or accept this."

Constraints that shape everything below, all from research.md: the `GenerationEvent` union is closed and has
no `rewrite` stage; exactly one terminal event per completed stream; diagnostic kinds are a closed
vocabulary extended only in `checks/contract.ts`; the API key is env-only and no suite may require it;
server state is the per-device token counter and nothing else; and `package.json`, `scripts/gate*.sh`,
`invariants/`, and `build/*` are Class-2.

## Goals / Non-Goals

**Goals:**
- A real, bounded, resumable-to-read pipeline behind the unchanged `Pipeline` seam.
- Total offline testability: every LLM call injectable, every gate run network-free.
- Cancellation that is honest at every boundary, including inside a Chromium-backed run.
- The two carryover obligations (#52 D5, #53 D7) closed rather than re-deferred.
- One extraction of manifest and schema, one build contract, one SDK reference.

**Non-Goals:**
- Agent memory / `LEARNED.md` (§9, post-v1), control-mode selection (§10.1), multi-model serving — the
  roadmap's explicit **Out** list.
- The model bakeoff and any eval scoring — that is #12 (`eval-harness`), which consumes this pipeline.
- Prompt caching, a direct (non-router) provider API, deployment, or TLS.
- Any change to the sandbox, CSP, bridge, or runtime.
- New npm dependencies.

## Decisions

### D1 — The pipeline is a new `server/src/generation/` subtree; `server/src/pipeline.ts` is untouched

`createGenerationPipeline(deps): Pipeline` lives in `server/src/generation/index.ts`. The existing
`pipeline.ts` keeps the `Pipeline` interface and `createStubPipeline` verbatim.

*Why:* the alternative — turning `pipeline.ts` into `pipeline/` — is a rename that collides with every
in-flight change touching the server and buys nothing. Keeping the stub intact also keeps the LAN UI lane
alive (`WHIM_PIPELINE=stub`), which matters because the device flow (#7) is built and the real pipeline
costs tokens per run.

### D2 — Stages are injected interfaces; only the composition root imports concrete implementations

`GenerationPipelineDeps = { model: ModelClient; roster: ModelRoster; check: CheckStage; build: BuildStage;
run: RunStage; clock: Clock; bounds: { planAttempts, repairAttempts, warningRepairAttempts } }`. The state
machine (`machine.ts`) depends on nothing concrete. `index.ts` is the only file that wires the real
`runStaticChecks`, the real `buildCandidateSource`, and the real synthetic-run session.

*Why:* this is the difference between a pipeline you can test in milliseconds and one you can only test
with Chromium and a network. It also keeps the machine's transition logic reviewable on its own.
*Alternative rejected:* importing the checker and harness directly and mocking modules — the repo has no
module-mocking idiom and it would make the fast suite depend on Chromium.

### D3 — `ModelClient` is the single LLM seam; `OpenRouterClient` is one adapter

```
interface ModelClient { stream(req: ModelRequest, signal?: AbortSignal): ModelStream }
interface ModelStream { deltas: AsyncIterable<string>; usage: Promise<Usage>; id: Promise<string|undefined> }
interface ModelRoster { rewrite: string; engineer: string }   // ids from env, per role
```
`ModelStream` is structurally what `OpenRouterClient.stream` already returns, so the adapter is a thin
pass-through. Tests use `ScriptedModelClient`, which replays recorded turns from
`server/test/fixtures/model/` and asserts the *role* each turn was requested for, so a test that
accidentally calls the wrong model fails loudly rather than silently consuming the wrong fixture.

Two guards make "no live calls in the gate" a fact, not a convention: the suite installs a transport that
throws on any request to the provider host, and the suite runs with `OPENROUTER_API_KEY` deleted from the
environment. *Why both:* the first catches a stray real client, the second catches a stray real key.

### D4 — The state machine, its states, and its bounds

States and transitions:

```
PLAN ──valid──▶ GENERATE ──▶ CHECK ──errors──▶ REPAIR ──▶ CHECK …
 │ invalid (≤1 re-ask)          │ clean         │ warnings-only (≤1)
 ▼                              ▼               │
FAILED                         RUN ──errors─────┘
                                │ green            REPAIR budget exhausted ▶ FAILED (or DELIVER, see D6)
                                │ contained:false ▶ FAILED (terminal, no repair)
                                ▼
                             DELIVER
```

- **`planAttempts = 2`** (initial + one re-ask). A plan that fails validation twice fails the run: two
  identical structural failures is evidence the request is not expressible, not that a third ask helps.
- **`repairAttempts = 3`**, pinning the roadmap's "repair ≤ 3" and spec.md's "~3" to an exact constant
  (research.md open question 2). `failure.attempts` is reported as the number of **candidates produced**
  (initial + repairs, so at most 4) — the reading a user's "how many tries did it take" maps onto.
- Both are constructor parameters so the exhaustion tests are cheap.

Termination is structural, not heuristic: every loop edge decrements a budget, so no model output — not
even one that returns byte-identical text every time — can loop forever.

### D5 — Rewrite stays a unary endpoint; the `stage` enum is not widened

(research.md open question 1.) The `GenerationEvent.stage` union is closed at `plan|generate|check|run|repair`
and the device (#53 D4) already implements rewrite as a separate call with its own preview screen. Adding a
`rewrite` member would be a contract widening every client must handle, for a step that is not part of the
stream. `/v1/rewrite` keeps its shape and gains a real model call, real metering, and an `ApiError` failure
body.

*One thing this forces:* a rewrite failure can no longer be papered over. Returning the input prompt as
`rewrittenPrompt` would be a silent lie about having rewritten it, so a model failure is a `502` and the
device's existing error handling shows it.

### D6 — Errors block, warnings are pursued but never fail a working app

`CheckReport.ok` is `diagnostics.length === 0` at any severity, and harness-diagnostics is explicit that
severity "SHALL NOT gate shipping" and that the target is a zero-warning steady state. Taken literally that
means a residual `unused_capability` warning should fail a run — which converts a cosmetic finding into a
user-visible failure and contradicts §8.2's own "a check that fires on working code is a bug in the check".

The resolution keeps both halves honest: warnings **are** repaired (the loop always aims at zero
diagnostics) but a warnings-only candidate consumes at most **one** repair attempt, and if the budget ends
with zero errors and a green run, the app is delivered with the residual warnings forwarded as `diagnostic`
events. Nothing is suppressed, nothing is hidden, and the checker API grows no severity knob — the policy
lives entirely in the pipeline, which is its proper home.

*Alternative rejected:* treat warnings as non-blocking entirely. That would let the steady state drift, and
the repair loop is exactly the mechanism §8.2 expects to keep working code warning-free.

### D7 — Containment failure is terminal and is never fed back

A negative containment verdict ends the run immediately: no repair attempt consumed, no diagnostic derived
from the escape attempt sent back to the model, `failure.reason` in product prose. *Why:* a repair loop
over containment failures is a loop that iteratively searches for an escape that the harness does not
catch — the one gradient we must never provide. It is also not a quality problem: containment is enforced
by the sandbox's three legs, so a negative verdict means the harness saw something it should never see, and
the right response is to stop.

### D8 — The run stage owns one session; cancellation is threaded, not raced

The pipeline factory launches one `SynthRunSession` (one Chromium per server process, D4 of the harness
design) and each run takes a slot from its semaphore. `synthrun`'s `RunOptions` gains `signal?: AbortSignal`,
threaded into `withTotalBudget` so an abort kills the page, disposes the context, and releases the slot
exactly as the total-budget path already does.

*Alternative rejected:* racing `runCandidate` against the signal and abandoning the promise, relying on the
harness's 45 s total budget to eventually clean up. That leaks a browser context and a semaphore slot for up
to 45 s per cancelled generation, and cancellations are expected to be common (the user backing out of a
generation). Adding the signal is ~10 lines in a library this change already depends on.

**Dependency, stated explicitly:** the run stage consumes `synthetic-run-harness`'s final `RunCandidate` /
`RunReport`, which land with **that change's chain-5**. At proposal time chains 1–3 are merged, so only
`handoff/harness-core.md` (session lifecycle, candidate builder, page assembly) and `handoff/observe-api.md`
(observers, watchdog, budgets) are available interfaces. This design therefore binds only to the spec's
"One candidate in, one deterministic run report out" contract — the report's `{ok, diagnostics, contained,
truncated, timings, trace, screens, budgets}` shape from `harness-core.md`'s `contract.ts` — and to nothing
chain-4/5 might still shape. `chains.md` records the hard external ordering: **no chain of this change is
dispatched before `synthetic-run-harness` is fully merged.**

### D9 — Usage: the route stays the crediting authority; the pipeline records ids on a trace

`Pipeline.run` gains an optional third parameter, `trace?: RunTrace` where
`RunTrace = { generationIds: string[] }`. The pipeline appends each model call's provider generation id as
it resolves. The normal path is unchanged: the pipeline emits one `usage` event with the run's accumulated
totals and the route's existing `interceptUsage` credits it. On abort, the route — which owns the
`AbortController` and the device id — reconciles each recorded id against the provider's generation-stats
endpoint through an injectable transport, with a bounded retry (the record resolves asynchronously
upstream), and credits the result.

*Why not move crediting into the pipeline:* two crediting paths in one component is how double-counting
bugs are born, and the route already holds the device identity. *Why not have the pipeline reconcile:* the
pipeline is gone by the time an abort's reconciliation resolves. The trace is a deliberately dumb
out-parameter — a stub that ignores it stays conforming.

This changes a spec'd behaviour: generation-server currently guarantees "a stream cancelled before its
`usage` event credits nothing." That guarantee was correct for a stub that never spent anything; it is
wrong for a real one. The delta replaces it with "a stream cancelled before any model call credits nothing"
plus reconciliation, and the roadmap's cancellation carryover (b) is exactly this.

### D10 — Prompt assembly reads its inputs, it does not copy them

`docs/sdk-reference.md` is read from disk at pipeline construction (path from `process.cwd()`, the idiom
`main.ts` already uses for `WHIM_DATA_DIR`, overridable by `WHIM_SDK_REFERENCE_PATH`). Few-shot examples
are read from the repo's real `fixtures/*.app.tsx` — a curated ordered list, deliberately excluding
`latency-probe.app.tsx`, which bypasses the SDK via a raw syscall and is pinned as an expected-flagged
sample by the checks suite.

Two tripwires make this non-vacuous:
1. every runtime value export of the `vc-sdk` barrel must appear in the SDK reference;
2. every curated few-shot fixture must produce a zero-diagnostic `CheckReport`.

Tripwire 1 is **red on arrival**: research.md found `docs/sdk-reference.md` documents no `nav` section even
though `nav.navigate`/`nav.back` are live exports. Fixing that red — adding the nav section — is a task in
this change, and is the reason the tripwire is worth having.

*Alternative rejected:* transcribing the reference into a TypeScript template literal. One document, two
copies, guaranteed drift.

### D11 — The plan is internal; validation is mechanical

`Plan = { screens: {name, purpose}[]; initial; state: string[]; capabilities: string[]; storageKeys: string[] }`,
parsed from the model's JSON skeleton (fenced-block tolerant) and validated with rules that are all
decidable: initial ∈ screens, unique non-empty screen names, capabilities ⊆ the harness's known set,
storage keys only with the storage capability, and — for an edit — no dropped capability that the supplied
applied schema requires. This is exactly spec.md §8.1's "cheap to validate" framing ("asked for reminders,
plan has no `notifications` capability → reject & retry"), never a judgement call.

The plan never crosses the wire: no plan payload is added to `GenerationEvent`, so the only evidence of the
stage is its event pair. *Why:* the contract is closed and additive-only, and the device has nothing to do
with a plan (#53 D4 deliberately keeps SDK internals off the user's screen).

### D12 — The app record has exactly one extraction

`WireAppRecord.name`/`.manifest`/`.schema` come from `CheckReport.manifest` — the checker's literal-only
`defineApp` extraction, which the static-checks spec already guarantees is present even on failing reports.
`.bundle`/`.sourceMap` come from `synthrun`'s `buildCandidateSource`, which is pinned byte-identical to
`build/build.mjs`. This closes #41's "later: harness-validated" and honours its "no second source of truth"
rule: the model is never asked to restate its manifest, and the pipeline never re-parses.

### D13 — #52 D5, end to end

- **Device**: `LauncherRoot.buildGenerateRequest` sources `appliedSchema` from a new read-only peek of the
  live database for `access.engineAppId(entry)` (which already resolves `storageGroupId ?? id`), not from
  `entry.record.schemaArtifact`. The peek applies no artifact and performs no DDL — asking what a database
  holds must not change it — and returns `emptyApplied()` for a database that does not exist.
- **Engine**: a pure `burnedIdFloor(applied)` helper next to `emptyApplied`/`validateArtifact`/`diffSchemas`
  in `src/host/storage-engine/schema.ts`, importable without the op-sqlite-requiring barrel (research.md's
  barrel gotcha). Counts retired columns: a tombstoned ID stays burned.
- **Checker**: the schema pass gains `id_below_floor` when an applied schema is supplied. This is not
  redundant with `diffSchemas` — reusing a *never-allocated gap* below the maximum (union has `f1`,`f5`;
  candidate introduces `f3`) is classified additive by a diff and still violates D5.
- **Prompt**: the generate and repair prompts state the per-collection floor as a hard constraint.

*Why the rule lives in the checker rather than the pipeline:* it is a pure function of (applied schema,
candidate schema), which is precisely the checker's remit, and putting it there means the eval harness (#12)
and any future caller get it for free without re-deriving it.

### D14 — #53 D7, closed by tracking source

Snapshots gain a `source.ts` artifact. `InstallSpec`/`UpdateSpec` gain the field, `install`/`update` write
it, and the source reader returns it — or reports absence — instead of aliasing `activeBundle`. The
version store is already content-agnostic (`Artifacts = Record<string,string>`), so no store change is
needed. `GenerateRequest.app.source` becomes optional so a legacy install is expressible honestly, and the
server pre-flights any supplied source through the parse gate plus a default-exported `defineApp` check,
treating a failure as absence.

*Why belt and braces:* the optional field handles the case the device knows about; the pre-flight handles
every case it does not — an older client, a hand-built request, a snapshot whose artifact is corrupt. What
must never happen is compiled bundle text reaching the engineer model labelled "your current code".
*Alternative rejected:* accepting the limitation, as #53 D7 permits. A minimal-diff repair prompt over an
IIFE is not a degraded edit flow, it is a broken one.

### D15 — Test lanes: the fast suite has no browser, one new suite does

`server:test` stays Node-only and gains the machine, stage, prompt, and contract sections with fakes. One
new browser-backed suite runs the pipeline against the real checker, the real build, and the real synthetic
run with a scripted model — an honest corpus-shaped candidate to `result`, a hostile one to a containment
`failure`. It cannot live in `server:test` without violating the gate split (fast gate = no Chromium), and
it cannot live in `synthrun`'s suite without the harness importing the server.

That leaves one unavoidable Class-2 touch: a `package.json` script entry and a `gate-full.sh` invocation
line. Both are recorded in `pending-class2.md` as HUMAN-BOOTSTRAP with exact text; no agent applies them.

*Why the server may import `checks/` and `synthrun/` at all:* both are plain repo-root libraries, and
`contract/src/index.ts` already does `export type { DiagnosticKind } from '../../checks/contract'`. No
workspace dependency is added, so generation-server's "runtime deps are exactly the allowed set"
requirement — which is about `server/package.json`'s declarations — is untouched. The operational
consequence (the server process now needs Chromium and a key to serve real generations) is real and is
recorded in the proposal's Impact.

## Risks / Trade-offs

- **`synthetic-run-harness` chain-5 has not landed** → this design binds only to the spec's "one candidate
  in, one deterministic run report out" requirement and `harness-core.md`'s published `RunReport` shape;
  `chains.md` makes "fully merged" a hard dispatch precondition (D8).
- **Prompt quality is unmeasurable here** → this change ships the loop, not the prompt tuning. #12
  (`eval-harness`) is the measuring instrument, and the corpus and holdout protocol are already specified.
  The tripwires (D10) protect correctness of the inputs, not quality of the outputs.
- **Recorded model fixtures rot as prompts change** → the fixtures encode *shapes* (a valid plan, a clean
  candidate, a candidate with one specific violation), not model quality; a prompt edit that invalidates a
  fixture should fail a test, which is the point.
- **A cancelled generation may still bill upstream** → D9 reconciles it; if the provider does not support
  mid-stream cancellation the tokens are still spent, which the roadmap already flags as a provider-selection
  input. Reconciliation gives up quietly rather than failing anything user-visible.
- **Chromium in the request path** → the run stage is bounded by the harness's watchdog and semaphore, and
  a truncated run is a named outcome rather than a hang. Server memory and start-up cost grow by one
  long-lived browser.
- **Delivering with residual warnings (D6)** → a real, deliberate divergence from a literal reading of the
  zero-warning steady state. Mitigated by never suppressing: residual warnings ride to the device as
  `diagnostic` events, and the loop always spends a repair attempt trying to clear them first.
- **`GenerateRequest.app.source` becoming optional** → a server that assumed presence would break; the only
  first-party client is the launcher, updated in the same change, and the field is widened (optional), so
  every existing request still validates.
- **Two new diagnostic kinds** → additive to a closed vocabulary, which the harness-diagnostics spec
  explicitly provides for; both are added in `checks/contract.ts` and nowhere else.

## Migration Plan

No data migration. `source.ts` is additive: absent on existing snapshots, present from the first
regeneration onward, and `GenerateRequest.app.source` is optional precisely so that state is expressible.
`appliedSchema` is optional and defaults to the empty applied schema, so an un-updated client keeps working.
The stub pipeline remains reachable (`WHIM_PIPELINE=stub`), which is also the rollback: if the real pipeline
misbehaves on the LAN, the device flow keeps working against the stub while it is fixed.

Deployment ordering: `synthetic-run-harness` fully merged → this change's chains → the two HUMAN-BOOTSTRAP
Class-2 lines applied → the attended LAN acceptance (real device, real key), which is what closes the
roadmap's cancellation carryover (a).

## Open Questions

Resolved during design, recorded here with their answers so they are not re-litigated:

1. **Does rewrite get a `stage` entry?** No — D5.
2. **Is the repair cap exact?** Yes — 3 repair attempts, 4 candidates, both injectable — D4.
3. **Where does the applied schema come from?** The live database's accumulated `_meta` union, shipped by
   the device via a new side-effect-free read — D13.
4. **Is #53 D7 fixed or deferred again?** Fixed — D14.
5. **What happens to warnings the loop cannot clear?** Delivered with the warnings forwarded, never
   silently dropped, after one repair attempt — D6.

Still genuinely open, and deliberately out of scope:

- **Which models.** The roster is env-configured with no id in source, exactly so #12's bakeoff decides
  this (#42, #25). This change must not pick a winner.
- **Provider cancellation semantics.** Whether a given provider stops billing on abort is a
  provider-selection input the roadmap already flags; reconciliation (D9) makes the answer observable
  rather than assumed.
- **`docs/sdk-reference.md`'s provenance.** research.md found the document current but credited to no
  roadmap change (#3 still reads "unproposed"). This change edits the document but does not attempt to
  reconcile the roadmap ledger; that is a docs-hygiene item for whoever next touches the roadmap.
