# Spike-2 adversarial sandbox suite (T1–T7 + F4)

The **runnable adversarial suite** preserved from Spike 2 (`spike-bundle-contract`) when its
throwaway scaffold was deleted. It is the **Spike-6 headless-CI seed** for the chosen
bundle-execution mechanism — the companion to the Spike-1 `sandbox-isolation-probe.html` one
level up (which seeds the base forbidden-globals checklist). Decision + the 5 carry-forward
constraints: `docs/spike2-findings.md` and `docs/decisions.md` #37.

## What it asserts (run `npm install && npm test`)

Each page in `pages/` is **self-contained** (the #35 CSP + the cross-origin sandboxed iframe
+ `neutralize.js` + the trusted probe suite + react + the delivered bundle are all inlined —
no build step). `runner.mjs` loads each under headless Chromium (which enforces the CSP +
sandbox) and asserts:

- **`channel-b.h1b.html`** (the chosen delivery: pre-injected loader → DOM-inserted inline
  `<script>`) and **`channel-a.h1b.html`** (the inline-`srcdoc` fallback) → **CONTAINED**,
  full T1–T7 trusted-probe suite passes, both negative controls fire.
- **`channel-b.reinject.html`** → containment still holds under re-injection; reports the
  **T7 finding** `anyPoison=true` (generation-1 pollution persists into generation-2 in the
  same realm → re-injection must reset/re-harden the realm; Spike-8 constraint).
- **`channel-b.evil.html`** → the **F4** demo: a malicious app **forges** its own verdict
  (`999/999`). The runner does NOT trust the container verdict here — it reads the iframe's
  honest on-screen report and asserts no attack actually succeeded. This is the live proof
  that the harness must judge containment from a trusted vantage, never the bundle's report.
- **`channel-c.unmodified.html`** → the `blob:` script is **REFUSED** under the unmodified
  CSP (the reject-signal invariant: delivery must never work via CSP-widening).

The attack vectors, mapped:
- **T1** self-injected fresh inline `<script>` reclaiming stripped globals → blocked (the
  strip is window-level, survives a fresh top-level scope).
- **T2** host/native reach (`parent`/`top`/`frameElement`/the real bridge) → blocked.
- **T3** pivot from the injected SDK global / loader → Function-constructor codegen → blocked.
- **T4** all codegen (`eval`/`Function`/`({}).constructor.constructor`/`import()`) → blocked.
- **T5** module confinement (relative/dynamic/subpath/off-allowlist `require`) → blocked.
- **T6** transport eavesdrop/spoof → constraint (host must authenticate bundle-origin frames).
- **T7** re-injection persistence → finding (realm must be reset between generations).
- **F4** verdict-spoofing → constraint (trusted-vantage containment verdict).

## Layout

- `pages/*.html` — the self-contained runnable pages (what CI loads).
- `reference/probes.js` — the trusted T1–T7 probe suite (the source of truth for the checks).
- `reference/neutralize.js` — the #35 window-level global strip.
- `reference/fixtures/*.app.tsx` — the attack fixtures (evil / poison / victim / bad-import),
  in the emit format, for reference + regeneration.
- `runner.mjs` — the headless runner (exit 0 = invariants held, 1 = regression).

## Caveats

- **Desktop Chromium ≠ Android System WebView.** This is the cheap per-push gate; the
  engine-specific gating (does the WebView run a DOM-inserted inline script under the locked
  CSP) + native-bridge reach were confirmed **on-device** in Spike 2 — keep an on-device run
  on a slower cadence (the Spike-6 policy split).
- The pages embed a non-minified React build (~0.6 MB each) — fine for CI, not a size model.
- `webview-sandbox-runtime` builds the *production* bundle-execution mechanism; this suite is
  the regression oracle it (and Spike 6) must keep green, honoring the 5 constraints.
