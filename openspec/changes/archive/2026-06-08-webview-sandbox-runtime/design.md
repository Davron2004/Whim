## Context

This is the v0.1 build that turns two completed de-risking spikes into **retained** runtime code: the first real Whim mini-app runtime. An untrusted, AI-shaped bundle must run *contained* inside `react-native-webview` (forbidden globals neutralized, the SDK its only capability surface) and *render* UI, round-tripping events to the RN host. The repo is docs-only today — there is no RN app — so this change also bootstraps the first retained React Native shell.

It is not exploratory. Two spikes already answered the load-bearing unknowns and recorded the recipes; this build **consumes them as input** and must not re-litigate them:

- **#35 — the container** (Spike 1, confirmed on Android API 36 / react-native-webview 13.16 / RN 0.85 / React 19, 26/26 probes): a cross-origin sandboxed `<iframe sandbox="allow-scripts">` (**no** `allow-same-origin`) + a **CSP with `script-src 'unsafe-inline'` but no `'unsafe-eval'`** (+ `default-src/connect-src 'none'`, `img-src data:`, `frame-src/child-src/worker-src 'none'`, `base-uri/form-action 'none'`) + a **surgical window-level global strip**. The CSP is load-bearing: it is the *only* leg that closes the `({}).constructor.constructor('…')` codegen hole.
- **#37 — the bundle-execution contract** (Spike 2, confirmed on-device + pen-tested T1–T8 + F4; **REQUIRED READING: `docs/spike2-findings.md`**): the agent emits one TS file importing only `vc-sdk` (`export default defineApp({…})`) → esbuild → **IIFE**; delivery = **channel (b)** (a pre-injected trusted loader inserts the bundle as a DOM-created inline `<script>` via `textContent`, *not* eval); modules = **H1b** host-injected externals `{vc-sdk, react, react-dom}` only; everything else throws. It ships **five load-bearing constraints** the runtime MUST honor (enumerated in D4 below).

The proven reference sources (`invariants/sandbox-isolation/reference/` and `invariants/sandbox-isolation/spike2-bundle-contract/`) and the runnable adversarial suite (T1–T7 + F4) are preserved — this build *productionizes* them rather than re-deriving the technique, and folds the never-regress isolation suite into §16.2.

## Goals / Non-Goals

