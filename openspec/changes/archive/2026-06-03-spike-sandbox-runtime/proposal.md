## Why

Whim's entire architecture rests on one unproven assumption: that an untrusted JS bundle can run *contained* inside a React Native WebView — with the dangerous globals gone and a controlled SDK as its only capability surface — while still rendering UI. If that assumption has no clean answer, the WebView rendering bet (Decision #11) and everything built on it collapses. This is Spike 1: the single most foundational de-risking experiment, and nothing in v0.1 can start until it lands.

This is a **spike**, not a feature. The deliverable is the *lesson* — which isolation primitive won, the exact global-neutralization technique, the escape vectors probed, and a rough perf number — recorded durably; the code is throwaway and gets deleted once the lesson is captured. The discipline is scope and disposability (build only what answers the unknown; don't treat the scaffold as the v0.1 shell), **not** deliberate scrappiness — for an agent, clean-enough code costs no extra time and makes the finding trustworthy.

## What Changes

- Stand up a minimal, throwaway React Native app with one `react-native-webview` on screen (the repo is currently docs-only, so this also bootstraps a disposable RN scaffold — *not* the real v0.1 shell).
- Inside the WebView, build an HTML harness that creates a contained execution context (leading hypothesis **H1**: a sandboxed `<iframe>` with `allow-scripts` but **not** `allow-same-origin`), neutralizes the forbidden globals on that context, and injects a fake one-function SDK (`{ Button }`) as the only reachable capability.
- Load a ~20-line hand-written bundle that imports the fake SDK, renders a button (leading hypothesis **R1**: React-to-DOM inside the sandbox), and posts a message to the RN host on tap.
- Run a forbidden-globals **probe checklist** as assertions: `fetch`, `eval`, `new Function`, `localStorage`, `indexedDB`, `new WebSocket`, dynamic `import()`, `Worker`, and host/native reach via `window.parent` / `window.top` / prototype-chain walking.
- Record the result in `docs/decisions.md` (and a `DEVLOG.md` capture entry): the winning isolation primitive, the neutralization technique, escapes probed, and mount-to-first-paint timing. Then **delete the spike code.**
- On rejection of H1, the documented fallback path is **H2 (SES / `lockdown()`)**, and only if that also fails, reconsider **H3 (QuickJS-in-WASM)** — which is the native-reconciler path in disguise.

## Capabilities

### New Capabilities
**None.** This was a throwaway de-risking spike: it proved the H1+R1 approach and produced a decision + recipe, then deleted its code. It shipped **no retained product behavior**, so it declares no capabilities and folds nothing into `openspec/specs/`. Its retained outputs are: the decision record (`docs/decisions.md` #35) and the preserved isolation **invariant suite** at `invariants/sandbox-isolation/` (a test artifact, not a product capability).

The `sandbox-isolation` and `sandbox-rendering` capabilities this spike de-risked are **proven and recipe-in-hand, not built** here. Their capability specs live in the downstream change **`webview-sandbox-runtime`** (the v0.1 build that actually implements and *retains* the WebView runtime + render slice), which consumes this spike's lesson as input.

Tooling note: with no spec deltas, `openspec validate` reports `CHANGE_NO_DELTAS` for this change — the **correct** state for a doc-only spike, not a defect. Archive it doc-only with `openspec archive spike-sandbox-runtime --skip-specs --no-validate`.

### Modified Capabilities
None.

## Impact

- **New (throwaway) code:** a minimal RN app, `react-native-webview` dependency, the sandbox HTML harness, the fake one-function SDK, and one hand-written bundle. All discarded after the lesson is recorded.
- **Durable artifacts produced:** a decisions-log entry + DEVLOG capture; the probe checklist (which becomes the headless CI invariant suite in Spike 6); the proven neutralization technique (reused by the real v0.1 runtime).
- **Decisions informed:** confirms or challenges Decision #11 (WebView rendering) and §4.6; a forced fallback to H2/H3 would be an architecture-level reversal worth a `[REVERSED]`-style entry.
- **Downstream unblocked:** v0.1 (render slice), Spike 2 (bundle/module contract — reuses this injection mechanism), Spike 3 (synthetic event stream — needs something to mount), Spike 6 (CI headless boundary — runs this probe checklist).
- **No production code, no LLM, no server, no bridge, no storage** — deliberately the smallest provable slice.
