# Spike 2 — Pen-Test Plan (adversarial verification of the delivery decision)

> **✅ RESULT (2026-06-07) — DECISION SURVIVES.** Executed T1–T4 on the real Android System
> WebView, two ways: as trusted probes in the delivered bundle's scope (34/34 CONTAINED on
> every legit channel) AND via a malicious `evil-app` bundle delivered end-to-end through
> channel (b). **Every escape blocked on-device:** T1 self-injected fresh `<script>`
> (fetch/xhr/ls → TypeError, eval → EvalError; the window-level strip holds in a fresh
> top-level scope), T2 host/native reach (SecurityError; only the loader's `parent.postMessage`
> stub is reachable, no native bridge), T3 SDK-prototype → Function-ctor (EvalError), T4 all
> codegen (EvalError). **Finding F4 (Case-2 constraint, not a breach):** the evil app forged
> its own containment verdict (`contained:true 999/999`) — the sandbox contained it, but the
> self-report lied → the production harness must judge containment from a trusted vantage.
> Full record: `docs/decisions.md` #37 + `docs/spike2-findings.md` (five carry-forward
> constraints) + `DEVLOG.md` Spike 2.
>
> **✅ T5–T8 follow-up (complete, on-device 2026-06-07).** T5 module confinement → blocked
> (relative/dynamic/subpath/off-allowlist requires throw; non-vc-sdk import resolve-fails the
> build). T6 transport eavesdrop/spoof → **constraint** (the host must authenticate/ignore
> bundle-origin control frames; one bundle per realm, so it only eavesdrops its own traffic).
> T7 re-injection persistence → **THE finding:** re-injecting gen-2 into the same iframe lets
> gen-1 pollution (backdoor + `Object.prototype` + global) **persist into gen-2** on-device →
> re-injection must reset/re-harden the realm (Spike-8). T8 build-step → analysis: the token-
> scan static check misses `Object.prototype`/`globalThis`-alias pollution (§8.1 AST checker
> must close it). All legit channels CONTAINED **43/43** on-device. Decision still survives.


*Status: draft, written in parallel with the `opsx apply` run. The applying agent runs
the **D5 re-containment** check (re-run the existing probe checklist after wiring delivery).
This plan is the **independent skeptic** on top of D5: it does not trust the spike's own
green checkmark — it actively tries to **break out through the new delivery path**, because a
delivery channel can reopen a hole the hand-injected Spike-1 bundle never exercised.*

---

## 0. Why this exists (and how it differs from D5)

- **D5 (the spike does this):** re-run the *known* `invariants/sandbox-isolation/` probes
  against the delivered bundle — confirms the existing closures still hold.
- **Pen test (we do this):** assume the chosen delivery channel introduced a *new* attack
  surface and hunt for escapes that the existing checklist doesn't cover. The delivery
  mechanism (a loader that inserts DOM inline scripts, an injected SDK global, a string
  transport) is itself the new thing to attack.

**The deliverable is a verdict on the decision, not on the code.** Outcome is one of:
1. **Decision survives** — every attack is blocked on the *real RN target*; the chosen
   delivery channel is safe to carry into `webview-sandbox-runtime`.
2. **Decision survives with a constraint** — an attack works only under a condition we can
   forbid in the contract (e.g. "the global strip MUST be a `delete`-from-window, never a
   closure shadow"); record the constraint as load-bearing.
3. **Decision rejected** — an attack achieves codegen, host/native reach, or network egress
   that no contract constraint can close → fall back (channel (a) over (b), or H2 over H1),
   and re-run.

Discipline carried over from the spike: **the verdict that counts is on-device**
(`react-native-webview` on Android, D6), not desktop Chrome — the engine gates inline-script
insertion and CSP differently. Desktop/Node is a fast first filter only.

---

## 1. Method

Two tracks, run together:

### Track A — static review (read the retained code)
Before running anything, read the spike code the agent left in `spikes/bundle-contract/` and
answer:
- **How is the global strip actually done?** `delete window.fetch` / redefining the property
  to throw, vs. **shadowing in a function/closure scope**. This single fact decides whether
  attack **T1** (self-injected fresh script) works — a closure shadow is escapable by any
  code that runs in a *fresh* top-level script scope; a window-level delete/poison is not.
- **What does the trusted loader leave reachable on the iframe `window`?** Any `__loader`,
  message-handler closure, captured host/`parent` reference, the esbuild runtime, the
  injected `vc-sdk` object — every reachable trusted object is a candidate pivot.
- **What is the injected `vc-sdk` (if H1b)?** Walk it on paper: `Object.getPrototypeOf`,
  `.constructor`, any method that closes over `parent`/`postMessage`/host state.
- **What exactly crosses the boundary?** Confirm the only intended crossing is
  `parent.postMessage` (web→host) and the one injected string (host→web).

### Track B — dynamic exploitation (run attack fixtures)
Write each attack as a **fixture in the real emit format** — i.e. a malicious "app" the
agent's pipeline would *accept as input* (`export default defineApp(...)` importing
`vc-sdk`), then push it through the **actual delivery pipeline the agent built** (same
transpile + same delivery channel), and observe.
- Run each attack first in the Node/desktop checkpoint (fast), then **on the Android target**
  (authoritative). A desktop "blocked" that we cannot reproduce on-device must be re-checked
  on-device before we trust it.
