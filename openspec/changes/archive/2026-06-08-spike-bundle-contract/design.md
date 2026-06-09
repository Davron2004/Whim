## Context

Whim's agent emits text; the runtime must turn that text into a running, contained mini-app. Spike 1 settled the *container* (Decision #35): a sandboxed cross-origin `<iframe>` (`allow-scripts`, **no** `allow-same-origin`), a **CSP with `script-src 'unsafe-inline'` but no `'unsafe-eval'`**, a surgical global strip, and a one-way string transport (`window.ReactNativeWebView.postMessage` web→host; an injected string web hears on `message` host→web). It deliberately left the *contract* — emit format, transpilation, module resolution, and how the JS string is delivered into that container — to this spike (Spike 2, spikes.md; called out as out-of-scope in #35's design).

The decision flip is the whole point. #35 makes the CSP **load-bearing**: it is the only leg that closes the `({}).constructor.constructor('…')` codegen hole, which no value-strip can reach. But that same CSP **forbids the obvious delivery paths** — `eval(src)` and `new Function(src)` throw `EvalError`, dynamic `import()` rejects, and there is no ambient module system. So the contract cannot be designed in the abstract; it has to be designed *against that CSP*. The load-bearing finding this spike owes forward is **how source becomes executable script under `'unsafe-inline'`-without-`'unsafe-eval'` while keeping the iframe cross-origin and the probe checklist green.** Emit format and transpilation (§5.2, §8.1) are the comparatively easy, mostly-settled parts that ride on top.

This is a throwaway de-risking spike: the deliverable is the *lesson* (emit format, the delivery mechanism that executes under the locked CSP, where transpile happens + latency, module resolution, the source-map approach, and a re-confirmation containment holds), not the code — which is deleted once the lesson is captured. The discipline is **scope and disposability**: build only what answers the unknown, keep it clean enough to trust the result, and don't treat the substrate as the v0.1 runtime.

## Goals / Non-Goals

**Goals:**
- Prove the lead hypothesis **H1**: the agent emits TS importing `vc-sdk`; a build step transpiles + bundles to one JS string; the runtime delivers and runs it inside the **exact** Spike-1 sandbox, with `vc-sdk` resolved and the bundle still contained.
- Settle the **load-bearing sub-decision (D2): delivery under the locked CSP** — which channel gets a JS string to execute under `script-src 'unsafe-inline'` without `'unsafe-eval'`, with the iframe cross-origin and the probe checklist still green.
- Settle **module resolution + SDK presence (D3)**: bundle-the-SDK-in vs `vc-sdk`-external-to-an-injected-global, and what `vc-sdk` actually resolves to at runtime.
- Preserve **line-accurate source maps (D4)** from emitted source → running bundle, so §8.1 diagnostics point at the agent's original lines.
- **Re-prove containment under the real delivery (D5)**, and follow Spike 1's "accept on the real target, not desktop Chrome" discipline (D6).
- Record the emit format with a one-line example, and measure transpile+bundle latency for a small app.

