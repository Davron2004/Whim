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

### The one real lesson (Spike 1)

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
\#11/#12 "sandboxing is basically free" framing is mostly true but undersold how much
of the load CSP carries — it's free *if you remember the CSP*.

### Friction & dead ends (Spike 1)

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

### The one real lesson (Spike 4)

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

### Friction & dead ends (Spike 4)

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

### The one real lesson (Spike 2 — reasoned)

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

```text
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

---

## v0.2 — `on-device-snapshot-store` (the retained version store)

**Result:** built from the #36 recipe and **accepted on-device** (Pixel_9_Pro_XL arm64, RN
0.85.3 / Hermes, offline release bundle): full lifecycle (snapshot ×N, history, diff,
rollback, pin, fork) + compaction + **MMKV cross-restart**, `pass:true`, 0 failures across
three kill+relaunch cycles. Node core suite (`npm run vstore:test`) 43/43 is the cheap
checkpoint; the Android run is the acceptance (D7). Full write-up: `docs/decisions.md` #39.
Evidence: `docs/vstore-android-{inmemory,mmkv-restart}.png`.

### The dead-ends (wired ≠ works, again)

1. **The "keep MMKV out of the bundle" trick worked too well.** To let the in-memory core
   build with zero native modules, I assembled the module name at runtime
   (`['react','native','mmkv'].join('-')`) so Metro wouldn't statically pull
   react-native-mmkv into the graph. It didn't — and then, once I *wanted* it, the native
   C++ lib loaded fine (`Successfully loaded NitroMmkv`) but the JS side threw **"Requiring
   unknown module react-native-mmkv"**: Metro only ships modules it statically saw. Lesson:
   a literal `require('react-native-mmkv')` is correct *once it's a real dependency* —
   anti-static-analysis is for genuinely-optional deps, and it cuts both ways.
2. **react-native-mmkv v4 is not `new MMKV()`.** v4 (nitro) dropped the class: `MMKV` is now
   a **type-only** export. Runtime is `createMMKV({ id })`, and delete is **`remove(key)`**,
   not `delete`. First MMKV run: *"undefined cannot be used as a constructor"* (the class was
   gone), then I adapted the backend (`createMMKV` + `remove`→`delete` shim). The KVBackend
   interface absorbed it in one wrapper — the engine never knew.
3. **`packObjects` writes the pack but not the `.idx`.** Dropping loose objects after packing
   made reads fail until I added `git.indexPack` — isomorphic-git can't read a packfile
   without its index. And `indexPack`'s `filepath` resolves relative to **`dir`**, not
   `gitdir`, so it's `.git/objects/pack/<name>` (a null-slice crash pointed the way). De-risked
   in a scratch Node probe *before* building the compaction module — cheap and worth it.

### What the spike handed forward, now closed

- **Cross-restart persistence (D4):** MMKV round-tripped clean — `restartVerified:true`,
  generations accumulating 1→2→3 across real process kills, 0 corruption. The native-FS
  fallback was **not** needed.
- **DIY compaction (D5):** pack-then-drop-loose collapsed **48 loose objects → 0** on-device
  with every verb still resolving against the pack. Trigger is loose-object **count**
  (default 80), not bytes — each loose object is a KV key, the real cost driver.

### On-device numbers (offline release, headless software-GL — conservative)

snapshot ~45–86 ms · history ~10–29 ms · diff ~8–16 ms · rollback ~58–183 ms · pin ~1 ms ·
fork ~37–68 ms · compact (pack 48) ~530–590 ms. All sub-second; `history`/`rollback` are the
depth-scaling ops (cap/paginate, as #36 said). ~4 loose objects + ~650 B per generation —
matches the spike's curve. Toggle the run with `RUN_VSTORE_PROBE` in `App.tsx`.

## v0.2 — `mini-app-storage-engine` (the per-app SQLite user-data engine)

**Result:** built host-side (`src/host/storage-engine/`) and **accepted on-device** (Pixel_9_Pro_XL
arm64, RN 0.85.3 / Hermes / new arch, offline release bundle): full verb lifecycle + schema
evolution (add / rename / tombstone+reuse / rollback-shaped reopen) + KV cap + ephemeral
isolation + **cross-restart**, `pass:true`, 0 failures. Node suite (`npm run storage:test`)
**131/131** over real `node:sqlite` is the cheap checkpoint; the op-sqlite Android run is the
acceptance (D7). Full write-up: `docs/decisions.md` #40. Toggle with `RUN_STORAGE_PROBE` in `App.tsx`.

### The one real lesson — the binding seam paid for itself, twice

The engine core speaks to a ~3-method `SqlExecutor`. That seam meant the **entire engine was
proven on `node:sqlite` before a device existed** (131 checks, sub-second, no browser) — and
the same core ran unmodified on op-sqlite on-device. The injection invariant in particular is
*only* testable because the test binding (`RecordingExecutor`) captures every executed
statement: the suite asserts the executed-statement set is exactly the fixed host-authored
templates with adversarial input present only in the bound-param array. Wired that into CI as
a blocking step — it's a security invariant (§16.4), not a feature test.

### The dead-ends (wired ≠ works, again)

1. **A NUL byte masquerading as a space.** One adversarial fixture string had a leading ` `
   (not the space I'd typed); SQLite truncates TEXT at an embedded NUL, so it round-tripped to
   `""` and `grep` started treating the whole test file as *binary*. `tr -d '\000'` fixed it.
   The injection test is about SQL metacharacters, not NUL handling — don't let a stray control
   char in a fixture stand in for a real finding.
2. **The device run caught a harness idempotency bug the Node suite never could.** First launch:
   `pass:true`. Relaunch: `pass:false`, `renameServed:false`. Cause: the deterministic section
   reused the *persistent* `storage-accept` DB, so a second launch reopened the accumulated
   schema (f4 tombstoned, f5 added) + leftover rows, and the "default backfilled?" assertion saw
   a row that already carried last run's value. Fix mirrors the vstore pattern: the deterministic
   sections start from a **reset** DB each launch (raw op-sqlite `DROP TABLE` over `sqlite_master`,
   host-side trusted), and only a separate `storage-persist-probe` app id intentionally
   accumulates for the cross-restart check. The Node suite is green because each test builds a
   fresh `:memory:`/temp-file engine — exactly the fresh-slate the device version was missing.
3. **`_meta` is the *accumulated* schema, not "the last artifact."** The literal reading breaks
   rollback→roll-forward: overwriting `_meta` with the rolled-back (smaller) artifact makes the
   subsequent roll-forward a doomed re-`ADD COLUMN` on a column that already exists. Storing the
   monotone union (additive-only, no DROP) makes rollback an older-subset no-op and roll-forward
   `identical`. Tombstones keep the retired column's **type** so "same field rolled back across a
   tombstone" (allowed) is distinguishable from "repurpose a retired ID" (rejected).

### op-sqlite under RN 0.85 / new arch / Hermes — clean

`@op-engineering/op-sqlite` **16.2.0** autolinked with zero config; gradle built
`:op-engineering_op-sqlite:` CMake + JNI libs, `libop-sqlite.so` loads under Hermes (same JSI
toolchain generation as the MMKV v4 already shipped). First build with the new native module
~1m23s; incremental JS-only rebuilds ~8s. The D1 fallback (`react-native-nitro-sqlite`) was
**not** needed.

### On-device numbers (offline release, headless software-GL — conservative; 2000-row ledger)

Single-op latencies are interactive: `list` 2000 rows ~4–11 ms · filtered/ordered/limited
`list` ~0–1 ms · `update` ~1–11 ms · `remove` ~1–7 ms · `kv.set` ~1–9 ms · single `append`
~1.2 ms warm. DB file ~**76 KB** fresh for 2000 ledger rows (no shrink-on-DROP without VACUUM →
a reset run shows the ~164 KB high-water). **The one to watch:** a 2000-append *bulk loop* is
~2.4 s warm but ~19 s when first-launch `ProfileInstaller`/dex compilation runs alongside —
each append is its own implicit transaction (one fsync), and the lean verb set has no batch API
by design. The actual interactive path (a user logging *one* expense) is ~1–10 ms; if bulk
import ever matters, a batch/transaction verb or `journal_mode=WAL` collapses it.

## capability-bridge — the syscall boundary (Decision #41)

The bridge wires #40's storage engine to mini-apps as syscall #1. Four host modules
(`registry`/`gate`/`dispatcher`/`launch` + storage `rows`), one iframe marshaller
(`src/runtime/web/syscall.js`), one `vc-sdk` `storage` facade. Raw lessons:

1. **Playwright's `frame.evaluate` runs OUTSIDE the page CSP — a real false-negative trap.**
   The stub-authority invariant first tried to prove "no codegen reachable from the facade" by
   doing `Object.getPrototypeOf(storage).constructor.constructor('return 1')()` inside a
   `frame.evaluate`. It DID-NOT-THROW — not a CSP breach, but because CDP's `Runtime.evaluate`
   isn't subject to the page's `script-src`. The in-page bundle code (probes.js) IS, which is
   why the containment suite's `Function()` probes correctly throw. Lesson: the codegen leg is
   the in-page suite's job; a Playwright-driven probe can only assert **reachability** (no
   engine/host/native ref reachable from the facade), not codegen. Conflating them gives a
   green that means nothing — or here, a red that means nothing.

2. **The generation fence needs ONE authority, and it's the host.** First cut had the iframe
   marshaller stamp `window.__whimGeneration` (the loader's counter). But a realm reset
   recreates the iframe → fresh script → counter restarts at 1, while the host's realm
   generation had advanced → every syscall dropped as "stale." Fix: the host stamps the
   generation into the init frame (the same handshake that carries the nonce); the marshaller
   echoes it. Host controls both the realm record's generation and the number the iframe
   stamps, so they're consistent by construction. The Node suite drives stale frames directly
   (it owns the gen), so it tests the fence without the handshake.

3. **Forged-sysret inertness is `ev.source`, not crypto.** A bundle can `window.postMessage` a
   fake `{whim:'sysret',…}` to its own window, but `ev.source` is then the iframe's own window,
   not `window.parent`; the marshaller requires `ev.source === window.parent` (the host
   channel). `window.parent.postMessage` posts TO the parent, never INTO self with a parent
   source — the browser sets `source`, so it's unforgeable. No nonce needed on the syscall
   channel (and adding one would be security theater implying the channel is trusted — exactly
   the #37/F4 mistake).

4. **Single-source-of-truth manifests via build-time extraction.** To stop a fixture declaring
   one manifest in `defineApp` and the host gating a different one, the build re-bundles each
   fixture for Node with `vc-sdk` → the REAL SDK and react/react-dom stubbed (components are
   never rendered during extract — we only read `.default`), imports it, and reads
   `{capabilities, schema}` into `app-records.ts`. Gotcha: the sandbox-escape fixtures
   (evil/poison/victim) run module-scope attacks that touch `document`/`Object.prototype` —
   importing them into the build process is both broken (throws in Node) and gross (pollutes
   the builder). They declare `[]`, so they're skip-listed with a static `[]` record.

5. **`dispatcher.handle` returns the sysret (or null) — no `send` callback.** Returning the
   value (null = dropped: stale gen, torn-down realm, malformed-uncorrelatable) made the same
   dispatcher serve three hosts unchanged: the RN host injects `__whimRelaySysret`, the Node
   test reads it directly, and the invariant suite returns it from a Playwright `exposeFunction`
   — which is what let the bridge invariants run the REAL host core (real gate + real
   node:sqlite engine) behind the REAL browser sandbox, not a reimplementation.

### capability-bridge on-device (Pixel_9_Pro_XL arm64, offline release) — and the bug it caught

Two runs, both PASS. The **host-core probe** (`RUN_BRIDGE_PROBE`) exercised the gate/dispatcher/
registry over op-sqlite — all denials, dedup, stale-gen drop, injection-inert, append-only,
and cross-restart persistence (`priorRecords` 0→1→2 across real kills, `restartVerified:true`).
The **full WebView path** (deliver buttons) ran 111 syscalls end-to-end, the water-counter hit
3 → force-stop → reloaded 3, sql-injector landed 0 injections, cap-intruder was denied
`undeclared_capability` — containment `42/42` throughout.

1. **The device run caught a host-wiring bug the whole desktop suite missed.** `WebViewHost`
   only built a dispatcher when `manifest.capabilities.length > 0`. So `cap-intruder` (declares
   nothing) syscalled, hit `if (!live.current) return` in `onMessage`, and the frame was
   **silently dropped** → the marshaller sat on it until the 10 s timeout instead of getting a
   structured `undeclared_capability`. `bridge:invariants` never saw it because the Node host
   shim's `makeHost` ALWAYS builds a dispatcher (the gate then denies correctly). Lesson, again:
   the desktop suite tests the gate; only the device tests the *host wiring around* the gate.
   Fix: always bind a realm + dispatcher (engine opened only if storage is declared), so the
   gate refuses at the capability step rather than the host swallowing the frame.

2. **The round-trip is transport-bound, ~16–17 ms median for EVERY verb.** Host-side the engine
   is sub-ms (`kv.get` 0.1 ms, `list` 0.4 ms, `diag.echo` 0.04 ms via the probe), but the full
   WebView round-trip converges to ~16.6 ms regardless of verb — even the engine-less
   `diag.echo`. The cost is the two RN↔WebView bridge crossings (iframe→`onMessage`, then
   `injectJavaScript`→iframe), not the gate or SQLite. So batching (the envelope's `v` field
   leaves room) would help a chatty app far more than any engine tuning — but Tier-0 apps are
   one-tap-one-syscall, so it stays deferred. The 10 s timeout is ~600× the observed max; left
   as-is pending real-hardware numbers (the emulator is the conservative case).

3. **WebView accessibility nodes expose the mini-app's text to `uiautomator`.** Driving the
   acceptance headlessly worked because the sandboxed iframe's rendered `Text` shows up in the
   native view dump — so assertions like "INJECTIONS LANDED: 0" and "denied: undeclared_capability"
   are greppable without OCR. Handy for scripting an on-device UI acceptance.

---

## v0.3 — effects-and-cues (`effects-and-cues`, decisions #43)

**Result:** time + physical feedback shipped. Desktop suites green (`bridge:test` **91 checks**
incl. the new §G cues; effects E1–E4 in headless Chromium; `invariants` 7/non-vacuous; build +
lint clean) and **emulator acceptance done** (Pixel_9_Pro_XL arm64, offline release): pour-over
delivered, `interval` ticked at 1 Hz through Bloom, get-ready + stage-transition **cues fired**
(`syscalls: 8 · last: cues.sound → ok`), pause froze the countdown, **containment held 42/42**.
The `WhimTone` `ToneGenerator` TurboModule + codegen compiled and installed. Pending: the *felt*
buzz/tone on real hardware (emulator can't show it) and the two runtime-owner invariants (§16.4).

### Lessons

1. **The `interval`-as-hook bet paid off — the leak class is gone by construction.** Making
   `interval` a hook (not a handle-returning `start()`) means there's no cleanup for the agent
   to forget: unmount cancels via the effect's return, and `running:false` re-runs the effect to
   a no-op. The desktop check proved E3/E4 mechanically; on-device, tapping Pause froze the
   countdown at the same `1:18` across two screencaps — exactly the "paused interval does not
   tick" property, end-to-end. Cost: the `use*` lint convention can't see `interval` is a hook,
   so `react-hooks/rules-of-hooks` fires; a scoped `eslint-disable` (not a rename) keeps the
   spec-fixed name. Accepted per design D1.

2. **Cues needed ZERO new `BridgeErrorKind`.** The missing-backend case (a host with no device
   wired) just throws a plain `Error`; the dispatcher's existing generic `catch` shapes it into
   `handler_error` with a hint. So the cue rows are *purely* additive — `dispatcher.ts`/`gate.ts`
   never changed. The #41 readiness test ("capability #N+1 is one row + one stub") held literally:
   the bridge diff is contract types + two rows + the `cueBackend` factory option, nothing else.

3. **`ToneGenerator` was the right "no dependency" call — codegen compiled first try.** The new-
   arch TurboModule shape that worked on RN 0.85: a `Native*.ts` spec under a `codegenConfig.
   jsSrcsDir`, the Kotlin module extending the generated `Native<Name>Spec`, and a
   `BaseReactPackage` with a `ReactModuleInfoProvider` (6-arg `ReactModuleInfo` ending
   `isTurboModule=true`), added to `MainApplication`'s package list (in-app modules don't
   autolink). `:app:compileReleaseKotlin` ran codegen and produced
   `app/build/generated/source/codegen/java/com/whim/tone/NativeWhimToneSpec.java`. The
   "No modules to process in combine-js-to-schema-cli" line during the JS-bundle step is the
   *library* autolink combine — benign; the *app* codegen is a separate task that did find the
   spec. `react-native-sound` (the pre-named fallback) was never needed.

4. **Building an RN app from a git WORKTREE needs a real `node_modules` IN the worktree.** Node
   resolves up the tree (so the esbuild/playwright JS suites worked against the parent repo's
   `node_modules`), but **Gradle's `settings.gradle` resolves `node_modules/@react-native/
   gradle-plugin` literally** and doesn't walk up — and a *symlinked* `node_modules` then breaks
   **Metro's** resolver (`Unable to resolve @babel/runtime/helpers/interopRequireDefault`), which
   both the JS bundle AND `generateCodegenSchemaFromJavaScript` rely on. Fix: `npm install` in the
   worktree (≈6 s with a warm cache — the lockfile matches; my only package.json change was
   `codegenConfig`, no new deps). Don't symlink for native builds.

5. **Cue round-trip is the same transport-bound hop as every verb (~16–17 ms median, the v0.2
   number), and fire-and-forget makes the latency uncritical.** The handler is *cheaper* than
   storage (no engine — it just calls `Vibration`/`ToneGenerator` and returns `{}`), so the cost
   is purely the two RN↔WebView crossings, not the cue. The 10 s marshaller timeout (`syscall.js`
   `TIMEOUT_MS`) has ~600× headroom; with cues being fire-and-forget there's even less reason to
   tighten it. Left as-is pending real-hardware numbers (D8 tuning).

---

## `launcher-shell` (= roadmap #5) — the product shell

**Result:** the host is a product, not a probe screen — home grid, full-screen launch by
record/source, system-back + floating-affordance exit, fork/delete, first-run seeding. Desktop
gates all green (launcher:test 433, vstore 52 with `remove`, invariants still 42/42, tsc clean,
by-source desktop parity); on-device acceptance (task 7.2) is the remaining step. Write-up in
`docs/decisions.md` #43.

### Lessons / sharp edges (launcher-shell)

1. **A fresh worktree off `dev/v1` did NOT contain the change's own OpenSpec dir.** The
   `openspec/changes/launcher-shell/` artifacts were *untracked* in the main repo, so a clean
   worktree checkout of the `dev/v1` commit omitted them — `tasks.md` literally didn't exist in
   the worktree. Had to copy the dir in before I could tick boxes. Lesson: when worktree-ing to
   implement an OpenSpec change, the proposal artifacts have to be tracked (or copied) or they
   vanish from the isolated checkout.

2. **The fork's two-id split is the whole ballgame, and it's the ENGINE id that's load-bearing.**
   A fork shares the original's version-store repo (`storeId` + a `fork-N` lineage) for shared
   history, but its runtime **engine appId is its own launcher id** — so its SQLite user data is
   independent. Get this backwards and a fork writes into the original's data. The realm is
   therefore launched with the launcher id (not the store id) as `createStorageEngine`'s appId;
   the manifest/schema come from the (shared) record. One optional `storeId` field, paid only by
   forks; every other consumer treats `storeId ?? id` as the repo.

3. **The back-policy double-back falls out of `awaitingPop` alone; the 400 ms timer is for the
   *patient* user.** If a forwarded `nav-back` is still unacknowledged when the next press
   arrives, that press exits — that already covers the impatient double-tap with no timer. The
   timeout only matters for the user who presses once, waits, and presses again: it converts a
   lingering `awaitingPop` into an armed escape. The non-obvious case is the *slow-but-honest*
   app — a genuine depth DECREASE that arrives after the timeout must DISARM the escape, or you'd
   exit out from under an app that was simply slow to pop. Pure reducer, so all of this is
   Node-TDD'd without a device.

4. **Delivery-by-source is byte-identical to baked delivery — the only delta is one lookup.** The
   outer page already posted the full bundle source in the deliver frame; the launcher path just
   feeds `opts.source` where the baked path read `BUNDLES[name]`. Nothing iframe-side changed (CSP/
   sandbox/loader untouched), which is why containment held 42/42 with zero invariant edits. The
   desktop verify proves it the strong way: build the page with an **empty** baked map and deliver
   by source — a rendered, contained tip-splitter then *could only* have come from the host string.

5. **`remove(appId)` leaves the shared root-dir scaffolding, and that's correct.** Removing an
   app prefix-deletes its repo keys but `/whim` + `/whim/apps` survive (other apps share them) —
   so "zero keys" assertions must be repo-scoped, not `map.size === 0`. The first test got this
   wrong and flagged 2 leftover keys that were never repo data.

6. **The RN tsconfig excludes the Node-only acceptance dirs** (they use `process`, run via
   esbuild) — had to add `src/host/launcher/test` to the exclude list, same idiom as the
   vstore/storage/bridge suites. The launcher *modules* stay type-checked; only the runner is out.

---

## `harness-server-skeleton` (= roadmap #8) — the generation-server scaffold

**Result:** four chains (A–D) complete; `server:test` **111/111** green; tsc clean on both
`contract/` and `server/`; CI gates added. The workspaces `contract/` (`@whim/contract`, zod-4
schemas only) and `server/` (`@whim/server`, Hono + `@hono/node-server`) are standing. The
stub pipeline streams the full `GenerationEvent` sequence (canned stage events, token deltas,
usage, result/failure terminal); `node:sqlite` metering survives restart; `GET /v1/usage`
returns zeroed Usage for unknown ids; the OpenRouter wrapper has injectable fetch and three
typed error classes. On-device LAN acceptance (task 8.2) is human-run.

### Lessons / sharp edges

1. **`guard:metro` result: byte-identical 1,834,658-byte bundle before and after
   workspace-ification — provably inert.** Metro resolved the root RN package cleanly despite
   the new `workspaces` field in root `package.json`. The bundle check (file-size-only assertion)
   is a fast CI gate that would catch any accidental Metro-visible hoisting or resolution change.
   Worth keeping as a CI step even though it costs ~20–30 s.

2. **`node:sqlite` (built-in, Node 22) is the right zero-dep store for the server.** It uses
   `DatabaseSync` from `node:sqlite` — same import the storage-engine tests use, same pattern
   (`new DatabaseSync(path)`), zero extra dependency. Enabling it in an esbuild-bundled context
   just works: esbuild externalizes `node:*` builtins automatically. The `ExperimentalWarning`
   it emits (`SQLite is an experimental feature`) is harmless in the test output. The
   `ON CONFLICT ... DO UPDATE` UPSERT keeps metering atomic (no separate read-then-write).

3. **`npm install` and `git commit` are human-gated by the harness** — subagents are blocked at
   the hook level (exit 2 on protected files) while the main thread gets a CLI approval prompt.
   This made chain-A (workspaces + `package.json` edits) main-thread-only by design. Chain-D
   (implementer-dispatchable) touched only unprotected files: `server/src/`, `server/test/`,
   `contract/src/`, `.github/workflows/invariants.yml`, `docs/v1-roadmap.md`, `DEVLOG.md`.

4. **Unhandled-rejection trap in the OpenRouter wrapper tests.** When a fake-fetch returns a
   401/429, the wrapper rejects BOTH the async-generator (which the test's `caught()` captures)
   AND the `usage` Promise (which nothing catches by default). Node raises an unhandled rejection
   after the suite reports "111 passed, 0 failed" — the exit code becomes 1 even though all
   assertions passed. Fix: `usagePromise.catch(() => undefined)` in each error-path test before
   iterating deltas. The error tests already captured the right typed error; the suppression
   only prevents the spurious non-zero exit.

---

## `parallel-fix-loop` — the worktree-isolated batch-fix harness

**Result:** the build harness, which was designed for attended/sequential/single-tree/human-commits
work, now also runs **unattended-capable, parallel, multi-worktree, agent-commits** mechanical
fixes. Mechanism: pinned-BASE integrity (replaces the foldable HEAD-diff tripwire), scoped git
for subagents (`agent_id` + `cwd`-keyed), a gate split (`gate.sh` fast / `gate-full.sh` full,
the latter run from the branch's committed tip in the **main** tree), a memory-handoff protocol
(subagents propose, orchestrator applies, human sees the diff), and a `.devcontainer/` image for
headless runs. Driven through `/fix-loop`: planner → `fix-worker` (isolated worktree) →
red-check → integrity → reviewer → full gate → serialized merge, with PARK (rename, never
delete) on any terminal wall. Validated end-to-end and now landing real fixes from the fix-fest
critic batch (F1, F3, D1, D3, D6, D7, E1, E2) onto `dev/v1`.

### Lessons

1. **A HEAD-diff tamper check is worthless the moment the thing you're checking can commit.**
   The original gate tripwire was `git diff HEAD -- <config>` — but once a subagent can `git
   commit`, it can bake a tampered config into HEAD (HEAD == tree → empty diff → green). Fix:
   pin to a **BASE SHA the orchestrator records at worktree creation** and diff against that,
   never HEAD. Git's content-addressing already is the integrity baseline — no hash manifest,
   no capability system needed on top.
2. **Worktrees must live under `.claude/worktrees/`, not `/tmp` — but the toolchain still splits
   on Metro.** Node resolves `node_modules` by walking *up*, so an in-repo worktree gets the
   real toolchain for free; a `/tmp` worktree (symlinked `node_modules`) never resolved. Metro,
   though, does **not** walk up — `guard:metro` fails from a worktree even with the toolchain
   otherwise working. So the *fast* gate runs in the fixer's worktree, but the *full* gate
   (`gate-full.sh`, which needs Metro + Chromium) runs from the branch's committed tip
   `--detach`-checked-out into the **main** tree, not a worktree — same reasoning CI never
   trusts a developer's working directory: a fixer can leave poisoned gitignored/untracked
   files that a worktree-local gate would silently trust.
3. **A red-check can be RED for the wrong reason.** Reverting a fix that adds a new imported
   module makes the suite fail to *build* ("Could not resolve") rather than fail the actual
   assertion — exit-nonzero either way, but a build failure proves nothing about the fix.
   Mitigation: revert only the pre-existing prod file(s), not new ones, so the suite still
   builds and the real assertion fails cleanly; a behavioral test on a brand-new helper can't be
   revert-red-checked at all and needs reviewer inspection instead.
4. **The triage list goes stale faster than expected.** Two of the first three findings picked
   for a parallel batch were already fixed in `dev/v1` after the critic's report was cut. Cheap
   to catch (the read-only planner step), expensive to miss (a wasted worktree + fixer run) —
   the planner now has to verify a finding isn't already in HEAD before dispatching a fixer.
5. **Chromium does not run under macOS Seatbelt at all** (`bootstrap_check_in … Permission
   denied` — Seatbelt blocks the Mach-port IPC Chromium's multi-process model needs), so the
   three Chromium-backed npm scripts had to be carved out of the host OS sandbox via
   `excludedCommands`. That carve-out's safety assumption — a human sees and approves the
   override prompt — **silently does not hold in a background/auto-mode session**: a batch run
   that way saw every sandbox override auto-approve with zero prompts, making the run de-facto
   unattended with the sandbox bypassed for orchestrator git + the full gate. The real fix isn't
   the override at all — it's `.devcontainer/` (Docker, default-deny egress except the Anthropic
   API), which replaces the OS sandbox as the threat boundary for any run that isn't a live
   foreground session.
6. **The `Write`/`Edit` tools bypass the OS sandbox entirely — only `Bash` subprocesses are
   sandboxed.** This mattered for memory handoff: subagents are hook-denied from writing the
   memory store (avoids an N-fixer race on the single `MEMORY.md` index), so they propose facts
   in their report and the orchestrator applies them via `Write`/`Edit` — which still prompts
   the human with the full diff regardless of `sandbox.enabled`. The permission prompt, not the
   sandbox, is the actual gate on memory.
7. **A `//` comment in `.claude/settings.json` silently drops the *entire* file, not just the
   commented block.** Settings JSON must be strict — a stray inline note next to the sandbox
   config invalidated the whole file, so the loader silently dropped sandbox, `worktree.baseRef`,
   permissions, and hooks together. Symptom looked exactly like "the sandbox isn't enforcing"
   (writes to `~/` succeeded); root cause was `/doctor` away. After any settings change, restart
   and verify with a throwaway blocked write before trusting the run.

