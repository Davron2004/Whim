# Whim — DEVLOG

*Cheap, continuous capture (Decision #30). Raw lessons, dead ends, and "I was wrong
about X" — the stuff that evaporates within days. Curated milestone posts get edited
out of this later; this is the capture layer, not the publish layer.*

---

## Spike 1 — sandbox runtime (`spike-sandbox-runtime`)

**Result:** H1 + R1 confirmed on the real Android System WebView. An untrusted
bundle runs contained (forbidden globals gone, `{ Button }` SDK as the only
capability) and still renders + round-trips a tap to the RN host. 26/26 probes
pass, `contained:true`, mount→first-paint ≈104 ms cold / ≈12 ms warm. Full write-up
in `docs/decisions.md` #31; probe checklist preserved at
`invariants/sandbox-isolation/`.

### The one real lesson
**CSP is load-bearing, and "strip the globals + inject the SDK" is necessary but
not sufficient.** I started to neutralize `eval`/`Function` the same way as
`fetch` — overwrite the global with a throwing stub. Two things were wrong with
that:
1. It **over-strips** (violates D3). React's internals do `x instanceof Function`
   and touch `Function.prototype`; replacing the `Function` global by value breaks
   the render path. You must strip the *capability*, not the *identifier*.
2. It **doesn't even work** for the thing that matters. Deleting `window.Function`
   does nothing about `({}).constructor.constructor('…')` — every object reaches
   the Function constructor through its prototype chain. The only thing that closes
   that hole is a CSP `script-src` without `'unsafe-eval'`, which makes codegen
   throw `EvalError` at the engine level no matter how you reach it.

So the containment recipe is three legs, not one: cross-origin iframe (no
`allow-same-origin`) for host/native isolation, CSP-without-unsafe-eval for codegen,
and a *surgical* value-strip for the named network/storage/threading globals. The
#11/#12 "sandboxing is basically free" framing is mostly true but undersold how much
of the load CSP carries — it's free *if you remember the CSP*.

### Dead ends / friction (spike scaffolding, not the finding)
- **Node 26** is too new for the RN toolchain — pinned everything to nvm **node 22**.
- **JDK 24** (the only `java_home`-registered JVM) failed `:app:configureCMakeDebug`
  with "A restricted method in java.lang.System has been called" (JDK 24's stricter
  native-access enforcement vs RN's C++ codegen). Fixed by pinning Gradle to
  **JDK 21** via `org.gradle.java.home`.
- The debug APK packaged **all 4 ABIs (~115 MB)** and `INSTALL_FAILED_INSUFFICIENT_
  STORAGE` on a near-full emulator `/data`. Restricting to `reactNativeArchitectures
  =arm64-v8a` (the emulator's ABI) shrank it ~4× and it installed.
- **The emulator's NAT to the Metro host was dead** — `10.0.2.2:8081` "Network is
  unreachable", no default route, and it's a Play-Store image so `adb root` is
  denied (can't fix the route). Rather than fight the dev server, I built an
  **offline release bundle** (`--mode release`, debug-signed, `debuggable true`) so
  there's no Metro/network dependency at all — appropriate, since the spike's unknown
  is the WebView engine, not the dev server.
- **I was wrong that RN `console.log` reaches the Metro terminal** — that's old-arch
  behavior. RN 0.85 is bridgeless/new-arch: JS logs go to **logcat (`ReactNativeJS`)**,
  not Metro stdout. Switched capture to `console.error` → logcat. And **logcat
  truncates lines at ~4 KB**, so the full 26-probe JSON doesn't survive a log line —
  the on-screen render (which parses the JSON in-app) is the source of truth for the
  full result; logcat is fine for the shorter messages.

---

## Spike 4 — on-device git versioning (`spike-git-versioning`)

**Result:** **H2 accepted.** `isomorphic-git` (1.38.4) loads and runs under **Hermes**
(RN 0.85, new arch) on-device and does the whole versioning lifecycle — snapshot,
history, rollback, pin, fork, diff — with **0 failures**, no merge ever needed, and
no git vocabulary leaking to the surface. Full write-up in `docs/decisions.md` #36;
evidence screenshot `docs/spike4-android-result.png`. Numbers: ~650 B + ~4 git
objects per generation, 130 KB/812 objects at 200 gens; snapshot 2.5 ms, rollback
166 ms, log 46 ms (deep history); manual `packObjects` compaction works (28 KB pack
for 200 commits).

### The one real lesson
**Under Hermes, `Buffer` is not the whole polyfill story — `TextDecoder` is missing
*while* `TextEncoder` is present.** I predicted `Buffer` (correct, the big one) and
flagged TextEncoder/Decoder as "verify." The device verdict was sharper than expected:
Hermes/RN 0.85 ships `TextEncoder` natively but **not** `TextDecoder`, so the app
booted, rendered, and then died at `new TextDecoder()` with
`ReferenceError: Property 'TextDecoder' doesn't exist`. You can't reason about which
half ships from first principles — you have to probe the real engine. The minimal
working set is **`buffer` + `text-encoding-polyfill` + a 3-line `process` shim**,
imported before isomorphic-git. `crypto.subtle` is also absent but costs nothing:
isomorphic-git auto-falls-back to pure-JS `sha.js`. And `fs` is *injected*, never
`require`d, so there's no fs polyfill — the FS backend is just the param.

The other keeper: **the top risk was the right risk, but the framing was off.** The
fear was storage *bytes*; the actual pressure is **loose-object count** — isomorphic-git
has **no `git.gc`/`prune`/`repack`**, so every snapshot leaves ~4 loose objects forever.
650 KB at 1000 gens is nothing; ~4000 tiny key-files in an MMKV-backed FS is the thing
to manage. Compaction is DIY but proven (`packObjects` on-device), so v0.2 owns a
periodic pack-then-drop-loose pass.

### Dead ends / friction (spike scaffolding, not the finding)
- **`nvm use 22` didn't actually switch node** — `/opt/homebrew/bin` sits *ahead* of
  the nvm shim in PATH, so Homebrew's node 26 kept winning even after `nvm use`. Had to
  explicitly `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"` on every RN
  command. (The node-22 pin only matters for the RN/Metro toolchain; the plain
  isomorphic-git Node proof ran fine on 26.)
- **`adb reverse` does NOT rescue Metro on this emulator.** I hoped adb-level port
  forwarding would sidestep the dead-NAT from Spike 1, and `adb reverse --list` showed
  the mapping registered — but the bridgeless host still reported `isMetroRunning=false`
  / "Unable to load script". The NAT death is deep enough that even reverse-forwarded
  Metro doesn't connect. The Spike-1 recipe stands: **build an offline release bundle**
  (`assembleRelease`, debug-signed, `debuggable true`) and stop fighting the dev server.
  Release also means the JS runs as real Hermes bytecode — *more* representative, not less.
- **`adb` came up `offline` twice during boot** — needed `adb kill-server && adb
  start-server` *after* the device finished booting (not just at launch) before it
  flipped to `device`. Same Play-Store-image flakiness as Spike 1.
- **De-risked the in-memory fs in Node first.** The fs shim uses the same isomorphic-git
  calls as the device, and Node has Buffer/TextDecoder globally — so I validated fs
  correctness against real isomorphic-git in plain Node before the (slow) device build.
  That left *only* Hermes-specific issues for the device, which is exactly how the
  TextDecoder gap surfaced cleanly instead of tangled up with an fs bug.

---

## Spike 2 — bundle / module contract (`spike-bundle-contract`)

**Result: H1 ACCEPTED — confirmed on the real Android System WebView + pen-tested.** The
recommendation is **H1 + channel (b) + H1b**: agent emits TS → esbuild bundles to an IIFE
→ a pre-injected loader inserts it as a **DOM-created inline `<script>`** (`textContent`,
not eval) → `vc-sdk` resolves to a host-injected global. On-device: baseline 23/23; channel
(b) lead **34/34 CONTAINED** (paints 22–96 ms), channel (a) 34/34, both h1a/h1b; `blob:` (c)
REFUSED under the unmodified CSP. Pen test (T1–T4): a malicious "evil app" delivered through
channel (b) had **every escape blocked on-device**. Full write-up + the three carry-forward
constraints in `docs/decisions.md` #37.

**The authoring agent wired everything but ran ZERO of it** (its environment denied npm/
esbuild/gradle/adb/even `node -e`), so the foreground run was really a *bug-hunt on
never-executed code* — and that's the keeper lesson: **"wired and reviewed" is not
"works."** Six classes of latent bug only surfaced on execution: a leaked `</content>`
wrapper tag in **all 25 files** (broke every parse); esbuild `write:false` with no `outdir`
silently collapsing output to `<stdout>` and dropping the source map; a source-map checker
that false-negatived on a `new Function` V8 header offset (the map was fine — the *test*
was wrong); `tsconfig jsx:"react-jsx"` quietly overriding the build's classic transform
(emitting `react/jsx-runtime` requires the resolver didn't handle); a **placeholder/prose
collision** where the template's `fill()` replaced `__TOKEN__` wherever it appeared —
including inside HTML doc-comments, error-message strings, and a JS `//` comment (it
injected 578 KB of React into a comment); and four probe-logic bugs. None were visible by
reading; all were obvious on the first run. Spike scaffolds must be *run*, not just wired.

**The desktop→device ladder paid for itself.** Running the generated channel pages in
headless Chromium first (it enforces CSP + the iframe sandbox) shook out every bug above in
seconds, where finding them via the ~30 s APK rebuild cycle would have been miserable.
Desktop is NOT the pass (no native bridge, different engine) — but as a *first filter* it
turned a long device-debug slog into one clean on-device confirmation run.

### The one real lesson (reasoned, pending confirmation)
**The CSP that closes codegen also dictates the delivery channel — and the channel that
both runs AND survives re-injection delivers source as a *DOM-inserted inline script*,
not eval and not a module.** Walk it: `'unsafe-eval'`-absent kills `eval`/`Function`/
constructor-walk → can't `eval(src)`. No module loader + `import()` rejects → ESM/import
maps (H3) are dead, so the emit must be an **IIFE** (plain inline-executable text), not
an ES module. `connect-src 'none'` + opaque origin → can't fetch a script. What's left
that `'unsafe-inline'` *does* permit is an **inline `<script>`** — either baked into
`srcdoc` (channel a, parser-inserted) or inserted at runtime via `script.textContent =
src; head.appendChild(script)` (channel b, DOM-inserted). (b) is the lead because it
alone survives re-injection without re-creating the iframe (Spike 8). The CSP didn't
just constrain *containment* — it picked the *delivery mechanism* for us.

### The headline UNKNOWN — now ANSWERED on-device: YES
**Does the RN WebView engine gate DOM-inserted inline scripts the same as parser-inserted
ones?** It was the one thing that couldn't be assumed from desktop (some engines treat
*dynamically-inserted* inline scripts differently from *parser-inserted* ones). **On the
Android System WebView the answer is yes** — a `script.textContent = src; head.append(s)`
inline script runs under the unmodified #35 CSP, the app renders (95.9 ms first paint), and
containment holds 34/34. So channel (b) — the re-injection-friendly lead — is viable on the
real engine; channel (a) (parser-inserted, also 34/34) stays as the fallback if a future
engine ever gates dynamic insertion.

### The pen test taught two things the probe suite alone wouldn't have
- **T1 (the channel-(b)-specific escape) is blocked because the strip is window-level.** A
  malicious app can use the *same* DOM-inserted-inline-script trick the loader uses to run
  code in a fresh top-level scope. That fresh scope does NOT get channel (a)'s lexical
  shadowing — so containment rides entirely on the strip being a **window-level
  non-configurable value-strip** (which a fresh `window.fetch` lookup still hits) rather
  than a closure shadow. On-device, the evil app's self-injected script got `fetch`/`xhr`/
  `localStorage` → TypeError and `eval` → EvalError. **Carry-forward constraint: the real
  runtime's strip must stay window-level, never lexical.**
- **F4 — a contained app can still LIE about being contained.** The probe suite runs in the
  bundle's own scope, so a malicious app overwrote `__whimRunProbes` and posted a forged
  `contained:true 999/999` that the host displayed as a pass — while every *actual* escape
  was blocked. The sandbox held; the *self-report* didn't. **Carry-forward constraint: the
  production harness (Spike 3 smoke test, Spike 6 CI) must judge containment from a trusted
  vantage the bundle can't overwrite, never from the bundle's self-reported verdict.**

### Things I had to get right while building (so the result is trustworthy, not scrappy)
- **One React instance, or hooks break.** First instinct was to let H1a "bundle
  everything in" including react. Wrong: the trusted runner mounts the bundle's screen
  component, so runner-React and bundle-React must be the *same* instance or
  `useState` blows up across the boundary. Fix: react/react-dom are **always external**
  (host-injected globals); the H1a/H1b axis is *only* about `vc-sdk`. This also happens
  to be the realistic shape (react is the runtime, injected once) and the bigger #36
  loose-object win.
- **Classic JSX, not automatic.** The automatic runtime imports `react/jsx-runtime`
  whose `jsx`/`jsxs` aren't reliably on a React global; classic JSX
  (`React.createElement` via esbuild `inject`) uses what *is* on the global. Smaller
  surface, fewer ways to be wrong under external-react.
- **React 19 dropped UMD builds.** Planned to inline `react/umd/*.min.js`; they don't
  exist in react@19. Switched to building my own `react-globals.js` IIFE via esbuild
  (`window.React = require('react')`) — version-agnostic, no UMD dependency.
- **Channel (b)/(c) run probes in *global* scope, so they need a global `require`.**
  Channel (a) splices the bundle into a shadowed function scope (lexical `require` in
  scope, like Spike 1). But a DOM-inserted top-level script runs in *global* scope — no
  lexical shadowing, and bare `require('vc-sdk')` in the probes needs a `window.require`.
  Containment still holds because neutralize.js value-strips on `window` (shadowing was
  only belt-and-suspenders for non-configurable globals, of which #35 found none) — but
  it's a real scope difference between the channels worth flagging for the pen-test.
- **Source maps without a dependency.** Wrote a self-contained VLQ decoder for the D4
  check rather than pull in `source-map` — keeps the throwaway spike dep-light and the
  mapping logic auditable.

### Build gotchas — unchanged from Spikes 1 & 4, pre-wired into `rn-substrate/README-RUN.md`
node 22 (explicit PATH prefix, `nvm use` isn't enough), JDK 21 (`org.gradle.java.home`),
arm64-v8a only, offline release bundle (Metro/NAT dead; `adb reverse` doesn't rescue it),
logs → logcat `ReactNativeJS` (truncates ~4 KB → full probe JSON renders on-screen).
None re-discovered — they're carried forward by reference.

### T5–T8 follow-up — the keeper lesson: re-injection persistence (T7)
Confirmed on-device (43/43 still CONTAINED throughout): T5 (module confinement) and T6
(transport eavesdrop/spoof) held — though T6 generalized F4: a bundle can forge **any**
host-bound control frame, so the host must authenticate/ignore bundle-origin messages, not
trust them by `kind`. **T7 is the real find:** channel (b)'s selling point — re-injecting a
new generation into the *same* iframe without re-creating it — means generation-1 pollution
(a `window` backdoor, `Object.prototype.__whimPwned`, a mutated global) **persists into
generation 2**. Containment isn't breached (persistence ≠ escape), but it means gen N can
backdoor gen N+1 → **Spike 8 must reset/re-harden the realm per generation.** A sharp
sub-lesson while building the T7 fixture: an *enumerable* `Object.prototype` write doesn't
just persist, it **DoS-es the next bundle's init** — esbuild's `__export` does
`for(k in all) defineProperty(t,k,{get:all[k]})`, so the inherited enumerable key crashes
with "Getter must be a function." (Made the poison non-enumerable so gen-2 loads and the
trusted victim probe can confirm inheritance cleanly.) And the T8 note: the spike's
token-scan static check **misses prototype/globalThis-alias pollution** — the §8.1 AST
checker must close that. Full constraint list (5 now): `docs/spike2-findings.md`.

---

## v0.1 — `webview-sandbox-runtime` (the first RETAINED build)

**Result: on-device acceptance PASSED on the Android System WebView (Chromium 133, API 36
arm64 emulator).** The two spikes are now retained runtime code: a real RN 0.85.3 / Hermes /
new-arch / React 19 shell renders one full-screen `react-native-webview` that loads a self-
contained document (cross-origin `sandbox="allow-scripts"` iframe under the locked #35 CSP).
The tip-splitter (hand-written `fixtures/tip-splitter.app.tsx`, esbuild → a 4.5 KiB IIFE) is
delivered over channel (b) and mounted React-to-DOM. On-device logcat (`ReactNativeJS`) +
the on-screen probe JSON:

```
[whim] delivery {accepted:true, generation:1, note:"DOM-inserted inline script appended…"}
[whim] paint    {generation:1, mountToFirstPaintMs:119.1, appName:"Tip Splitter"}  # first cold
[whim] CONTAINED=true 42/42 T7anyPoison=false
…after "Reset realm" (fresh iframe, gen 1 again): paint 32.3 ms, CONTAINED 42/42
```

### Perf (task 5.4 / 8.4) — on the arm64 emulator, headless SwiftShader software-GL
- **mount→first-paint ≈ 119 ms** on the very first cold render (RN just booted, WebView/
  Chromium sandbox process cold-starting), **≈ 32 ms** on a re-created realm (warm WebView).
- Both under the ~150 ms "feels instant" ceiling, and this is **software** GL — hardware GL
  on a real device should be faster (consistent with Spike 1 ≈104 ms / Spike 2 ≈95 ms cold).

### What held on-device (the §8 acceptance, 42/42 probes CONTAINED)
- **sandbox-isolation (8.2):** network (`fetch`/XHR/WS/`sendBeacon`), codegen (`eval`/
  `Function`/`({}).constructor.constructor`/`import()`), and persistence/threading
  (`localStorage`/`indexedDB`/`Worker`) all throw or are inert; `parent`/`top`/`frameElement`
  yield no host/native handle; prototype-walk reaches nothing; only `{vc-sdk,react,react-dom}`
  resolve, everything else throws.
- **sandbox-rendering (8.1/5.x):** the tip splitter paints; a tap on the SDK `Button` posts
  `{__whimUiEvent:true,type:"press",label:"Reset"}` through `window.ReactNativeWebView.post-
  Message` → the page relay → the RN host `onMessage` (the round-trip), confirmed in logcat:
  `[whim] ui-event {…label:"Reset"}` and the host bar's "last tap: press 'Reset'".
- **F4 / constraint #4 negative control (8.3):** delivering the `evil` bundle (the native
  "Deliver evil" button) reproduced the forge — `[whim] REJECTED forged frame kind=probes`
  (its fake 999/999) **and** `kind=spoof-probe` — while the **trusted-vantage** verdict
  (closure-captured probe fn, constraint #3) still reported `CONTAINED=true 42/42`. The host
  authenticates loader frames by a per-realm secret **nonce** the bundle never sees, so a
  bundle sharing the iframe scope cannot forge an accepted control frame.
- **realm-reset seam (constraint #5):** "Reset realm" re-creates the iframe (fresh realm,
  fresh nonce) → gen-2 sees no gen-1 pollution. The desktop suite reproduces both the T7
  finding (same-realm re-injection → `anyPoison=true`, containment still holds) and the fix
  (reset → `anyPoison=false`).

### Two real bugs the runs caught (wired ≠ works, again)
1. **esbuild silently used the AUTOMATIC JSX runtime** (`require("react/jsx-runtime")`) —
   it auto-discovers `tsconfig.json` (`jsx:"react-jsx"`) and that overrode the build's
   `jsx:'transform'`. `react/jsx-runtime` is off the H1b allowlist, so the resolver threw at
   runtime and nothing rendered. Fix: `tsconfigRaw:'{}'` on the app-bundle build so the
   explicit classic-JSX flags win. Caught only by running the suite, invisible on read.
2. **WebView taps via `adb input tap` need the right screen coords** — not a code bug, but a
   reminder the device run is the oracle: the native buttons (higher on screen) fired first
   and proved input delivery before the in-WebView button coords were dialed in.

### Build env — the gotchas held exactly as captured (none re-discovered)
node 22 on PATH for the Gradle JS-bundle step (node 26 is the machine default), JDK 21 via
`android/gradle.properties` `org.gradle.java.home` (machine default is JDK 24, which the RN
0.85 plugin rejects), `reactNativeArchitectures=arm64-v8a` only, **offline release bundle**
(`./gradlew :app:assembleRelease`, debug-signed + `debuggable true` — Metro/NAT dead), logs
→ logcat `ReactNativeJS` with the full probe JSON also on-screen (logcat truncates ~4 KB).
`assembleRelease` succeeded in 34 s; APK 19 MB (arm64-only).

### Desktop filter — `npm run build && npm run invariants`
7/7 checks green against the retained build (headless Chromium): b-tip (render+contain+tap),
channel-a fallback, F4 (forged frames rejected, trusted verdict CONTAINED), reset-seam clean
gen-2, T7 same-realm finding, blob-refusal, and a **broken-CSP negative control** that the
suite correctly flags red (proving it isn't vacuously green). Source-map round-trip verified
(generated line → original `tip-splitter.app.tsx` line, D4). This is the §16.2 blocking CI
gate seed (`.github/workflows/invariants.yml`); desktop is the fast filter, on-device is the
acceptance.
