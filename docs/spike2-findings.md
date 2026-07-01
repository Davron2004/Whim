# Spike 2 — durable findings (for `webview-sandbox-runtime` and beyond)

*The throwaway spike code in `spikes/bundle-contract/` gets deleted; this does not. These are
the findings that outlive the spike — the contract, the security model, and the constraints
the real v0.1 bundle-execution mechanism must honor. Canonical detail: `docs/decisions.md`
#37 (+ #35 for the sandbox) and the `DEVLOG.md` Spike 1/2 captures.*

*The spike code was deleted once these lessons were captured (it is throwaway by design). The **runnable adversarial suite** (T1–T7 + F4) was preserved at `invariants/sandbox-isolation/spike2-bundle-contract/` — self-contained pages + a headless Playwright runner (`npm test`) — as the Spike-6 CI seed.*

## The decision (the contract the agent emits and the runtime runs)

- **Emit format:** one TS file, imports **only** from `vc-sdk`, a single `export default
  defineApp({ name, initial, screens, capabilities })`. `defineApp` returns a plain AppSpec
  descriptor; the trusted host decides when/where to mount.
- **Transpile:** esbuild → a single **IIFE** string (NOT ESM — there is no module loader and
  `import()` rejects under the CSP). Classic JSX (`React.createElement`), not the automatic
  runtime. Warm transpile+bundle ≈ 2–3 ms (negligible vs model latency).
- **Delivery (the load-bearing finding):** **channel (b)** — a tiny trusted loader pre-injected
  in the iframe receives the bundle source over the one-way string transport and inserts it as
  a **DOM-created inline `<script>`** (`script.textContent = src; head.append(s)` — NOT eval,
  NOT a module). Confirmed on the **Android System WebView**: it executes under the *unmodified*
  #35 CSP, and it survives **re-injection** without re-creating the iframe (→ the Spike-8
  hot-reload-friendly choice). Channel (a) (inline `<script>` baked into `srcdoc`,
  parser-inserted) is the proven fallback if a future engine ever gates dynamically-inserted
  inline scripts. `blob:`/`data:` `<script src>` (c) is **refused** under the unmodified CSP
  (confirmed on-device) and would require widening `script-src` — a reject.
- **Module resolution:** **H1b** — `vc-sdk` is marked external and resolves to a host-injected
  global (tiny ~4.5 KiB bundles → fewer per-generation loose objects, the #36 win). **react /
  react-dom are ALWAYS external** (host-injected as one shared instance — mixed React instances
  break hooks across the trusted-runner/bundle boundary). The **resolvable runtime surface is
  exactly `{vc-sdk, react, react-dom}`**; everything else (incl. `react-dom/server`,
  `react-dom/client`, `fs`, `child_process`, any 3rd-party) must throw — bundles mount through the
  injected `react-dom` global (which carries `createRoot`), so the `/client` subpath is never needed.
- **Diagnostics (D4):** the esbuild source map round-trips — a thrown error / static-check
  finding maps to the agent's **original** TS line. This gates the §8.1 repair loop; keep it.

## The security model — three load-bearing legs (none is sufficient alone)

1. **Opaque cross-origin iframe** — `sandbox="allow-scripts"` and **nothing else** (no
   `allow-same-origin`, no popups/forms/top-navigation). This is what denies host/native reach
   (`parent`/`top`/`frameElement` all `SecurityError`).
2. **CSP with `script-src 'unsafe-inline'` but NO `'unsafe-eval'`** (+ `default-src 'none'`,
   `connect-src 'none'`, `img-src data:`, `frame-src/child-src/worker-src 'none'`,
   `base-uri/form-action 'none'`). This is the *only* thing that closes the
   `({}).constructor.constructor('…')` codegen hole — no value-strip can reach it. It also
   blocks network egress (`connect-src 'none'`) and remote image exfil (`img-src data:`).
3. **Window-level value-strip** of the named network/storage/threading globals (`fetch`,
   `XMLHttpRequest`, `WebSocket`, `EventSource`, **`RTCPeerConnection`** — WebRTC is *not*
   covered by `connect-src`, so the strip is load-bearing here — `localStorage`,
   `sessionStorage`, `indexedDB`, `caches`, `Worker`, `navigator.sendBeacon`), via
   `Object.defineProperty(window, name, {value: throwingStub, configurable:false})`.

## Carry-forward constraints (the real runtime MUST honor these)

1. **The global strip MUST be a window-level non-configurable value-strip, never a
   lexical/closure shadow.** Channel (b) runs the bundle — and any `<script>` the bundle
   self-injects — in *global* scope; only a window-level strip survives a fresh top-level
   script. (This is exactly what blocks pen-test T1.)
2. **The trusted loader/SDK must never hold — on `window`, or in a closure reachable from a
   window-exposed function — any capability stronger than `parent.postMessage`.** The untrusted
   bundle shares the iframe's global scope with them; the only acceptable reachable "capability"
   is the one-way `parent.postMessage` transport.
3. **The harness MUST judge containment from a trusted vantage the bundle cannot overwrite —
   NEVER trust the bundle's self-reported verdict (finding F4).** A bundle sharing the iframe
   scope can overwrite the probe function and post a forged "contained:true" the host would
   display as a pass. The Spike-3 smoke test and Spike-6 CI invariants must run probes from
   code the generated bundle can't tamper with, and/or verify escapes out-of-band (a
   host-controlled network sink), not from the in-iframe self-report.
