## Why

This is the v0.1 build that implements and *retains* the WebView mini-app runtime: an untrusted, SDK-targeting bundle runs **contained** inside `react-native-webview` (forbidden globals neutralized, SDK the only capability surface) and **renders** UI, round-tripping events to the RN host. It realizes the architecture of Decision #11 (WebView rendering) and the §5.1 three-layer security model as actual, retained code.

It is the build that the `spike-sandbox-runtime` spike de-risked. That spike shipped no retained behavior; it proved H1+R1 on the real Android target and handed forward a recipe — recorded in `docs/decisions.md` #35 (cross-origin iframe + CSP-without-`unsafe-eval` + surgical global strip; 26/26 probes; ~104 ms cold paint) and the preserved invariant suite at `invariants/sandbox-isolation/`. **This change consumes that lesson as input** and is the one whose capability deltas legitimately fold into `openspec/specs/` on archive.

> **⚠ SECOND INPUT (added 2026-06-07, after this proposal was first drafted): Spike 2 — `spike-bundle-contract` (Decision #37) — decided the bundle-execution mechanism this build needs.** #35 settled the *container*; #37 settled *what the agent emits and how that text becomes running, contained code* — the part #35 deliberately left open. **REQUIRED READING before designing/implementing this build: `docs/spike2-findings.md`** (the consolidated, code-deletion-proof output; the spike scaffold is deleted). It was decided, confirmed **on-device** on the Android System WebView, and **pen-tested (T1–T8 + F4)**. In brief:
> - **Emit:** one TS file importing only `vc-sdk`, `export default defineApp({...})` → esbuild bundles to an **IIFE** (ESM/import-maps are dead under the CSP).
> - **Delivery:** **channel (b)** — a pre-injected trusted loader inserts the bundle as a **DOM-created inline `<script>`** (`textContent`, not eval). Channel (a) (srcdoc-inline) is the proven fallback; `blob:`/`data:` is **refused** under the locked CSP — never widen `script-src`.
> - **Modules:** **H1b** — `vc-sdk`, `react`, `react-dom` are host-injected externals and the **only** resolvable specifiers; everything else throws.
> - **FIVE load-bearing constraints this build MUST honor** (full text in `spike2-findings.md`): (1) the global strip MUST be a **window-level** non-configurable value-strip, never lexical/closure (a fresh self-injected `<script>` must still hit the poisoned `window`); (2) the trusted loader/SDK must hold **no capability stronger than `parent.postMessage`** (the bundle shares its global scope); (3) **judge containment from a trusted vantage, never the bundle's self-report** (F4 — the bundle can forge its own "contained" verdict); (4) **authenticate/ignore bundle-origin control messages** — don't trust a message by its `kind` (T6); (5) **re-injection must reset/re-harden the realm** (re-create the iframe, or re-strip + re-freeze globals/`Object.prototype`) between generations (T7 — gen-1 pollution otherwise persists into gen-2; matters for Spike-8 hot-reload).
> - **Runnable regression oracle:** the adversarial suite (T1–T7 + F4) is preserved at `invariants/sandbox-isolation/spike2-bundle-contract/` (`npm test` → headless Chromium, all invariants held) — fold it into the §16.2 isolation suite this build guards.

## What Changes

- Build the WebView shell + the bundle-execution mechanism (fresh context, dangerous globals neutralized, CSP without `unsafe-eval`, SDK injected as the only module) following **both** spike recipes: the **container** from #35 (Spike 1) and the **bundle-execution contract** from #37 (Spike 2 — `docs/spike2-findings.md`), which decides how source becomes running code (emit→IIFE, channel-(b) delivery, H1b modules) and the five constraints that must hold.
- Implement the contained render path (React-to-DOM inside a cross-origin sandboxed iframe) and the one-way string transport to the RN host.
- Promote the spike's `invariants/sandbox-isolation/` probe checklist into the retained, never-regress isolation suite (§16.2) that guards this code.

## Capabilities

### New Capabilities
- `sandbox-isolation`: The containment guarantees an untrusted mini-app bundle runs under — forbidden globals are removed or provably inert, and there is no reachable path from the contained context to the RN host or native layer. This is the source of the network/native-isolation invariant that §16.2 names the most important assertion in the codebase. Requirements here are isolation-primitive-agnostic (they must hold whether H1, H2, or H3 wins).
- `sandbox-rendering`: A contained, SDK-targeting bundle can render UI inside the WebView and round-trip a user event back to the RN host, within a mount-to-first-paint budget that feels instant for a trivial app.

### Modified Capabilities
None.

## Impact

- **Status: ready to flesh out — the spike already ran.** Unlike a not-yet-run spike, `spike-sandbox-runtime` is complete and its recipe is recorded (#35), so this build is unblocked. The capability specs are written (relocated here from the spike, where they were mis-filed); `design.md` and `tasks.md` are **not** written yet and should be authored next, drawing on **#35 (container) + #37 (bundle-execution contract; `docs/spike2-findings.md` + its five constraints)**.
- **Likely broader than these two capabilities:** the full v0.1 milestone (§15.2) also adds the thin SDK UI slice (`Screen`/`Stack`/`Text`/`Button`/…), theme tokens, `useState`, and the tip-splitter fixture. Those are out of scope for this relocation and would be added as capabilities/specs when this change's design+tasks are written — don't assume v0.1 = only isolation + rendering.
- **Mechanism-agnostic specs:** these describe behavior (containment + render/round-trip), not the iframe/CSP mechanism — so they hold even if the render backend later swaps to a native reconciler (§4.6).
- **Affected systems:** the RN host, the WebView runtime, the SDK injection mechanism, and the retained `invariants/` suite. 
- **Retains behavior:** unlike the spike, this change ships real, retained code; its deltas are meant to become the system's source of truth.
