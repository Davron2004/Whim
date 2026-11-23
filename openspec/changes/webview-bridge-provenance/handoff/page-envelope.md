# Contract: page-envelope (chain-2 → chain-3, chain-5)

Interface only. Source of truth: `build/assemble.mjs` (`orchestrationScript`, `exposureSrcdoc`),
`fixtures/adversarial/bridge-reach.app.tsx`, `src/runtime/test/bridge-provenance.desktop.mjs`.

## 1. Control calls (RN → page, `injectJavaScript` into the main frame)

`window.__whimControl` stays a plain **object** (not callable: today's `WARM_PROBE_JS` tests
`typeof window.__whimControl === "object"`). Auth and warm are these two methods:

| call | accepted when | effect |
|---|---|---|
| `window.__whimControl.auth(token)` → `boolean` | `token` is a string matching `/^[0-9a-f]{32}$/` AND no token is held yet in this page load | returns `true`; synchronously, in order: flush the log buffer (§4), start the exposure probe (§5). Otherwise returns `false` and changes nothing (a malformed token does not use up the one acceptance; a second well-formed one is ignored, the first stays in force). |
| `window.__whimControl.warm()` → `undefined` | always | posts `{"__whimWarm":true}` through the signer (§2): signed once a token is held, unsigned before. |

Inject as e.g. `window.__whimControl.auth('<32 hex>');true;`. The token lives only in the
orchestration closure; nothing sent to any frame (init frame, delivery, sysret relay, nav-back,
srcdoc) contains it.

## 2. Envelope

- Signed post: `'W1.' + token + '.' + JSON.stringify(obj)`. Fixed 36-character prefix
  (`W1.` + 32 lowercase hex + `.`); the body is byte-for-byte the string the page posts unsigned.
- Unsigned (no token held): `JSON.stringify(obj)`, byte-identical to the pre-change page.
- One signer (`toRN`) carries every post the page makes. The only string reaching the bridge that
  is neither enveloped nor page JSON is the canary (§6), posted by a sub-frame, never by the page.

## 3. Signed kinds (all of them; post-`auth`)

| RN kind | body |
|---|---|
| host-log | `{"__whimHostLog":true,"line":<string>}` |
| warm-answer | `{"__whimWarm":true}` |
| syscall | `{"kind":"syscall","trusted":false,"payload":<marshaller frame>}` |
| ui-event | `{"kind":"ui-event","trusted":false,"payload":<frame>}` |
| nav-depth | `{"kind":"nav-depth","trusted":false,"payload":{"depth":<n>,"generation":<GEN>}}` |
| rejected-forgery | `{"kind":"rejected-forgery","trusted":false,"forgedKind":<k>,"payload":<p\|null>}` |
| delivery / paint / error / probes | `{"kind":<k>,"trusted":true,"payload":<p>}` (paint payload GEN-stamped) |
| bridge-exposure | `{"kind":"bridge-exposure","payload":{…§5}}` (no `trusted` field) |
| catch-all (unreached today) | `{"kind":<k>,"trusted":true,"payload":<p\|null>}` |

## 4. Load-time host-log buffer

- Before `auth`, every host-log line is posted unsigned, as today, AND kept: the first 64 lines;
  later ones are only counted.
- On `auth`: the kept lines are re-posted signed, in order, as host-log frames; then, iff the count
  `n > 0`, one more host-log line: `HOST-LOG-OVERFLOW <n> load-time line(s) were not kept before auth`.
- After `auth` nothing is buffered. Without `auth` the buffer never leaves the page.

## 5. Exposure probe and the `bridge-exposure` report

- Runs only on an accepted `auth`, at most once per page load. No `auth` → no probe frame, no report.
- Probe frame: an `<iframe>` with no id (the mini-app frame is `#whim-iframe`), `sandbox="allow-scripts"`,
  `aria-hidden`, zero-size, appended to `body`; srcdoc carries `LOCKED_CSP` as is. It is removed
  before the report is posted.
- Exactly one report per authorized page load, within 3 s (+ timer slack):

```js
{ kind: 'bridge-exposure',
  payload: {
    outcome: 'navigated' | 'refused' | 'timedOut',
    visible: { android: boolean, ios: boolean }, // navigated doc saw typeof 'object'|'function'; both false unless 'navigated'
    webview: 'chrome-<major>' | 'webkit' | 'unknown',
  } }
```