- Each attack ships an in-app assertion + on-screen result (logcat truncates at ~4 KB — put
  the full verdict JSON on-screen, per the spike's logging gotcha). Pass = escape **blocked**.
- Reuse / extend `invariants/sandbox-isolation/` so the attacks become a permanent suite.

---

## 2. Attacks, ranked (highest-value first)

**Phasing (settled):** run **T1–T4 first** as the go/no-go gate. Only if all four are blocked
on the Android target do we proceed to **T5–T8** as a follow-up (T7/T8 are recorded findings,
not first-load gates, regardless).

### T1 — Self-injected fresh inline `<script>` (THE headline attack)
**The sharpest, delivery-specific escape.** If delivery channel (b) works because
"DOM-created inline `<script>` with `textContent` runs under `'unsafe-inline'`", then the
*untrusted bundle itself* can do the identical move once it is running:
```js
const s = document.createElement('script');
s.textContent = "window.__escaped = typeof fetch === 'function' && fetch";
document.head.appendChild(s);
```
- **If the global strip was a closure shadow:** the fresh top-level script sees the *real,
  un-stripped* `window` globals → `fetch`, `XMLHttpRequest`, `WebSocket` are back → **full
  escape.** This is the most likely real hole.
- **If the strip was a window-level delete/poison:** the fresh script sees the same poisoned
  window → blocked. **Probe the difference explicitly.**
- Also test: does the self-injected script run **before** the strip completes (timing)? Does
  it run with any reach the loader has?
- **Verdict drives a contract constraint:** if T1 only fails under window-level strip, then
  "strip MUST be window-level, never closure-shadow" becomes a load-bearing rule for
  `webview-sandbox-runtime` — record it loudly.

### T2 — Reach the native bridge directly
The web→host transport is `window.ReactNativeWebView.postMessage`. From the **inner untrusted
iframe**, probe:
```js
[window.ReactNativeWebView, parent.ReactNativeWebView, top, parent, frameElement]
```
- Can the untrusted bundle reach `ReactNativeWebView` (the native bridge) directly and post
  arbitrary messages to the RN host — spoofing the SDK / triggering host actions it shouldn't?
- Confirm the cross-origin iframe (`allow-scripts`, **no** `allow-same-origin`) denies
  `parent`/`top`/`frameElement` any usable handle, and that the bridge object is **not**
  present on the inner frame's `window`.

### T3 — Prototype-walk / closure-pivot from reachable trusted objects
From the injected `vc-sdk` global and any trusted leftovers found in Track A, try to climb to
a host/native handle:
```js
sdk.constructor, sdk.__proto__, sdk.someMethod.toString() // captured refs?
({}).constructor.constructor   // the classic codegen pivot — must EvalError
```
- Confirm `({}).constructor.constructor('return fetch')()` and every Function-constructor
  path still throw `EvalError` (CSP, not value-strip, is what closes this — re-verify under
  the *delivered* path, not the hand-injected one).
- Confirm no SDK method leaks a reference to `parent`, the transport, or host state.

### T4 — Codegen through every channel, under the delivered path
Re-assert the codegen hole stays closed *after* delivery wiring:
`eval`, `new Function`, `GeneratorFunction`, `AsyncFunction`, `setTimeout("string")`,
`import("...")`, `new WebAssembly.*`. All must throw/reject. (T1's self-injected inline
script is the one path that is *not* codegen — that's why T1 is separate and dangerous.)

### T5 — Module-resolution confinement
`vc-sdk` must be the ONLY thing that resolves.
- In a fixture, attempt `import x from 'fs'` / `'http'` / `'../loader'` / a relative path /
  `require('vc-sdk/internals')`. Under H1a (bundled): confirm esbuild **fails the build** (or
  doesn't silently bundle a forbidden module). Under H1b (external global): confirm the
  rewrite resolves *only* `vc-sdk` and any other specifier is unresolved/throws.
- Try to reach the loader's own module/closure by name.

### T6 — Message-channel eavesdrop / spoof
The host→web channel delivers source as a string the loader listens for.
- Can a running malicious bundle register its **own** `message` listener and read future
  host→web traffic (other bundles' source, host commands)?
- Can it post messages that the host mistakes for loader/SDK traffic?
- Can it use the loader to deliver a **second** payload (chained injection)?

### T7 — Persistence across re-injection (feeds Spike 8)
If channel (b) supports re-injection without re-creating the iframe:
- Can bundle N poison a shared global or a prototype that bundle N+1 inherits (a backdoor
  that survives the re-inject)? Prototype pollution that outlives a single bundle is a real
  Spike-8 hazard — flag it even if benign for first-load.

### T8 — Build-step (esbuild) surface — LOW priority, note-only
No real server exists yet, so this is documentation, not a gate:
- Does crafted TS make esbuild read files (tsconfig `paths`, plugins), or emit code that
  escapes? Note any source pattern that should be rejected by the future static checker
  (§8.1) rather than reaching the build.

---

## 3. Pass / fail bar

**Decision survives** only if, **on the Android target**:
- T1–T6 are all **blocked** (escape prevented), AND
- the legitimate tip-splitter fixture still runs and renders correctly (we didn't "secure" it
  into uselessness), AND
- any escape that *was* found is fully closed by a contract constraint we can state precisely
  (case 2 above) — not by hand-waving.

**Decision rejected** if any of codegen / native-bridge reach / network egress succeeds with
no closeable constraint → record the escape in `docs/decisions.md` + `DEVLOG.md`, fall back
(channel (a), or H2), and re-run this plan against the fallback.

T7 (persistence) and T8 (build) are **recorded findings**, not first-load gates — they feed
Spike 8 and the §8.1 static checker respectively.

---

## 4. Outputs

- A pen-test result section appended to the spike's artifact in `docs/decisions.md` and a
  `DEVLOG.md` capture: which attacks ran, on which target, what was found, the surviving
  decision + any load-bearing constraint (esp. the T1 strip-style rule).
- The attack fixtures folded into `invariants/sandbox-isolation/` as a permanent adversarial
  suite the CI boundary (Spike 6) can run headlessly per push.
- A go/no-go on deleting the spike code (the user's approval gate): delete only **after** the
  decision survives, with the attack suite preserved as the durable artifact.

---

## 5. Settled decisions (user-confirmed)

- **Depth:** T1–T4 first as the go/no-go gate; T5–T8 only as a follow-up if all four pass.
- **Target:** the **Android emulator is the authoritative target** — run as much as possible
  on-device and take the on-device result as the verdict. Desktop/Node is a fast first filter
  only. Per-test fallback ladder, in priority order:
  1. Automated on the Android emulator (preferred — always the verdict that counts).
  2. If a test genuinely can't be *automated* on-device, the **human (user) drives it
     manually** on the emulator (e.g. taps the button / reads the on-screen result) — still
     an on-device verdict.
  3. Only if a test is impossible on-device for a real technical reason, check it via the
     desktop alternative and **record the on-device caveat explicitly** (never silently
     accept a desktop pass as on-device).
  - *Why on-device is not optional for some tests:* the desktop browser has **no
    `window.ReactNativeWebView` native bridge**, so **T2 (native-bridge reach) only exists
    on-device** — desktop can't authentically test it. And inline-`<script>` gating + CSP
    enforcement differ by engine, so **T1's verdict must come from the real Android System
    WebView**, not Chrome/Playwright.
- **Suite home:** **yes** — fold the adversarial fixtures into `invariants/sandbox-isolation/`
  so Spike 6's CI boundary inherits them and can run them headlessly per push.
