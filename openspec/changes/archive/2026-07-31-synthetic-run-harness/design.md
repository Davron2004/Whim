# Design: synthetic-run-harness

## Context

Roadmap #10 / decision #42: productionize the "run + observe" stage server-side, reusing the invariants machinery. All building blocks exist (research.md): `run-against-build.mjs` shows the boot recipe against the real assembled pages; `buildOuterHtml({syscallSink:'exposed'})` + `page.exposeFunction('whimHostDispatch', …)` is the proven seam for a real Node-side bridge (bridge-invariants suite); `createNodeSqlExecutor(':memory:')` gives per-run ephemeral storage; the loader's nonce-authenticated frame vocabulary (`hello/ready/delivery/paint/error/probes`) is the trusted observation surface; `checks/contract.ts` owns the closed diagnostic-kind union that harness-diagnostics requires downstream stages to extend additively. The sibling change `sdk-navigation` supplies `nav.navigate`/`nav.back`, `__whimNavDepth` emission, and `__whimControl.navBack`.

Standing constraints (research.md §Constraints): never widen/loosen the page or CSP; F4 trusted vantage only; realm reset = `__whimControl.reinject({reset:true})` / fresh context, never in-place re-delivery; `invariants/` and `build/*` consumed read-only (agent-protected); on-device stays the acceptance tier.

## Goals / Non-Goals

**Goals:**
- One call: candidate source string in → deterministic run report out (diagnostics + timings + syscall/cue trace + containment verdict).
- Catch what static checks cannot: mount-time throws, unhandled rejections, gate denials on real syscalls, screens that crash when rendered, hung mounts, containment failures.
- Deterministic enough that the #11 repair loop can attribute a diagnostic delta to its own fix.