**Goals:**
- Build the retained RN WebView shell + bundle-execution mechanism, faithfully following **both** recipes: the container (#35) and the contract (#37 / `spike2-findings.md`) — fresh context, surgical global strip, locked CSP, channel-(b) delivery, H1b module resolution.
- Implement the contained render path (React-to-DOM inside the cross-origin sandboxed iframe) and the one-way string transport to the RN host (`window.ReactNativeWebView.postMessage` → host `onMessage`).
- Honor all **five carry-forward constraints** (D4) as actual code, including a realm-reset seam so future re-injection (Spike 8) is safe by construction.
- Ship a thin slice of SDK UI (`Screen`, `Stack`, `Text`, `Heading`, `NumberInput`, `Slider`/`SegmentedControl`, `Button`) + theme tokens + `useState`, enough to run the hand-written **tip splitter** fixture (§15.2 / §15.3).
- Promote the preserved probe checklists into the retained, never-regress **§16.2 isolation suite** that blocks this code if it goes red, and confirm acceptance **on the Android target**, not desktop alone.

**Non-Goals:**
- **No bridge** — no transport dispatcher, RPC envelope, capability registry, or permission gate (§5.6); that is **v0.2**, with storage as syscall #1. v0.1's tip splitter makes **zero syscalls**.
- **No storage, no effects** (`delay`/`interval`), no notifications, no network, no sensors.
- **No server, no LLM, no harness loop** — the esbuild transpile step is a **local** stand-in for the future server build (§4.7); the tip-splitter bundle is hand-written, not model-generated (model reliability is Spike 7).
- **No hot-reload / streaming re-injection UX** (Spike 8) — but the delivery + realm-reset seam must **not preclude** it (constraint #5).
- **No visual design / UI polish** — the thin SDK UI here is a *functional fixture* (it exists to prove the render path), not finished design; the visual language (token values, component look, dark mode) is a **deferred follow-up change** where the frontend-design pass runs against this working runtime.
- No full SDK breadth (only the slice the tip splitter needs), no navigation across screens beyond what `defineApp` describes, no native reconciler (the contract stays backend-agnostic per #11 / §4.6), no perf work beyond confirming the instant-feel ceiling.

## Decisions

### D1 — Runtime topology: RN host → WebView → cross-origin sandboxed iframe → loader → React-to-DOM

The retained stack, top to bottom: **(1)** an RN host screen renders one full-screen `react-native-webview`; **(2)** the WebView document hosts a cross-origin `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) under the locked #35 CSP; **(3)** inside the iframe, the neutralization shim runs **first**, then react/react-dom + `vc-sdk` are injected as host globals, then a **trusted loader** waits for the bundle source over the string transport; **(4)** the loader inserts the bundle as a DOM-created inline `<script>` (channel b); **(5)** the bundle's `defineApp(…)` descriptor is mounted React-to-DOM by the trusted runner. The bundle never knows it is inside an iframe/WebView (sandbox-rendering requirement). *Productionize the proven `neutralize.js` / `runner.js` / `probes.js` reference sources — do not re-invent the shim.*

**Alternatives rejected (settled by spikes, recorded for the next reader):** SES/`lockdown()` (H2) and QuickJS/WASM (H3) — not needed, #35 proved H1. Native reconciler (R2) — more work, *raises* Apple-4.7 risk, deferred (§4.6).

### D2 — Delivery: channel (b) lead, channel (a) wired fallback, blob/data refused

Deliver the IIFE via **channel (b)** — the trusted loader does `script.textContent = src; head.appendChild(script)`. Confirmed on the Android System WebView under the *unmodified* CSP, and it survives re-injection without re-creating the iframe (the Spike-8-friendly choice). Keep **channel (a)** (inline `<script>` baked into `srcdoc`, parser-inserted — also 34/34 on-device) wired as a *characterized* fallback for a future engine that gates DOM-inserted inline scripts. **`blob:`/`data:` `<script src>` is refused** under the locked CSP and stays refused — **never widen `script-src`** (an attacker who can mint a same-origin blob would gain a script surface). Delivery uses **no** `eval`/`Function`/`import()`.

### D3 — Module resolution: H1b, exactly `{vc-sdk, react, react-dom}` resolvable

`vc-sdk` is marked external and resolved to a host-injected global; **react/react-dom are *always* external**, injected once as a single shared instance (mixed React instances break hooks across the runner↔bundle boundary). The resolvable runtime surface is **exactly** `{vc-sdk, react, react-dom}`; every other specifier (`react-dom/server`, `fs`, `child_process`, any third-party) throws. Tiny H1b bundles (~4.5 KiB) also minimize per-generation loose-object count, the version-store-friendly choice for downstream `on-device-snapshot-store` (#36).

**Authoring surface vs. runtime resolution surface (intentional, not an oversight).** D3 fixes only the *runtime resolution* surface — what the injected resolver answers — at exactly `{vc-sdk, react, react-dom}`, and the load-bearing property is that it is a **closed allowlist, never a dynamic resolver** (the SDK is the one capability surface). Whether the *authoring* surface also lets the agent import `vc-sdk/*` subpaths (`vc-sdk/ui`, `vc-sdk/state`) is a **separate, deferred** question: subpaths are still the trusted SDK, so they grant nothing the flat barrel doesn't, and the build step can collapse them into the single `vc-sdk` external (an esbuild resolve rule, `^vc-sdk(\/.*)?$` → external `vc-sdk`) so the runtime surface stays unchanged regardless of which way it goes. **v0.1 emits a single flat `vc-sdk` barrel** (the tip splitter and §15.2 do exactly this), so nothing here depends on the subpath decision — see Open Questions for when it must be settled.

### D4 — The five carry-forward constraints are build requirements, not advice

Every one is load-bearing and pen-test-confirmed; the suite enforces each:
1. **Window-level non-configurable value-strip, never lexical/closure shadow.** Channel (b) runs the bundle — and any `<script>` it self-injects — in *global* scope; only a window-level strip survives a fresh top-level script (blocks T1). Lexical shadowing is kept only as belt-and-suspenders for a global the engine marks non-configurable.
2. **The trusted loader/SDK holds no capability stronger than `parent.postMessage`** — not on `window`, not in any closure reachable from a window-exposed function. The untrusted bundle shares the iframe global scope with them.
3. **Judge containment from a trusted vantage, never the bundle's self-report (F4).** The bundle can overwrite the probe fn and post a forged `contained:true`. Smoke tests and CI invariants run probes from code the bundle cannot tamper with, and/or verify escapes out-of-band.
4. **Authenticate/ignore bundle-origin control messages — don't trust a message by its `kind` (T6).** The bundle can forge any `{__whimHarness:true, kind:…}` frame. Treat all iframe→host messages as untrusted data, never authenticated control.
5. **Re-injection resets/re-hardens the realm (T7).** Re-injecting a generation into the same iframe lets gen-1 pollution (`window` backdoor, `Object.prototype.__whimPwned`, mutated global) persist into gen-2. v0.1 builds the seam — re-create the iframe, or re-strip + re-freeze globals/`Object.prototype` per generation — even though the hot-reload UX is Spike 8.

### D5 — Global strip: productionize the proven surgical shim

Run `neutralizeForbiddenGlobals()` first inside the iframe: `delete`-then-`Object.defineProperty(window, name, {value: throwingStub, configurable:false})` for the value-globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, **`RTCPeerConnection`** — WebRTC is *not* covered by `connect-src`, so the strip is load-bearing here — `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `Worker`, `SharedWorker`, `navigator.sendBeacon`). **`eval`/`Function` are NOT value-replaced** — the CSP kills them at the engine level, and value-replacing `Function` breaks React's `instanceof Function`. The strip is surgical: it preserves the globals the React render path and SDK depend on (sandbox-isolation "surgical, not total" requirement).

### D6 — SDK shape + thin UI slice (just enough for the tip splitter)

`defineApp({ name, initial, screens, capabilities })` returns a plain **AppSpec descriptor** — the *trusted host* decides when/where to mount; the agent's code describes, the host renders. v0.1 implements only the slice the tip splitter needs: `Screen`, `Stack`, `Text`, `Heading`, `NumberInput`, `Slider`/`SegmentedControl`, `Button`, theme tokens (color/spacing/radius/text-size/weight per §5.2), and `useState`. Components accept **tokens, not values** (§5.3) — this is what keeps the contract backend-agnostic and revertible to a native reconciler. `capabilities: []` for the tip splitter (zero syscalls).

These components are a **minimal, functional fixture**: they exist to prove the render path (a control paints, a tap round-trips), not to deliver finished visual design. The token *contract* (tokens-not-values, per #13/§5.3) is the durable part and is set here; the actual visual language — color ramps, component polish, dark mode — is **deferred to a separate follow-up SDK design-system change**, run against this working runtime. Folding the look into this security-critical change would dilute its focus (the §16.2 isolation invariant) and isn't a capability delta this change should own. (Per §16.2: "test-after the UI… build, then pin behavior once settled.")

### D7 — Transport: one-way string pipe each way, all inbound treated as untrusted data

Web→host: `window.ReactNativeWebView.postMessage(string)` received by the host `onMessage`. Host→web: an injected string the iframe hears on a `message` event (used to deliver the bundle source and, later, re-injection). String-only (JSON), asynchronous, one pipe each way (§5.6 transport). The host treats every inbound message as **untrusted data** (constraint #4) — this same pipe carries the future syscall RPC envelope unchanged, so getting the contract right now is load-bearing for v0.2.

### D8 — Local esbuild build step as the server stand-in; source map preserved

A small local `build` step (esbuild: classic JSX `React.createElement`, `format:'iife'`, `vc-sdk`/react/react-dom external) transpiles the hand-written `tip-splitter.app.tsx` to the delivered IIFE — the stand-in for the future server build (warm transpile+bundle ≈ 2–3 ms, negligible). Emit a source map with `sourcesContent` so a thrown error maps to the agent's **original** TS line (D4 of #37); this gates the future §8.1 repair loop. It is wired and verified now even though the repair loop itself is the harness phase.

### D9 — Testing: invariants are sacred; desktop filter, on-device acceptance

Promote `invariants/sandbox-isolation/` (probe checklist) + `spike2-bundle-contract/` (adversarial T1–T7 + F4) into the retained never-regress **§16.2 suite** — *the most important assertion in the codebase: a bundle cannot reach the network or any native capability except through the SDK*. It blocks everything if red. Run the **desktop→device ladder**: headless Chromium (Playwright enforces CSP + iframe sandbox) as a fast first filter, then the **authoritative on-device run** on the Android target (desktop is never the pass — no native bridge, different engine). The containment verdict is computed from a trusted vantage (constraint #3). Invariants are authored here, never by a feature-implementing agent (§16.4).

## Risks / Trade-offs

- **[Productionizing reference code silently regresses a property the spike proved]** → run the preserved adversarial suite (T1–T7 + F4) as a blocking CI gate against the *retained* code, with the verdict from a trusted vantage (constraints #3/#9); a green render with a red probe is a reject.
- **[A future RN/WebView engine upgrade gates channel-(b) DOM-inserted inline scripts]** → channel (a) (parser-inline `srcdoc`) stays wired and characterized; the suite exercises both, so a fallback is a config flip, not a redesign.
- **[Re-injection / Spike-8 hot-reload reintroduces gen-1 pollution]** → build the realm-reset seam now (constraint #5): re-create the iframe or re-strip + re-freeze globals/`Object.prototype` per generation; an *enumerable* `Object.prototype` write additionally DoS-es the next generation's esbuild `__export`, so re-hardening is not optional.
- **[The bundle forges a `contained:true` verdict or a host-bound control frame]** → never trust the in-iframe self-report (constraint #3); authenticate/ignore control messages by content, never by `kind` (constraint #4).
- **[Over-stripping breaks React's render path]** → the strip is surgical (D5); do **not** value-replace `eval`/`Function` (CSP closes codegen); narrow the strip and re-probe rather than broaden it.
- **[Mixed React instances break hooks across the runner↔bundle boundary]** → react/react-dom are always external, injected once as one shared instance (D3).
- **[RN build-environment friction blocks the on-device run]** (the captured DEVLOG gotchas) → pin node **22** (explicit PATH prefix; `nvm use` alone isn't enough), pin Gradle to **JDK 21** (`org.gradle.java.home`, SDKMAN Temurin, no sudo), build **arm64-v8a only** (emulator ABI; ~4× smaller, avoids `INSUFFICIENT_STORAGE`), ship an **offline release bundle** (`--mode release`, debug-signed — the emulator NAT to Metro is dead and `adb reverse` doesn't rescue it), and scrape JS logs from **logcat (`ReactNativeJS`)**, not Metro (RN 0.85 is bridgeless; logcat truncates ~4 KB, so render the full probe JSON on-screen).
- **[Scope creep into the bridge or SDK breadth]** → v0.1 ships render + isolation only; the bridge, storage, and the rest of the SDK surface are v0.2+ (§15.2). The tip splitter makes zero syscalls by design.

## Migration Plan

This is the first **retained** code in the repo (everything prior was doc-only spikes), so there is no in-place data migration — the "deploy" is standing up the RN app + runtime and the on-device acceptance run.

- **Rollback** is clean: revert to docs-only. There are no users, no persisted data, no server.
- **On archive**, this change's two capability specs — `sandbox-isolation` and `sandbox-rendering` — fold into `openspec/specs/` (this is the first change whose deltas legitimately become the system's source of truth). The §16.2 invariant suite becomes the blocking CI gate that guards them.
- **Forward seam:** the transport contract (D7) and the realm-reset seam (D4 #5) are built to carry v0.2 (bridge/storage) and Spike 8 (hot-reload) without rework.

## Open Questions

- **Realm-reset mechanism (constraint #5):** re-create the iframe per generation vs. re-strip + re-freeze in place. v0.1 only needs the *seam*; pick the concrete mechanism now or defer the choice to Spike 8 — but the seam must exist.
- **Thin-slice boundary:** does the tip splitter need `Slider` *or* `SegmentedControl` (or both)? Resolve when writing the fixture; implement only what it uses.
- **Authoring surface — flat `vc-sdk` barrel vs. `vc-sdk/*` subpath namespaces** (D3): deferred on purpose. The runtime resolution surface is closed and fixed *either way*, so this is an SDK-ergonomics call, not an isolation one, and a static checker handles a fixed allowlist as easily as a single name. **Settle it in the SDK design-system change — before the harness phase authors the agent's SDK reference / system prompt, and before any app corpus is generated.** Up to and including v0.3 every bundle is hand-written single-barrel, so deferring costs nothing; once the agent emits imports at scale, the chosen style is baked into generated artifacts (snapshotted in the version store, #36) and the model's tuning (#25), and changing it becomes a migration. That start-of-harness boundary is the hard deadline; the SDK-surface change is the natural place to make the call with the real surface in hand.
- **Source-map round-trip in v0.1 scope:** wire and verify now (D8) vs. defer to the harness phase. Leaning *verify now* — it is cheap and the contract is fresh — but it is not required for the render path to pass.
- **Floating "back to host" affordance overlap (§10, [OPEN]):** out of scope for this change; noted so it isn't forgotten when the launcher lands.
