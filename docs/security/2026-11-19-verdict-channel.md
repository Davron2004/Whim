# A mini-app could forge the containment verdict (2026-11-19)

Status: fixed in `build/assemble.mjs` (the outer page) and `src/runtime/web/loader.js`, with the
same parent capture in `src/runtime/web/syscall.js`. Pinned by `npm run invariants` (section 3c,
`invariants/sandbox-isolation/verdict-channel.mjs`) and by the synthetic-run acceptance case
`stolen nonce`. Decision #86. The four containment legs (sandboxed iframe, CSP, neutralized globals,
native network refusal) were never affected: this blinded the detector, it opened no escape.

## The finding

The containment verdict reaches the host as a `probes` frame tagged with a per-realm nonce
(constraint #4, spike2): the outer page sends the nonce to the loader in the init frame, and trusts a
frame only if it carries it. Two things let app code sign its own verdict.

1. **The outer page answered every `hello`.** The `kind === 'hello'` branch had no once-only guard
   and no sender check, and its reply went to the iframe's window, where any listener sees it. A
   bundle that registered a `message` listener and posted `hello` again got the nonce and posted
   `{contained: true, total: 999}`, which the host tagged `trusted: true`.
2. **The loader read `window.parent` on every post.** `window.parent` is a [Replaceable] attribute,
   so a bundle that reassigned it received every later loader frame: it could drop the real paint
   and verdict, or read the nonce straight off them.

The audit reproduced both in headless Chromium against the build at `aaa1c6ea` and noted that the
synthetic run (`synthrun/observe.ts`) uses the same page and takes the `trusted` tag as given, so a
candidate could fool the server's containment check. Static checks rejected the plain attack because
it touches `globalThis`, but static checks are not authoritative for containment.

## Root cause, and the rest of the class

The nonce is a secret held in a realm the attacker shares. After delivery, every global and every
built-in prototype in that realm is the bundle's to rewrite, so the secret is only as safe as the
least-guarded thing it passes through. Probing that idea against the same build turned up ten more
routes to the same outcome (all reproduced on `aaa1c6ea`, all closed by this fix):

| Route | What app code did | Outcome before the fix |
|---|---|---|
| Re-`hello` (audit) | listener + second `hello` | forged verdict trusted |
| Re-`hello` + `parent` sink (audit) | the above, then `window.parent = {postMessage(){}}` | forged verdict trusted, real paint and verdict never arrive |
| Self-navigation | `location.href = 'data:text/html,…'`; the new document says `hello` | forged verdict trusted |
| Channel (a) | the baked bundle ran at parse time, before the init frame arrived | its listener read the nonce |
| `parent` recorder | `window.parent` replaced by an object that reads and forwards | nonce read off the loader's `paint`; real verdict dropped |
| `JSON.stringify` | the global rebound to a wrapper | nonce read off the frame object |
| `Object.prototype.toJSON` | an inherited getter | the genuine `paint` frame rewritten into a forged `probes` frame |
| `Promise.prototype.then` | rebound | app code held the loader's verdict callback and fed it a forged result |
| Inherited `__whimDeliver`/`bundle` getters | planted on `Object.prototype` | a host `navBack` frame read as a delivery: a second generation, on the attacker's schedule (A1 bypass) |
| `window.__whimAfterBundle` | replaced | no mount, no paint, no verdict |
| `window.__whimGeneration` | set to `-1` | mount skipped, no verdict |
| `requestAnimationFrame` | replaced | paint and verdict never posted |

## The fix

The rule: **the nonce goes out once, to the loader, and from then on it and the frame envelope pass
only through things captured before any app code ran.**

- **One handshake per iframe** (`build/assemble.mjs`). The outer page answers a `hello` only if it
  comes from the current iframe (`ev.source === iframe.contentWindow`) and is the first one since
  that iframe was created. The loader's `hello` is always the first: it is posted while the srcdoc
  parses, before any app code exists. Any later `hello` (app code asking again, a document the frame
  navigated to, a reloaded srcdoc) is relayed as `rejected-forgery` with `forgedKind: 'hello'`. An
  authenticated frame must also come from the current iframe, after the handshake.
- **No guessable nonce.** The fallback that built a nonce from a constant and `performance.now()`
  when `crypto.getRandomValues` failed is gone: without a CSPRNG the nonce is null and the channel
  stays closed (no verdict, which the hosts read as unverified).
- **The loader captures its trusted path at load** (`loader.js`, "Captured before any app code
  runs"): the parent window and its `postMessage`, `Reflect.apply`, `JSON.stringify`/`parse`,
  `Promise.prototype.then`, `requestAnimationFrame`, the `MessageEvent` `source`/`data` getters,
  `React`/`ReactDOM` and the mount root. Frames are assembled by string concatenation around a head
  built once from the init frame, so the nonce is never handed to a function app code could have
  replaced and the `kind` is always one of the loader's literals. Payloads are copied as plain data
  (own, enumerable data properties, into prototype-less objects) before serialization, so no getter
  or inherited `toJSON` runs. Host frames are read through own-property checks.
- **The loader's state is its own.** The generation count lives in the closure;
  `window.__whimGeneration` is a read-only view. `window.__whimAfterBundle` is non-writable and
  non-configurable. A delivery is refused until the handshake is complete.
- **Channel (a) no longer runs app code before the handshake.** The parser-inserted script now only
  defines the wrapped bundle; the loader runs it after the init frame, as channel (b) does. It is
  still a parser-inserted inline script executing under the locked CSP.
- `syscall.js` captures the parent at load too, so a bundle can't make its own self-posted `sysret`
  pass the source check by reassigning `window.parent` (inert before, since it only fooled itself,
  but the stated invariant `ev.source === window.parent` now holds).

## Evidence

Headless Chromium (Playwright's bundled build), the shipping assembler and runtime parts, each
attack delivered in front of the real tip-splitter bundle, frames read from the outer page's relay:

- Before: all twelve routes above succeed on `aaa1c6ea`. The synthetic run reported
  `contained: true` for the audit's attack (and `ok: true` without the `parent` sink).
- After: every route fails; in each case the genuine `paint` and the genuine verdict
  (`contained: true`, 49/49) still arrive trusted, and no frame carrying the attacker's tag does.
- `npm run invariants` section 3c runs the twelve routes plus two negative controls that patch the
  fix back out (a host that answers every `hello`; a loader that posts through the live
  `window.parent`). Against main's runtime all twelve fail and both controls are void (there is
  nothing to patch out); against this fix all twelve pass and both controls are flagged.
- `synthrun/test/acceptance.ts` `stolen nonce`: a candidate that asks again and swaps
  `window.parent` forges a breach verdict; the report must keep the genuine `contained: true`.

## What stays out of reach

The verdict channel is now sound: only the loader can produce a frame the host trusts, and app code
can at most keep the verdict from arriving (by hanging the realm, say), which the synthetic run
reports as `containment_unobserved` and the device host leaves at "running". What this fix does not
change, and what the verdict should not be read as claiming:

- **The probes measure the realm the app has already run in.** `probes.js` runs after the bundle,
  with the realm's live built-ins (`Array.prototype.filter`, `Promise.prototype.then`, …). App code
  that rewrites those can make the genuine loader post `contained: true`. This needs no nonce and
  is not a channel problem: it is inherent to measuring a realm the attacker controls. It matters
  only when containment is actually broken, and an app holding a real breach could also mask the
  probed object itself (re-wrap a reachable `fetch` in a thrower). The verdict is a regression
  detector for the platform legs, not proof that a hostile app did not escape. Closing this needs a
  verdict that does not depend on post-delivery state: for example running the probes once more
  before the bundle is delivered and requiring both. That changes what the synthetic run's spec'd
  cases observe (a candidate that never paints would then still produce a probe run, and its T6
  spoof rejection), so it is an owner decision, not part of this fix.
- **Device: a frame posting straight to the native bridge.** On Android, react-native-webview
  registers `ReactNativeWebView` with `addWebMessageListener(…, Set.of("*"), …)` and ignores
  `isMainFrame`, and the RN host does not check where a message came from. If the bridge object is
  injected into an opaque-origin frame, a document the mini-app frame navigates to (a `data:` URL is
  not a network load, so the native leg does not refuse it) could post `{kind: 'probes', trusted:
  true}` to RN without passing the outer page. Unverified: whether `"*"` matches opaque origins. To
  check on device, have `neutralize.js` record `typeof window.ReactNativeWebView` before the loader
  replaces it, and navigate the frame to a `data:` document that reports the same. On device the
  verdict only feeds the dev probe screen, so the impact there is diagnostic; the frames that do
  act (paint, error, syscall) would be worth the same check.

  **The answer can differ by device.** react-native-webview (13.16.1) picks its bridge at
  runtime (`RNCWebView.java`, `createRNCWebViewBridge`): `addWebMessageListener` with `"*"` only
  when the device's System WebView supports `WEB_MESSAGE_LISTENER`, and otherwise
  `addJavascriptInterface`, which Android documents as exposing the object to **every** frame
  with no origin control. A phone whose System WebView is old enough to lack the feature takes the
  fallback path, where the question above is already answered, even if current WebViews turn out
  not to inject into opaque origins. Even on the listener path, the library drops `isMainFrame`
  (it forwards the sender's origin as the event's `url`, and the host reads only
  `nativeEvent.data`, `src/host/launcher/MiniAppView.tsx`), so the RN host cannot tell a subframe
  message from the outer page's today. iOS is a separate mechanism (WKWebView script message handlers)
  and a separate question. The device check therefore has three cases, not one: a current WebView
  (listener path), a WebView on the fallback path, and iOS.

  Upgrading does not change this. RN 0.86 through 0.88 touch nothing here, and react-native-webview
  14.0.1 (`latest`) and 17.1.0 (`next`) carry the same Android bridge code: `"*"`, `isMainFrame`
  dropped, the same fallback. On iOS the library registers its messaging script
  `forMainFrameOnly:YES`, so the `window.ReactNativeWebView` wrapper exists only in the top-level
  page. Whether the underlying `window.webkit.messageHandlers.ReactNativeWebView` handler is
  reachable from a subframe is unchecked (research for `upgrade-to-latest-dependencies`,
  2026-11-20).

  **Proposed fix (not implemented; the change after `upgrade-to-latest-dependencies`):**
  1. *Reproduce first.* A fixture mini-app navigates its frame to a `data:` document that reports
     `typeof window.ReactNativeWebView` and, when present, posts a marked `probes` frame straight to
     RN. Run it on all three cases above. That fixes the urgency; the fix is likely needed
     regardless, since the fallback path is exposed by Android's own description.
  2. *Primary: authenticate the outer page → RN hop.* RN generates a random token per WebView and
     hands it to the outer page through a main-frame-only channel (main-frame-only injected
     script). The outer page keeps it in a closure and attaches it to every `toRN` message. RN drops
     any message without it before reading anything else, for every kind (paint, error, syscall,
     nav-depth, probes). This holds however the bridge is exposed (both Android paths, iOS) and
     does not depend on whether `"*"` matches opaque origins. Unlike the iframe nonce, the token
     lives in a realm that never holds app code, and a subframe cannot read the outer page's realm.
  3. *Second layer: drop non-main-frame messages natively.* Patch react-native-webview's listener
     path to drop messages with `isMainFrame == false` (and offer it upstream). The synthetic run
     already has the server-side equivalent: `synthrun/capability.ts` returns early when
     `source.frame !== source.page.mainFrame()`. This cannot be the only fix: the fallback path
     does not know the sender's frame.
  4. *Rejected:* refusing the frame's navigation natively (Android does not reliably surface
     subframe navigations, and a `data:` URL is not a network load); requiring a minimum WebView
     version to avoid the fallback (still leaves the `"*"` question).
  5. *Tests:* a host-side test that a token-less message of every kind is dropped, red-checked
     against the weaker variant that checks the token on `probes` only; the step-1 fixture kept as
     an on-device acceptance case.