**Non-Goals:**
- Behavioral assertions ("does the counter actually count") — eval Tier B (#12).
- Device execution; any pipeline/server wiring (#11); any numeric latency budget (v1 measures, #11 budgets).
- Modifying the runtime page, loader, CSP, or invariants machinery in any way.
- Coverage-style guarantees over app *logic* — the sweep covers the interactive surface, not code paths.

## Decisions

### D1: Traversal is a bounded interaction sweep with fingerprint dedup, plus nav-aware screen coverage

Per screen: enumerate interactive elements from outside the realm (Playwright/CDP pierces the opaque-origin iframe; this is browser-level trusted vantage, not bundle cooperation), fingerprint each as `(component kind, label/accessible text, DOM path)`, and act on each fingerprint exactly once in sorted fingerprint order: tap `Button`/`Card`/`ListItem`; type fixed canonical values into `TextInput`/`NumberInput`; toggle `Switch`/`Checkbox` on then off; select every `SegmentedControl` option; drag `Slider` to min then max; when a `Modal` is present, interact inside it first and backdrop-dismiss last. Re-enumerate after each action (state changes mint new elements); stop on no-unvisited-fingerprints, per-screen action cap, or the global watchdog. `emitUiEvent('press', label)` frames (already emitted by every interactive control before the app handler runs) serve as the "action connected" bookkeeping signal.

Screen coverage: follow real nav — when an action changes the observed `__whimNavDepth`, continue sweeping the newly rendered screen (visited-set on screen names bounds cycles). After the nav-reachable sweep, cold-mount each declared-but-unvisited `spec.screens` entry in a fresh realm (`ScreenComponent`s take no props, so cold-mount is legitimate render coverage) and emit `unreachable_screen` (warning) for it. Depth hints are traversal bookkeeping only, never authority (F4 discipline — a lying bundle only corrupts its own sweep, and every real failure signal is nonce-authenticated or CDP-level).

Determinism: fixed canonical inputs, sorted action order, no wall-clock–dependent branching in the driver. Alternative considered — random monkey-testing with a seed: rejected; seeds leak nondeterminism through timing races, and the repair loop needs stable diffs more than it needs input variety.

### D2: Watchdog is harness-level, quiet-window-based; a hung run is an explicit diagnostic

Three layers: (1) mount budget — no nonce-authenticated `paint` frame within it ⇒ `mount_timeout` error diagnostic; (2) per-action settle — wait for a quiet window (no new paint/console/telemetry activity) with a hard cap, then proceed; steady background activity (a legal `interval`) never blocks and is never a diagnostic; (3) total wall-clock budget — hard page kill, report marked `run_truncated` so #11 distinguishes "partial sweep" from "clean sweep". The runtime itself stays watchdog-free (adding one would change the product surface to ease testing — the exact thing roadmap #10 forbids in spirit). This deliberately replaces the invariants runner's silent `.catch(()=>{})` fall-through (research.md): in this harness every timeout is a named outcome; silent fall-through is a defect class, not a pattern to copy. Budget values are library defaults, overridable by the caller, recorded verbatim in the report.

### D3: Real gate, real engine, recording effectors — never fake above the authorization boundary

Wiring is the bridge-invariants recipe verbatim: `launchApp(appRecord, () => createEngine(createNodeSqlExecutor(':memory:')))` → `Dispatcher.forRealm(realm, createDefaultRegistry())` → `page.exposeFunction('whimHostDispatch', …)` + `buildOuterHtml({syscallSink:'exposed'})`. Gate verdicts (`undeclared_capability`, `invalid_params`, …) are exactly the diagnostics the repair loop must see, so everything at or above the gate is production code; below it, `cues.*`/`diag.*` effectors record invocations into the run report instead of acting (no hardware server-side; the trace feeds #12). Denials are collected **host-side at the dispatch function** — the only vantage that sees them even when the app `.catch`es and swallows the rejection (research.md: denials have no dedicated frame kind; the sysret side channel is ours here). Declared `schema` is applied to the ephemeral engine pre-mount; a failing application is itself a diagnostic. Alternative — stub the whole bridge: rejected; stub-vs-real drift would silently rot the repair loop's training signal.

### D4: One browser, one fresh context per candidate, small semaphore; measure, don't budget

`chromium.launch()` once per harness session; each candidate runs in a fresh browser context (~tens of ms; a strictly stronger isolation boundary than T7's iframe-recreation requirement — zero cross-candidate pollution by construction) with its page closed on completion. Within-run realm resets (cold-mounting unreached screens) use `__whimControl.reinject({reset:true})`, honoring T7. Concurrency is a caller-set semaphore (default small, 2–4): generation is LLM-latency-dominated, so sweep throughput is not the bottleneck; per-stage timings (`build`, `boot`, `mount→paint`, sweep, per-screen) are recorded in every report so #11 can set numeric budgets empirically. Alternative — page pooling with realm reuse across candidates: rejected; it re-litigates T7 for milliseconds of savings.

### D5: Placement — plain top-level directory; diagnostics kinds live in the central union

The library lands as a plain top-level directory (the `checks/` precedent: dependency-light TS source, importable by `server/` later, no workspace entry ⇒ the `guard:metro` byte-size surface is untouched; `playwright` is already a root devDependency). Runtime-observed kinds are added additively to `DIAGNOSTIC_KINDS` in `checks/contract.ts` — exactly the extension path harness-diagnostics reqs mandate — reusing bridge kind strings verbatim for denials ("one language for one mistake"). Runtime diagnostics use the shared shape with optional `line` (the spec already provides for source-anchor-less runtime producers); when a `pageerror` stack maps through the build's source map to an original-source line, `line` is populated. Alternative — new npm workspace: rejected; it buys nothing and costs a `guard:metro` proof obligation.

### D6: Candidate build path reuses the production contract, parameterized — not forked

The harness builds a candidate with the same esbuild contract as production (IIFE, classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw:'{}'` — the load-bearing gotcha) and slots the result in as the single bundle for `buildOuterHtml`, consuming `runtime-artifacts.json`'s `parts` for the page itself. It never edits `build/*`; if `build/` doesn't currently export a single-candidate entry point, the harness owns a thin builder that mirrors the contract and is pinned by a test asserting byte-equivalence against `build.mjs` output for a fixture app (drift tripwire, since `build/*` can't be modified by agents).

## Risks / Trade-offs

- [Element enumeration has no stable selector contract — no SDK suite does a generic sweep today (research.md)] → enumerate via CDP accessibility roles + rendered text; if that proves ambiguous for some component, the fallback is an inert `data-*` marker added in the SDK (a separate, tiny SDK change — flagged to the human, not smuggled into this one).
- [Bundle can spoof `emitUiEvent`/nav-depth frames] → those inform bookkeeping only; every failure-grade signal (throw, denial, verdict, paint) is nonce-authenticated, CDP-level, or host-side. Worst case a hostile bundle corrupts its own sweep coverage — acceptable, it's the candidate under test.
- [Quiet-window heuristic mislabels slow-but-legal apps] → the window is a settle heuristic, never a diagnostic; only the mount budget and total budget produce diagnostics, both generous defaults and caller-tunable.
- [D6's mirrored builder drifts from `build.mjs`] → byte-equivalence tripwire test against a fixture; any intentional build change breaks the tripwire loudly and a human reconciles.
- [sdk-navigation slips] → the dependency is confined to the screen-coverage portion (D1 second paragraph); boot/observe/single-screen sweep/watchdog/capabilities are implementable and testable against today's runtime — the chain plan isolates nav-dependent work.

## Open Questions

None blocking. Directory name (`synthrun/` vs `runharness/`) and exact default budget values are implementer choices recorded in the report format.