**Non-Goals:**
- No real server (it doesn't exist yet) — the esbuild step is a small **local** stand-in to prove the path and measure latency, not v1 harness infrastructure.
- No LLM, no agent loop, no real static checker, no repair loop — this spike fixes the *format those will target*; building them is later (§8). The fixture is hand-written, not model-generated (model reliability against this format is Spike 7).
- No real SDK breadth — a small but realistic slice of §5.2 (`defineApp`, `Screen`/`Stack`/`Text`/`Button`/`NumberInput`/state) is enough to exercise imports; the full surface is v0.1+.
- No hot-reload / streaming re-injection UX (Spike 8) — but the delivery channel chosen in D2 should not *preclude* re-injection; note which channels support it.
- No reusable code; the substrate is **not** the v0.1 runtime and gets deleted.

## Decisions

### D1 — Emit format + module resolution: H1 lead, H2 fallback, H3 likely dead-on-arrival

- **H1 (lead) — agent emits TS using `import … from 'vc-sdk'`; a build step transpiles + bundles (esbuild) to one JS string; runtime injects with `vc-sdk` pre-resolved.** Best ergonomics for the model and best static-checking (real TS types, real AST). Cost: a build step (latency vs. the streaming/iteration feel) — measured here, expected negligible next to model latency.
- **H2 (fallback) — plain JS against injected globals, no imports, no build.** Lowest infrastructure and latency; slightly less natural for the model and weaker type ergonomics. Falls back here only if H1's build latency or complexity bites.
- **H3 — ESM + import map, browser-native resolution inside the iframe.** **Probably already killed by #35**: dynamic `import()` rejects in the sandbox and there is no module loader under the locked CSP. Verify in one quick probe and drop; do not invest in measuring it.

The emit shape (per §5.2): one file, `export default defineApp({ name, initial, screens, capabilities })`, importing UI/state from `vc-sdk`. The producing prompt is not part of the bundle (that lives in the version repo, #36 / `on-device-snapshot-store`).

### D2 — Delivery under the locked CSP (the load-bearing sub-decision)

The CSP that won Spike 1 (`script-src 'unsafe-inline'`, **no** `'unsafe-eval'`) is non-negotiable — it is what closes codegen. So delivery may **not** use `eval`/`Function`/`import()`. Evaluate, pick the channel that *executes* and *keeps containment*:

- **(a) Inline `<script>` baked into the iframe's `srcdoc`.** Simplest, closest to the proven Spike-1 shape. Inline script is exactly what `'unsafe-inline'` permits, and `srcdoc` under `allow-scripts`-without-`allow-same-origin` keeps the opaque cross-origin. Weakness: re-injection means re-creating the iframe (fine for first load; matters for Spike 8).
- **(b) Pre-injected loader + string transport (likely lead).** A tiny trusted loader lives in the iframe HTML; the host posts the bundle source in over the Spike-1 host→web string channel; the loader inserts it as a **DOM-created inline `<script>`** (`script.textContent = src; head.append(script)`). Inserted inline scripts are covered by `'unsafe-inline'` and are **not** `eval` — so this should run under the locked CSP, and it survives re-injection. The open question is whether the *RN WebView engine specifically* gates DOM-inserted inline scripts the same as desktop — which is why this is probed, not assumed.
- **(c) `blob:`/`data:` URL `<script src>`.** Requires adding `blob:`/`data:` to `script-src`, **widening** the CSP beyond what #35 validated — a containment concern (an attacker who can mint a same-origin `blob:` may gain reach). Verify behavior, but treat widening the load-bearing CSP as a reject signal; prefer (a)/(b).

**Accept criterion for D2:** the chosen channel runs the fixture under the *unmodified* #35 CSP (or, for (c), a minimally-widened one whose new containment cost is explicitly probed), on the real RN target.

### D3 — Module resolution + SDK presence: where `vc-sdk` comes from

Two sub-flavors of H1, with a real downstream trade-off:

- **H1a — bundle the SDK *into* the output.** esbuild resolves `vc-sdk` at build time; the string is self-contained, no runtime resolution, no import map (cleanest under the CSP). Cost: every bundle carries the SDK → **fat bundles**.
- **H1b — `vc-sdk` marked external, resolved to a host-injected global.** esbuild rewrites `import { Button } from 'vc-sdk'` to reference a global the host pre-injects into the iframe (the same "SDK is the one reachable module" surface from #35). Cost: a small resolution shim. Benefit: **tiny bundles.**

**Cross-spike note (informs, not decided here):** bundle size sets per-generation **loose-object count**, which #36 named as the on-device version store's real storage pressure (~4 objects/gen, gc is DIY). H1b's tiny bundles are the version-store-friendly choice. Record the recommendation; the store itself is `on-device-snapshot-store`.

### D4 — Source maps survive to line-accurate diagnostics

§8.1's whole value is structured diagnostics with a `line` and a fix hint, and the repair loop feeds the agent's *original* source back. So the emitted-source→running path must carry a source map (or otherwise map executed positions back to the agent's TS). Confirm a thrown error / a static-check finding can be reported against the **original** source line, not the bundled output. This is a hard requirement, not a nicety — it gates the harness phase.

### D5 — Re-prove containment under the real delivery

A new delivery channel can reopen a hole the hand-injected Spike-1 bundle never tested (a `blob:` with an unexpected origin, a loader that leaks a host handle, an inline-script insertion that runs with more reach than expected). So after wiring D2, **re-run the relevant subset of the Spike-1 probe checklist** (the preserved `invariants/sandbox-isolation/` suite is the seed) against the *real* delivered bundle: forbidden globals throw/inert, `parent`/`top`/`frameElement` yield no host/native handle, prototype-walk codegen still `EvalError`s, and the only crossing is `parent.postMessage`. Green here is part of acceptance — a contract that delivers code but weakens containment is a reject.

### D6 — Prove the build in Node, accept on the RN target

The esbuild transpile/bundle and the emit-format mechanics are cheap to validate in plain Node (fast iteration). But — exactly as Spike 1 refused a desktop-Chrome pass (its D3) and Spike 4 refused a Node pass (its D6) — the **acceptance that counts runs in `react-native-webview` on the Android target**, because the load-bearing unknown (does the chosen delivery channel execute under the locked CSP on *this* engine, and does containment hold) is engine-specific. Node-green is a checkpoint, not a pass.

## Risks / Trade-offs

- **[No delivery channel executes under the locked CSP]** (the headline risk) → if neither inline-`srcdoc` (a) nor the pre-injected loader (b) runs, and only CSP-widening (c) works, that is a direct tension with #35's load-bearing finding. Record it loudly; the resolution is to weaken delivery, never the CSP — escalate toward H2 (plain JS still needs delivery, so this risk is shared) or accept a narrowly-widened, re-probed CSP only if its new containment cost is proven acceptable.
- **[DOM-inserted inline scripts are gated differently on the RN WebView engine]** → the exact reason D2(b) is probed on-target, not assumed from desktop behavior. If the engine blocks them, fall back to (a) (re-create iframe per load) and note the re-injection cost for Spike 8.
- **[Delivery channel reopens an escape]** (D5) → re-running the probe subset catches it; a green delivery with a red probe is a reject, not a pass.
- **[Build latency hurts the iteration feel]** → measure it; if a small-app transpile+bundle is not a small fraction of model latency, fall back to H2 (no build step). Expected negligible.
- **[Source maps don't survive bundling cleanly]** (D4) → if line-accurate mapping to original source is lost, the harness's diagnostic quality (§8.1, the thing that makes the harness good) degrades — resolve the source-map config or reconsider the bundling step.
- **[Fat bundles strain the version store]** (D3 / #36 cross-cut) → prefer H1b (injected-global, tiny bundles); record the recommendation for `on-device-snapshot-store`.
- **[Format isn't reliably emittable by a model]** → out of scope here (hand-written fixture); flagged for Spike 7. This spike only sanity-checks by hand that the format is plausible to emit.
- **[Scope creep / over-investment]** → the guardrail is scope and disposability, not scrappiness: build only what answers the contract unknown, keep it clean enough to trust, record the artifact, delete the code. Don't build the real server, the static checker, or the v0.1 runtime here.

## Migration Plan

Not applicable in the deploy sense — nothing ships. The "migration" is knowledge transfer: on completion, write the artifact (emit format + one-line example, the delivery-under-CSP mechanism, where transpile happens + latency, module resolution + SDK-presence call, the source-map approach, and the re-containment confirmation) into `docs/decisions.md` plus a `DEVLOG.md` capture, then delete the spike code. This change declares **no capabilities**, so archive it doc-only with `openspec archive spike-bundle-contract --skip-specs --no-validate` — nothing folds into `openspec/specs/`. The `webview-sandbox-runtime` change builds the real bundle-execution mechanism from this lesson.

## Open Questions

- Which delivery channel wins under the locked CSP on the RN WebView engine — inline-`srcdoc` (a), pre-injected loader + DOM inline script (b), or (only if forced) a CSP-widening `blob:`/`data:` (c)?
- Does the RN WebView engine gate **DOM-inserted inline scripts** the same as desktop under `'unsafe-inline'`-without-`'unsafe-eval'`? (Decides whether D2(b) is viable.)
- H1a (bundle SDK in) vs H1b (external + injected global) — confirm H1b's tiny-bundle benefit is worth its resolution shim, given the #36 loose-object pressure.
- Does the source map survive bundling well enough to report a thrown-error line against the **original** TS? (D4 hard requirement.)
- What is the real small-app transpile+bundle latency, and is it a small enough fraction of model latency to keep H1 over H2?
- Does the chosen delivery channel support **re-injection** without re-creating the iframe (feeds Spike 8 / hot-reload), and at what cost?
- Is `defineApp({ … })` default-export the right top-level shape, or does the runtime want a named registration hook? (Sanity-check against the §5.2 sketch; don't over-design.)
