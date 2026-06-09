> **STATUS NOTE (acceptance honesty).** The environment this spike was implemented in
> **blocked all command execution** (npm, esbuild, node scripts, gradle, adb, the
> emulator — even `node -e` and `node --version` were denied; only a tiny allowlist
> like `node -v` passed). So **nothing was executed**: not the on-device pass (D6), and
> not even the Node checkpoint *run* (D6 checkpoint). Every task below whose deliverable
> is *spike code / an artifact* is authored, wired, and ready to run — marked `[x]`.
> Tasks whose completion REQUIRES executing on the engine are marked `[~]` (wired, not
> run) with a note. The numbers in decisions.md #37 marked *(predicted)* are reasoned
> from the locked-CSP semantics + the Spike-1 (#35) evidence, NOT measured. The
> pen-tester must run `spikes/bundle-contract` to convert `[~]` → `[x]`.
>
> **UPDATE (foreground run, 2026-06-07).** The Node-side chain has now been **executed**
> green in the foreground (the env blocked the *background* agent, not the main loop).
> Three authoring bugs were found + fixed in the process: (1) a leaked `</content>`
> wrapper tag at the end of **all 25 files** (broke every parse — stripped); (2) esbuild
> `write:false` with no `outdir` collapsed output to `<stdout>` and lost the source map
> (added `outdir`); (3) the source-map checker derived the throw line from a `new Function`
> stack with a V8 header offset and false-negatived — rewrote it to locate the throw
> deterministically. Now MEASURED (was *predicted*): H1a **8.6 KiB** vs H1b **5.0 KiB**
> (Δ3.5), warm transpile **~2.2 ms** (≪300 ms), D4 maps the throw to the exact original
> line, static-check emits original-line findings. **Still pending = the on-device pass
> (D2/D5/D6):** the headline "does the Android System WebView run a DOM-inserted inline
> script under the locked CSP" is unanswered until the APK runs on the emulator.
>
> **UPDATE 2 (desktop shakeout, 2026-06-07).** Per the chosen "desktop shakeout → device"
> plan, all generated channel pages were run in **headless Chromium** (Playwright — which
> enforces CSP + the iframe sandbox) as a fast pre-device filter. This caught a batch of
> authoring bugs that had never executed: **(A)** `tsconfig jsx:"react-jsx"` overrode the
> intended classic transform → bundles emitted `require("react/jsx-runtime")` the iframe
> resolvers didn't handle (fixed → `jsx:"react"`); **(B)** a *placeholder/prose collision*
> class — `fill()` blindly replaced `__TOKEN__` wherever it appeared, incl. the templates'
> own HTML doc-comments (injected 578 KB of React into a comment), two error-message
> strings, and a JS `//` comment that contained `__PROBES__` (fixed: strip HTML comments
> before fill + reword the 3 prose mentions); **(C)** probe-logic bugs — inverted vc-sdk
> assertion, over-strict `require('react')`-must-throw (react/react-dom are host-injected
> externals, no authority), and a false-positive on the runner's benign `module/exports`
> CJS shim (fixed: resolvable surface = {vc-sdk, react, react-dom}; real Node-leak check is
> ambient `process`; vc-sdk probe is SDK-mode-aware). **DESKTOP RESULT (checkpoint, NOT the
> pass):** baseline 23/23; channel (a) and channel (b, the lead) both **CONTAINED ✓ 31/31**
> with both negative controls firing; channel (c)-unmodified correctly **REFUSES** the blob
> (CSP held), c-widened runs (the reject-signal). The headline DOM-inserted-inline-script
> gating (channel b) + T2 native-bridge reach are **engine-specific** and still require the
> Android run — but the channels, delivery, resolver, probes, and source maps are now all
> shaken out. Tooling: `build/desktop-shakeout.mjs` (+ Playwright, kept per user request).
>
> **UPDATE 3 (ON-DEVICE PASS — D6 reached, 2026-06-07).** Built an offline release APK
> (RN 0.85.3, `WhimSpike2/`, arm64-only, debug-signed + debuggable, JDK 21 via SDKMAN
> Temurin — no sudo install) and ran it on the **Android System WebView** (Pixel API
> emulator). **THE HEADLINE D2 UNKNOWN IS ANSWERED: yes** — a DOM-inserted inline
> `<script>` (channel b) executes under the *unmodified* #35 CSP on this engine, the app
> renders, and containment holds. Results: baseline 23/23; **b-h1a 31/31** (paint 95.9 ms),
> b-h1b 31/31, a-h1a 31/31, a-h1b 31/31 (paints 22–50 ms) — all CONTAINED, host/native
> reach blocked, both negative controls firing; **c-unmodified: blob REFUSED** (DELIVERY
> `accepted:false`, CSP held on the real engine — reject-signal confirmed). **Decision:
> channel (b) is the delivery mechanism** (re-injection-friendly, Spike 8), channel (a) the
> proven fallback, blob (c) dead under the locked CSP. Remaining: the **pen test (T1–T4)**
> — the adversarial pass on top of D5 — then record #37 as DECIDED + delete-code approval.
>
> **UPDATE 4 (PEN TEST — complete, on-device, 2026-06-07).** T1–T4 added as trusted probes
> (run in the delivered bundle's exact scope → 34/34) AND a malicious **evil-app** bundle
> (`fixtures/evil-app.app.tsx`) was delivered end-to-end through channel (b) on the emulator.
> **Every escape blocked on-device:** T1 self-injected fresh `<script>` (fetch/xhr/ls →
> TypeError, eval → EvalError — window-level strip holds in a fresh scope), T2 host/native
> reach (SecurityError; only the loader's `parent.postMessage` stub, no native bridge), T3
> SDK-prototype → Function-ctor (EvalError), T4 all codegen (EvalError). **Finding F4
> confirmed on-device:** the evil app forged its OWN containment verdict (posted
> `contained:true 999/999`, empty probes — the host displayed it as a pass) while every real
> attack was blocked → the production harness must judge containment from a trusted vantage,
> never the bundle's self-report. **DECISION SURVIVES THE PEN TEST.** #37 is now DECIDED.
> Three carry-forward constraints recorded in #37. Spike code + `WhimSpike2/` retained;
> deletion remains gated on user approval. Tooling kept: `build/desktop-shakeout.mjs`,
> Playwright, the `WhimSpike2` RN host.

## 1. Rebuild the Spike-1 substrate (the contract must be proven against the real sandbox)

- [x] 1.1 Stand up a throwaway RN screen with one `react-native-webview` in a scratch dir — mark it clearly as spike code, NOT the v0.1 runtime  → `spikes/bundle-contract/rn-substrate/App.tsx` (+ README marks the whole dir as throwaway)
- [x] 1.2 Recreate the **exact** #35 container: sandboxed cross-origin `<iframe>` (`allow-scripts`, NO `allow-same-origin`), CSP `script-src 'unsafe-inline'` **without** `'unsafe-eval'` (+ `default-src 'none'`/`connect-src 'none'`), surgical global strip, one-way string transport both ways  → `web/container.template.html` + `web/neutralize.js` + the transport shims in each channel HTML; CSP string in `build/gen-webview-assets.mjs` (`CSP_35`)
- [x] 1.3 Pull the `invariants/sandbox-isolation/` probe checklist into the substrate so it can be re-run against a *delivered* bundle later (D5)  → `web/probes.js` (adapted: `vc-sdk` name + a delivery-path negative control)
- [x] 1.4 Confirm the substrate still passes the Spike-1 probes with the old hand-injected bundle (baseline before changing delivery)  → BASELINE WIRED: `baseline.handinjected.html` (the preserved invariants probe, verbatim) is generated as a channel tab; RUN ✓ on-device

## 2. Emit format + transpile (Node checkpoint, not the pass)

- [x] 2.1 Define the emit format: one file, `export default defineApp({ name, initial, screens, capabilities })`, importing from `vc-sdk` (§5.2). Write it down with a one-line example  → `fixtures/vc-sdk/*` (the surface) + the one-line example recorded in decisions #37
- [x] 2.2 Hand-write the **tip splitter** fixture (§15.3) in that format against a small real §5.2 slice (`defineApp`, `Screen`/`Stack`/`Text`/`Button`/`NumberInput`/state) — pure Layer-1 compute + rendering, zero syscalls  → `fixtures/tip-splitter.app.tsx`
- [x] 2.3 Stand up a small **local** esbuild transpile+bundle step (the stand-in for the future server step — NOT real harness infra); produce one JS string from the TS fixture  → `build/build.mjs` (IIFE output, both H1a/H1b)
- [x] 2.4 Run the bundled string in plain Node as the cheap correctness checkpoint  → **RUN GREEN** (foreground): `build/node-checkpoint.mjs` renders the initial screen via react-dom/server, tip math 100@20%/4 → tip $20 / total $120 / per-person $30, 6/6 PASS. (Node checkpoint, not the on-device pass. NOTE: the script's "The PASS is on-device (D6)" log line is wrong/misleading — it's a Node render.)

## 3. Delivery under the locked CSP (the load-bearing part — on the RN target)

- [x] 3.1 Channel (a): bake the JS string into an inline `<script>` in the iframe `srcdoc`; confirm it executes and renders under the UNMODIFIED #35 CSP on the Android target  → WIRED: `web/iframe-srcdoc-a.html` → `channel-a.*`; RUN ✓ on-device
- [x] 3.2 Channel (b): tiny pre-injected loader; post the bundle source over the host→web string transport; loader inserts it as a DOM-created **inline** `<script>` (`textContent`, not eval); confirm it executes AND that the RN WebView engine does NOT gate DOM-inserted inline scripts (the key engine-specific unknown)  → WIRED: `web/iframe-loader-b.html` → `channel-b.*`; THE HEADLINE UNKNOWN — ANSWERED on-device ✓ (DOM-inserted inline script DOES run under the locked CSP)
- [x] 3.3 Channel (c): try `blob:`/`data:` `<script src>`; note it requires WIDENING `script-src`; record the containment cost and treat widening as a reject signal  → WIRED: `web/iframe-blob-c.html` builds BOTH `channel-c.unmodified` (expects refusal) + `channel-c.widened`; reject-signal documented; RUN ✓ on-device
- [x] 3.4 Confirm none of the channels works via `eval`/`new Function`/`import()` (those must still throw/reject)  → WIRED: probes assert eval/Function/import() all throw/reject; channels deliver via inline-script text, never eval; RUN ✓ on-device
- [x] 3.5 Pick the channel that executes AND keeps the iframe cross-origin; record which support re-injection without re-creating the iframe (feeds Spike 8)  → RECOMMENDATION recorded in #37: (b) is the lead (re-injection-friendly), (a) the safe fallback, (c) reject; FINAL pick is conditional on the on-device 3.2 result

## 4. Module resolution + SDK presence (D3)

- [x] 4.1 H1a: bundle the SDK *into* the output; confirm self-contained string runs with no runtime resolution; record bundle size  → **MEASURED**: `tip-splitter.h1a` = **8.6 KiB** (self-contained IIFE; react/react-dom external). Builds clean.
- [x] 4.2 H1b: mark `vc-sdk` external, resolve it to a host-injected global; confirm the import rewrites to the injected surface and runs; record bundle size  → **MEASURED**: `tip-splitter.h1b` = **5.0 KiB** + `vc-sdk-global.js` injected global + per-channel resolver. (Runtime resolution to the injected global is the part still pending on-device verification.)
- [x] 4.3 Confirm `vc-sdk` is the ONLY thing that resolves — a non-SDK import/require still fails  → WIRED: resolver throws for anything but `vc-sdk`/react; probes assert `require('react'|'fs'|'axios')` throw; `bad-app.example.tsx` is the negative fixture; static-check flags non-SDK imports
- [x] 4.4 Compare H1a vs H1b bundle sizes; note the per-generation loose-object impact for `on-device-snapshot-store` (#36); recommend H1b if tiny bundles hold up  → **MEASURED**: H1a 8.6 KiB vs H1b 5.0 KiB, Δ **3.5 KiB** (the vc-sdk slice H1b lifts out). H1b is the tiny-bundle / version-store-friendly choice → **recommend H1b** for #36 loose-object pressure.
- [x] 4.5 Quick probe: confirm H3 (ESM + import map) is dead under the CSP — verify and drop, don't measure  → DROPPED with rationale: `web/H3-import-map-is-dead.md`; the `import()`-rejects probe is the single on-device verification

## 5. Source maps + the §8.1 diagnostic hook (D4)

- [x] 5.1 Emit a source map from the transpile+bundle step  → `build.mjs` sets `sourcemap:true`, `sourcesContent:true`; emits `*.js.map`
- [x] 5.2 Throw a deliberate error from a known line of the *original* TS; confirm the position maps back to that original line  → **RUN GREEN**: the bundle throws at runtime AND the generated throw position (gen line 157) maps **exactly** to `throw-fixture.app.tsx:11`. (Checker was rewritten to locate the throw deterministically by marker — the original `new Function`-stack approach false-negatived on a V8 header offset; an artifact of the Node test, not on-device.) D4 line-accuracy holds.
- [x] 5.3 Confirm an AST/parse-level finding (the §8.1 static-check shape) can be reported with the original line number  → **RUN GREEN**: `build/static-check.mjs` on `bad-app.example.tsx` emits 6 findings (non-sdk imports fs/axios @7; forbidden globals fetch@11, localStorage@12, eval@13, document@14), each carrying the correct **original** line.

## 6. Re-prove containment under the real delivery (D5)

- [x] 6.1 Re-run the relevant probe-checklist subset against the *delivered* bundle: forbidden globals throw/inert, prototype-walk codegen still `EvalError`s  → WIRED: `web/probes.js` runs in the SAME scope as the delivered bundle in every channel; RUN ✓ on-device
- [x] 6.2 Re-probe host/native reach (`parent`/`top`/`frameElement`); confirm the only crossing is `parent.postMessage`  → WIRED: reach probes present; RUN ✓ on-device
- [x] 6.3 Inject one deliberate escape via the new delivery path (a loader that tries to leak a host ref) and confirm the probes catch it  → WIRED: probes' delivery-path negative control (`__WHIM_DELIVERY_LEAKED_HOST__`) + `deliveryLeakCaught` gate; RUN ✓ on-device

## 7. Latency + format sanity

- [x] 7.1 Measure transpile+bundle latency for the small app; confirm it is a small fraction of expected model latency (~300 ms ceiling)  → **MEASURED**: warm transpile+bundle ~**2.2 ms** (slowest of the three targets) — far under the ~300 ms ceiling. H1-over-H2 holds on latency grounds; build cost is negligible vs seconds of model latency.
- [x] 7.2 Sanity-check by hand that the chosen emit format is something a model could plausibly emit consistently  → DONE by hand: the format is ordinary idiomatic React/TS (imports + components + one default export); assessment recorded in #37 (full verification is Spike 7)

## 8. Record the lesson, then delete the code

- [x] 8.1 Write the artifact into `docs/decisions.md`: emit format (+ one-line example), delivery-under-CSP mechanism, where transpile happens + measured latency, module resolution + H1a/H1b call, source-map approach, re-containment confirmation  → `docs/decisions.md` #37 (with *(predicted)* clearly marked where not measured)
- [x] 8.2 Add a `DEVLOG.md` capture entry with the same lesson plus dead ends / "I was wrong about X"  → `DEVLOG.md` Spike 2 section
- [x] 8.3 If H1 was rejected, record the failure and the move to H2  → H1 NOT rejected on analysis (H1 is recommended); the H2-fallback triggers + the conditional are recorded in #37 / DEVLOG; final confirmation is gated on the on-device run
- [x] 8.4 **Spike code DELETED (2026-06-07)** — after the decision survived T1–T8 + F4 pen testing and the user approved. The runnable adversarial suite (T1–T7 + F4: self-contained pages + a headless Playwright runner) was **preserved** at `invariants/sandbox-isolation/spike2-bundle-contract/` as the Spike-6 CI seed (`npm test` → all invariants held). Lessons: `docs/spike2-findings.md` + `docs/decisions.md` #37 + `DEVLOG.md`; `webview-sandbox-runtime` builds the real mechanism from that recipe + the 5 constraints.
</content>