4. **The host MUST authenticate / ignore bundle-origin control messages — don't trust a
   message by its `kind` tag alone (T6, generalizes F4).** The bundle shares the iframe scope
   with the `parent.postMessage` transport, so it can forge ANY `{__whimHarness:true, kind:…}`
   control frame the host can't distinguish from the loader's (confirmed on-device: a forged
   host-bound control frame was accepted at the wire). Treat all iframe→host messages as
   untrusted data, never as authenticated control. (Only-one-bundle-per-iframe means a bundle
   can eavesdrop only its *own* transport traffic, not other realms' — so the transport must
   simply carry nothing a bundle shouldn't already have.)
5. **Re-injection MUST reset the realm (re-create the iframe) OR re-strip/re-freeze globals +
   `Object.prototype` between generations (T7).** Confirmed on-device: when channel (b)
   re-injects a second generation into the *same* iframe without reset, generation-1 pollution
   (a backdoor fn on `window`, `Object.prototype.__whimPwned`, a mutated global) **persists
   into generation 2** — i.e. generation N can backdoor generation N+1. Containment itself
   still held (persistence ≠ escape), but for Spike-8 hot-reload this is load-bearing: the
   re-injection speed win of channel (b) is only safe if the realm is reset/re-hardened per
   generation. (Aside: an *enumerable* `Object.prototype` write additionally DoS-es the next
   generation's bundle — esbuild's `__export` does `for(k in all) defineProperty(t,k,{get:all[k]})`,
   so an inherited enumerable key crashes init with "Getter must be a function.")

## Numbers + cross-cuts

- **Perf:** mount→first-paint ≈ 95 ms cold / 22–50 ms warm on the emulator (feels instant).
- **Bundle sizes:** H1a (SDK bundled in) ≈ 8 KiB; H1b (SDK external) ≈ 4.5 KiB; react/react-dom
  are the shared runtime, injected once (not per generation).
- **#36 (on-device snapshot store):** H1b's tiny bundles minimize per-generation loose-object
  count — the version-store-friendly choice.
- **Spike 8 (streaming/hot-reload):** channel (b) re-injects (append a new `<script>`) without
  re-creating the iframe. NOTE: the spike loader has a one-shot `delivered` guard that must be
  relaxed for real re-injection — and re-injection lets gen-1 pollution
  persist into gen-2 (pen-test T7, confirmed on-device) → see constraint #5 (reset/re-harden the realm per generation).
- **Spike 3 / Spike 6:** inherit constraint #3 (trusted-vantage containment verdict).

## Methodology lessons (reusable for future spikes)

- **Desktop→device ladder for WebView spikes:** run the generated pages in headless Chromium
  (Playwright — it enforces CSP + the iframe sandbox) as a *fast first filter* to shake out
  HTML/loader/probe bugs in seconds, THEN do the authoritative on-device run. Desktop is NOT the
  pass (no native bridge; different engine — channel-(b) gating and native-bridge reach are
  engine-specific), but it turns a long APK-rebuild debug slog into one clean device run.
- **"Wired ≠ works" — spike scaffolds must be RUN, not just reviewed.** The authoring agent
  wired the whole spike but executed nothing (it was a background agent — see
  `background-agents-cant-execute` memory); the never-run code had six classes of latent bug,
  all invisible on read, all obvious on first run. Always execute a spike scaffold.
