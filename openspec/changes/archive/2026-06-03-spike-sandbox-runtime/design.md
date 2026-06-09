## Context

Whim runs untrusted, AI-generated mini-app bundles. The architecture (Decision #11, spec §4.6) bets on rendering them as HTML/CSS inside a React Native WebView, with security coming "for free" from the browser's JS-context isolation plus a strip-globals-and-inject-SDK discipline. None of that is proven yet. The repo today is docs-only — there is no RN app — so this spike both bootstraps a disposable RN scaffold and answers the foundational unknown: **can an untrusted bundle run contained (forbidden globals gone, SDK as the only capability) and still render UI?**

This is a throwaway de-risking spike: the deliverable is the *lesson* (which primitive won, the exact neutralization technique, the probe results, a perf number), not the code — which is deleted once the lesson is captured. The discipline is **scope and disposability**: build only what answers the unknown, keep it clean enough to trust the result, and don't treat the scaffold as the v0.1 shell or invest in reusability/breadth the throwaway doesn't need.

## Goals / Non-Goals

**Goals:**
- Prove (or kill) the leading hypothesis **H1 + R1**: a sandboxed `<iframe>` (`allow-scripts`, **not** `allow-same-origin`) inside the WebView, forbidden globals neutralized on it, a fake one-function SDK (`{ Button }`) injected as the only reachable module, React-to-DOM rendering inside it, and a tap that round-trips to the RN host.
- Produce the **forbidden-globals probe checklist** as runnable assertions — the seed of the §16.2 network/native-isolation invariant and the §6 (Spike 6) headless CI suite.
- Nail down the exact **neutralization technique** that works in the `react-native-webview` JS engine specifically (not just desktop Chrome).
- Record a rough **mount-to-first-paint** number on a real Android emulator/device.

**Non-Goals:**
- No real SDK (one fake `Button` only), no TypeScript/transpile pipeline (that is Spike 2), no module-format decision (Spike 2), no bridge/dispatcher/registry (v0.2), no storage, no server, no LLM.
- No reusable code. The RN scaffold here is **not** the v0.1 shell; v0.1 rebuilds properly using this lesson.
- No multi-component UI, no theme tokens, no navigation, no perf optimization beyond eyeballing the ceiling.

## Decisions

### D1 — Isolation primitive: start with H1 (sandboxed iframe), fall back to H2 (SES), last resort H3 (QuickJS/WASM)

- **H1 — Sandboxed `<iframe>` (`allow-scripts`, no `allow-same-origin`).** Chosen first. Native browser isolation, React-to-DOM works directly, simplest. Cost: iframe isolation must be *probed* for escapes (`window.parent`, `top`, prototype reach) rather than assumed.
- **H2 — SES / `lockdown()` hardened compartments.** Fallback if H1 leaks or globals can't be reliably neutralized. Stronger language-level containment and fine-grained endowments, but a real learning curve and perf/ergonomic cost.
- **H3 — QuickJS-in-WASM (separate VM).** Last resort. Maximum isolation but no DOM → React can't render directly → you need a tree-posting custom renderer, which is the native-reconciler path (§4.6) in disguise. Heavier, larger bundle, serialization boundary. Out of scope unless both H1 and H2 fail.

Escalation is strictly H1 → H2 → H3, and a forced step past H1 is an architecture-level event that gets a decisions-log entry (potentially `[REVERSED]` against Decision #11's "free, battle-tested" framing).

### D2 — Rendering: R1 (React-to-DOM inside the sandbox)

R1 pairs with H1/H2: the fake SDK is a React component library and `react-dom` renders into the contained document. R2 (custom renderer posting a tree out) is only forced by H3 and overlaps the future native reconciler — explicitly out of scope here.

### D3 — Neutralization is surgical, and verified on the RN engine, not Chrome

Strip the *dangerous* set, not everything — React expects some globals, so over-stripping breaks the render path (this is an isolation requirement, not just a nicety). For globals the engine marks non-configurable (so `delete` fails), render them inert by shadowing inside the bundle's execution scope. **The accept criteria must be met in `react-native-webview` on a real Android emulator/device** — that engine's set of non-configurable globals and its iframe behavior are the actual unknowns; a green result in desktop Chrome does not count as a pass.

### D4 — Build order inside the spike: make-it-run before prove-it-contained

1. *Make it run* — bundle imports the fake SDK, renders a button, tap posts a string to the host's `onMessage`. Confirms R1 + transport + that stripping didn't break React.
2. *Prove it's contained* — execute the probe checklist (forbidden globals throw/inert) and the escape probes (`parent`/`top`/prototype walk reach nothing).

Doing (1) first gives a working substrate to attack in (2), and surfaces "stripping broke React" early.

## Risks / Trade-offs

- **[Forbidden globals are non-configurable in the RN engine, so `delete` fails]** → shadow them inside the bundle's execution scope; the probe checklist verifies inertness regardless of technique.
- **[The sandboxed iframe can still reach the host context / native bridge]** → this kills H1; escalate to H2 (SES). The escape probes exist precisely to catch this before trusting H1.
- **[Stripping the dangerous set also breaks React's own expectations]** → the strip must be surgical (D3); if React genuinely needs a borderline global, narrow the strip and re-probe, don't broaden it.
- **[`react-native-webview` diverges from desktop browsers]** (iframe semantics, ESM/import availability, message timing) → never accept on Chrome alone; all accept criteria run on the RN target (D3).
- **[Perf is visibly janky for a trivial app]** → if H1 can't hit the instant feel, note it; jank is a softer signal than an escape but still informs the WebView bet.
- **[Scope creep / over-investment]** → the guardrail is scope and disposability, not scrappiness: build only what answers the unknown, keep it clean enough to trust the result, record the artifact, then delete the code. Don't add reusability or breadth the spike doesn't need, and don't treat the scaffold as the v0.1 shell.

## Migration Plan

Not applicable in the deploy sense — nothing ships. The "migration" is knowledge transfer: on completion, write the artifact (winning primitive, exact neutralization technique, escape vectors probed, perf number) into `docs/decisions.md` plus a `DEVLOG.md` capture entry, then delete the spike code. v0.1 starts fresh from that lesson.

## Open Questions

- Does `react-native-webview` reliably support the chosen injection mechanism (and, if ever needed, ESM/import maps)? Confirmed-enough-for-the-spike here; format/transpile/module-resolution is Spike 2's job.
- Exact rough perf ceiling — 150 ms is a placeholder; record the real number and decide if it needs tightening for later tiers.
- Whether any borderline global (e.g. `setTimeout`, `postMessage`, `MessageChannel`) must stay reachable for the render/transport path — resolve empirically during D4 step 1.