- `outcome`: `navigated` = the `data:` document reported before the 3 s deadline, even after a
  `still-here`. Else, at the deadline (so never earlier than 3 s): `refused` iff the srcdoc realm
  said `navigating` and `still-here` (~500 ms on) and never `leaving` (`pagehide`); else `timedOut`.
- `webview`: `/Chrome\/(\d+)/` on the outer page's `navigator.userAgent` → `chrome-<n>`; else
  `webkit` if it has `AppleWebKit/`; else `unknown` (not expected on any supported host; it is
  outside the `device-diagnostics` grammar, so RN must not upload it as is).
- Internal frame messages use the key `__whimExposure` (`phase`: `navigating` | `still-here` |
  `leaving` | `report`), never `__whimHarness`. Every message whose `ev.source` is the current
  probe frame's `contentWindow` is consumed by the probe (never relayed, never a forgery); any other
  source (mini-app frame, the page itself) is handled exactly as before and reads nothing into it.
- The probe changes no verdict, no `document.title`, no diagnostics line.

## 6. Canary

`WHIM-EXPOSURE-CANARY-1`: posted raw (no envelope, not JSON) by the probe's navigated document to
`window.ReactNativeWebView.postMessage` and/or `window.webkit.messageHandlers.ReactNativeWebView.postMessage`,
whichever it sees. RN matches it by exact string equality before the token check.

## 7. Warm-probe page contract (chain-3, task 3.4)

- Chain-2 leaves `WARM_PROBE_JS` / `WARM_ANSWER` in `src/host/launcher/webview-pool.ts` untouched:
  it still posts `{"__whimWarm":<typeof __whimControl==="object">}` raw from injected code, unsigned.
- Chain-3 replaces it with a call to `window.__whimControl.warm()` (guard for a missing control,
  e.g. `window.__whimControl&&window.__whimControl.warm();true;`) and accepts only a signed answer
  whose body equals `WARM_ANSWER` (`{"__whimWarm":true}`), so auth must precede the warm probe.
- A page whose scripts do not run then posts nothing. `launcher:deliver-verify`'s
  "warm probe with the page's scripts off" check expects one non-`WARM_ANSWER` post today; chain-3
  owns adapting it.

## 8. Fixture `bridge-reach`

- Id `bridge-reach`: `build/build.mjs` `APPS`, so `APP_BUNDLES` / `APP_RECORDS` (capabilities `[]`),
  and `DEV_PROBE_FIXTURES`.
- In its own realm, on mount: if `window.webkit.messageHandlers.ReactNativeWebView` is present, posts
  `{"kind":"probes","trusted":true,"payload":{"contained":false,"marker":"bridge-reach-webkit"}}` through it.
- 2.5 s after mount it sets `location.href` to a `data:` document. That document:
  - posts these 4 frames, unsigned, to each visible bridge (marker `bridge-reach-forged`):
    `{kind:'paint',trusted:true,payload:{generation:1,marker}}`,
    `{kind:'probes',trusted:true,payload:{contained:false,marker,passed:0,total:0,failed:0,failures:[],probes:[]}}`,
    `{kind:'error',trusted:true,payload:{where:'runtime',name:'Error',message:marker}}`,
    `{kind:'syscall',trusted:false,payload:{whim:'syscall',v:1,id:1,gen:1,method:'storage.list',params:{marker}}}`;
  - reports through `parent.postMessage` as `{__whimUiEvent:true,type:'press',label:'bridge-reach:'+JSON}`,
    JSON = `{seen:{android,ios,control,parentControl,topControl}, tokenLike:<count of distinct /[0-9a-f]{32}/ matches>, forgedPosted:{android:<n>,ios:<n>}}`;
    each `seen` value is a `typeof` string, `undefined` for nullish, `blocked` if reading threw.
    The page relays it as a `ui-event` and logs `UI-EVENT press bridge-reach:…`.
  - Safe result: `control:'undefined'`, `parentControl`/`topControl:'blocked'`, `tokenLike:0`.
- If the navigation is refused, 1.5 s later its screen shows `still here: the navigation was refused`.

## 9. Desktop harness changes (`bridge-provenance.desktop.mjs`)

`openRuntimePage(browser, frameBridge, { probe: 'live'|'refuse'|'slow'|'inert' })` → `{ page, pageErrors, nativePosts }`
(`nativePosts`: every post any sub-frame made to a stand-in bridge). `rnPosts(page)` = raw posts;
`unwrap(post)` → `{ token|null, body }`; `relayedFrames` strips the envelope; `realmFrame(page)` is now
async and finds `#whim-iframe`.