---

## `fix-sonarjs-gate` — SonarCloud's rules folded into the local gate

**Result:** `eslint-plugin-sonarjs@4.1.0` (`recommended-legacy`, 206 rules) added to the root
eslint config, so `gate.sh`'s lint step now enforces the same rule set SonarCloud's PR quality
gate runs — cognitive complexity, nested ternaries, and friends fail the inner loop locally
instead of surfacing as a post-hoc PR rework cycle (which is exactly what happened to
`static-check-pipeline`: ~3h of Sonar-driven rework on the PR branch after the OpenSpec ledger
had closed). Enabling the rules surfaced 20 findings: 9 false positives (the house greenBy
harness's own assert helpers aren't recognized by S2699 — scoped override for `checks/test/**`)
and 11 real ones, fixed via the parallel fix loop (9 findings, 9 worktrees, 3 reviewers, all
merged; storage-engine `schema.ts` complexity-46/39 decomposition user-ratified). Full gate
green on merged main.

### Lessons / sharp edges

1. **`// NOSONAR` is a scanner feature, not an eslint one.** `schema.ts` carried two NOSONAR
   suppressions that kept SonarCloud quiet for months; `eslint-plugin-sonarjs` ignores them and
   flagged both functions immediately. Local lint is therefore *stricter* than SonarCloud here —
   suppression debt surfaces the moment the plugin lands.
