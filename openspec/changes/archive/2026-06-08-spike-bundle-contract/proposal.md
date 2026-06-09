## Why

Spike 1 proved an untrusted bundle can run **contained** inside `react-native-webview` and still render UI (Decision #35) — but it did so with a *hand-written* bundle injected inline and a *fake* one-function SDK. It deliberately deferred the contract question to here: **what exactly does the agent emit, and how does that text become running, contained code?** This is Spike 2 (spikes.md) — the second and last Tier-1 blocker for v0.1. Until it lands, `webview-sandbox-runtime`'s "bundle-execution mechanism" can't be designed, the §8.1 static-check step has nothing concrete to check, and Spikes 3/5/7 have no emit format to build against.

**The decision flip from #35 sharpens the unknown.** The containment recipe that won is three-legged, and the load-bearing leg is a **CSP with `script-src 'unsafe-inline'` but *without* `'unsafe-eval'`** — that is the *only* thing that closes the `({}).constructor.constructor('…')` codegen hole. That CSP forbids the obvious ways to turn text into code: you **cannot** `eval(bundleString)` or `new Function(src)`; dynamic `import()` was probed to *reject*; there is no ambient `module`/`require`. So the central unknown is now narrower and sharper than spikes.md framed it:

> Given the **exact** sandboxed cross-origin iframe + CSP Spike 1 locked in, how does the agent's emitted source become *executable script* in the contained context, and how does `import { Button } from 'vc-sdk'` resolve — **without reopening any hole the probe checklist closed?**

Delivery-under-the-CSP is the load-bearing finding this spike must produce; emit-format and transpilation are the easier, mostly-settled parts riding on top of it.

This is a **spike**, not a feature. The deliverable is the *lesson* — the emit format (with a one-line example), the delivery mechanism that executes under the locked CSP, where transpilation happens and its latency, the module-resolution mechanism, the source-map approach for line-accurate diagnostics, and a re-confirmation that containment still holds — recorded durably; the code is throwaway and gets deleted once the lesson is captured. The discipline is **scope and disposability** (build only what answers the unknown; don't treat the scaffold as the v0.1 runtime), **not** deliberate scrappiness — for an agent, clean-enough code costs no extra time and makes the finding trustworthy.

## What Changes

- Rebuild the **minimal Spike-1 substrate** (the spike code was deleted on archive): one RN screen, one `react-native-webview`, the **exact** sandboxed cross-origin iframe + CSP-without-`unsafe-eval` + surgical global strip from #35. The contract must be proven against *that* sandbox, not a relaxed one.
- Define the **emit format** the agent produces: one file with `export default defineApp({...})` plus `import { … } from 'vc-sdk'` against the §5.2 surface (lead: TS). Hand-write one realistic Tier-0 fixture (the **tip splitter**, §15.3) in that format.
- Run the fixture through each candidate path and pick one:
  - **H1 (lead)** — agent emits TS importing `vc-sdk`; a server step transpiles + bundles (esbuild) to **one JS string**; the runtime injects it with `vc-sdk` pre-resolved.
  - **H2 (fallback)** — agent emits plain JS against injected globals, no imports, no build step.
  - **H3** — ESM + import map, browser-native resolution inside the iframe. **Probably already dead under #35's CSP** (`import()` rejects, no module loader) — verify quickly and drop rather than measure.
- Settle the **load-bearing question: delivery under the locked CSP.** Test the candidate channels for getting the JS string to *execute* under `script-src 'unsafe-inline'` without `'unsafe-eval'`: (a) an inline `<script>` baked into the iframe's `srcdoc`; (b) a tiny pre-injected loader that receives the source over the Spike-1 host→web string transport and inserts it as a DOM-created **inline** `<script>` (covered by `'unsafe-inline'`, *not* eval) — the channel that also survives re-injection; (c) a `blob:`/`data:` URL `<script src>` (needs widening `script-src`, a containment concern — verify and likely avoid).
- Settle **SDK presence**: bundle the SDK *into* the output (self-contained, fatter bundles) vs. mark `vc-sdk` external and resolve it to a host-injected global (tiny bundles, needs a resolution shim) — and note the interaction with Spike 4's per-generation object-count pressure.
- Preserve **source maps / line numbers** from the emitted-source→running path so §8.1's static check and the repair loop report line numbers against the agent's *original* source, not the bundled output.
- **Re-prove containment under the real delivery**: re-run the relevant subset of the Spike-1 probe checklist after wiring the chosen channel — a new delivery path (especially `blob:`/`data:` origin or a loader) must not reopen an escape.
- Measure **transpile + bundle latency** for a small app and confirm it is a small fraction of expected model latency.
- Record the artifact in `docs/decisions.md` (+ a `DEVLOG.md` capture), then notify the user, and *after user's approval,* **delete the spike code.**

## Capabilities

### New Capabilities
**None.** This is a throwaway de-risking spike: it picks the bundle/module contract and produces a decision + recipe, then deletes its code. It ships **no retained product behavior**, so it declares no capabilities and folds nothing into `openspec/specs/`. Its retained outputs are documentation only — a `docs/decisions.md` entry and the emit-format + delivery + module-resolution recipe in `DEVLOG.md`.

The bundle-execution mechanism this spike de-risks is **chosen and recipe-in-hand, not built** here. It is implemented and *retained* in the downstream change **`webview-sandbox-runtime`** (the v0.1 build whose "What Changes" already names "the bundle-execution mechanism (fresh context, dangerous globals neutralized, CSP without `unsafe-eval`, SDK injected as the only module)"), which consumes this spike's lesson as input.

Tooling note: with no spec deltas, `openspec validate` reports `CHANGE_NO_DELTAS` for this change — the **correct** state for a doc-only spike, not a defect. Archive it doc-only with `openspec archive spike-bundle-contract --skip-specs --no-validate`.

### Modified Capabilities
None.

## Impact

- **New (throwaway) code:** a minimal RN + `react-native-webview` substrate rebuilt to the #35 recipe, the emit-format fixture (tip splitter), a small **local** esbuild transpile/bundle step (proves the path + measures latency — *not* the real server, which doesn't exist yet), the chosen delivery wiring, and the re-run probe subset. All discarded after the lesson is recorded.
- **Durable artifacts produced:** a decisions-log entry + DEVLOG capture; the emit format with a one-line example; the **delivery-under-CSP** mechanism (the load-bearing finding); where transpilation happens + measured latency; the module-resolution mechanism and the bundle-the-SDK-in-vs-injected-global call; the source-map approach; the re-containment confirmation.
- **Decisions informed:** sharpens #11/#35 (the WebView bet — how source reaches the contained context under the load-bearing CSP), the §5.2 SDK import surface, the §8.1 static-check/repair line-number requirement, and the §16.3 Tier-A deterministic gate.
- **Downstream unblocked:** `webview-sandbox-runtime` (the bundle-execution mechanism + the tip-splitter fixture, §15.2/§15.3), Spike 3 (synthetic event stream — needs a real loaded bundle to drive), Spike 5 (SDK-as-docs — documents the emit format this picks), and Spike 7 (model reliability — measured against this emit format).
- **Coupling:** **depends on Spike 1** (done) — it reuses the exact iframe + CSP + transport + the one reachable SDK module, and re-asserts containment under the new delivery. Conceptually independent of Spike 4 / `on-device-snapshot-store`, with **one cross-cut to flag**: the SDK-presence choice (bundle-in vs injected-global) sets per-generation bundle size, which drives the **loose-object count** that #36 named as the on-device store's real storage pressure. Tiny bundles (injected-global) are the version-store-friendly choice — note it, don't solve it here.