2. **A real SonarCloud scan can't live in the gate.** Automatic analysis is server-side (no
   `sonar-project.properties` in-repo), needs a token + network, and the containerized fix-loop
   is deny-egress-except-Anthropic. The eslint plugin is the right in-loop mirror; SonarCloud
   stays the authoritative external check at PR time.
3. **Enabling a new lint rule set before fixing its findings makes every fix-branch baseline-RED.**
   No individual fix could pass the full gate until all nine merged — the orchestrator had to
   adjudicate "lint failures excused iff confined to still-unfixed batch files" per merge, with
   the one authoritative no-excuses `gate-full.sh` after the final merge. Enable-then-fix works,
   but budget for the batch being atomic from the gate's perspective.
4. **Rule cascades: deleting the flagged line isn't always the fix.** Removing a dead
   `if (false) yield` from a generator test-double flipped the finding into
   `sonarjs/generator-without-yield`; the real fix was replacing the generator with a hand-rolled
   never-resolving `AsyncIterable`. Fix the construct, not the diagnostic.
5. **Planner assumptions about "generated files are committed" must be checked against
   `git ls-files`, not the build docs.** `src/runtime/generated/` is rebuilt by the gate and
   deliberately gitignored (zero tracked files); a worker following the plan's "commit the
   regenerated artifacts" instruction force-added them before the orchestrator caught it in the
   deviation report. `.gitignore` + `git ls-files` is the ground truth for what a commit may contain.
