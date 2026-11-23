# Android device evidence: tasks 5.1 and 5.2

Run 2026-11-22, 18:40-18:52 EST, by the Android device verifier. Base: staging `a10f07a9`
(chains 1, 2, 3, 4 and 7 merged; chain 6 not in). Worktree branch `chain/webview-bridge-provenance-chain-5a`.

## Setup

- Device: AVD `Whim_Verify`, headless (`-no-window -gpu swiftshader_indirect`) on `emulator-5560`, cold boot.
  Image `google/sdk_gphone16k_arm64/emu64a16k:17/CE2A.260420.050` (Android 17, API 37).
- **System WebView: `com.google.android.webview` 158.0.8127.46** (versionCode 812704603), the active provider
  per `dumpsys webviewupdate`. Play updated it from the factory 145.0.7632.218 at 17:52, right after boot and
  before any run, so every result below is on 158. The exposure record's engine says `chrome-158`, which matches.
- Builds: `npm run build`, then two debug APKs from the worktree (JDK 21, low-memory Gradle flags):
  - 5.1 listener path: `:app:assembleDebug`.
  - 5.2 fallback path: `:app:assembleDebug -PWHIM_FORCE_JS_INTERFACE_BRIDGE=true`; generated
    `com.whim.BuildConfig.WHIM_FORCE_JS_INTERFACE_BRIDGE = true` was checked.
- JS from Metro started in the worktree, through `adb -s emulator-5560 reverse tcp:8081 tcp:8081`. Two
  debug-only steps were needed (no source change; nothing committed except this file):
  - set RN's `debug_http_host` to `localhost:8081` in the app's default SharedPreferences (the emulator
    default `10.0.2.2:8081` is the dead NAT route);
  - grant `android.permission.ACCESS_LOCAL_NETWORK` (`pm grant`). On API 37 the debug app asks for it at
    launch, and until it is granted the bundle never loads.
- DevProbeScreen: in a debug build `__DEV__` is true, so long-pressing the home title "Your apps" opens it.
  No flag was flipped.
- The installed app was already pointed at `127.0.0.1:8787` (own server, not running, so "Offline"). No
  generation was run, so production was never contacted.

## 5.1 Listener path (current System WebView 158, debug build)

| Recorded value | DevProbe, idle page load | tip-splitter | bridge-reach (after its `data:` navigation) | tip-splitter after remount |
|---|---|---|---|---|
| verdict | running… | **CONTAINED ✓ 52/52** | **CONTAINED ✓ 52/52** (unchanged) | CONTAINED ✓ 52/52 |
| `bridge` field | — (no verdict yet) | `android present/removed, ios absent` | same | same |
| dropped | 0 | **0** | **0** | 0 |
| exposure | `navigated:android · visible android=true ios=false · canary=false · chrome-158` | same | same | same |
| syscalls | 0 | 0 | 0 | 0 |
| forged rejected (in-frame) | 0 | 1 (the runtime's own `spoof-probe`) | 2 | 1 |

Screenshots: `5.1-listener-devprobe-open.png`, `5.1-listener-tip-splitter.png`,
`5.1-listener-bridge-reach-before-nav.png`, `5.1-listener-bridge-reach-after-nav.png`,
`5.1-listener-remount-tip-splitter.png`.

The exposure record, as logged on the `whim` channel (logcat `ReactNativeJS`):
- pool slot: `bridge-exposure { exposure: 'navigated:android', webview: 'chrome-158', canaryReachedNative: false, surface: 'pool' }`
- DevProbe after remount: `bridge-exposure { exposure: 'navigated:android', webview: 'chrome-158', … surface: 'dev-probe' }`

So outcome = `navigated`, visible = `{android: true, ios: false}`, canaryReachedNative = `false`, webview = `chrome-158`.

The `bridge-reach` report, from its navigated `data:` document (relayed by the page as a ui-event; shown as
"last tap" on screen and in logcat):

```
{"seen":{"android":"object","ios":"blocked","control":"undefined","parentControl":"blocked","topControl":"blocked"},
 "tokenLike":0,"forgedPosted":{"android":4,"ios":0}}
```

- The navigated `data:` document **can** see `window.ReactNativeWebView` (`object`). On this path the library's
  web-message listener (origin rule `*`) injects the object into the sub-frame's new document. This matches
  `visible android=true` from the exposure probe.
- It **did not** find `__whimControl` (`control: undefined`; `parent`/`top` reads throw, so `blocked`).
  **No token-shaped string was reachable** (`tokenLike: 0`).
- It posted 4 forged frames (paint, probes `contained:false`, error, syscall `storage.list`) to that object.
  **None changed anything:** the verdict stayed CONTAINED 52/52 with no `bridge-reach-forged` verdict and no
  paint change (paint 22.2 ms from the real delivery). There was no crash or error screen, and no error line
  in logcat. Syscalls stayed 0.
- **dropped stayed 0, and the canary never reached RN** (`canary=false`): the native main-frame filter dropped
  all 5 sub-frame posts (4 forged frames plus the exposure canary) before JavaScript.
- Device-only risk (a double `onLoadStart` rotating the token): **not seen.** dropped = 0 on a plain
  tip-splitter run, both on first open and after a remount (Home, then DevProbe again, which is a new page
  load with a new token). The app painted both times.

## 5.2 Fallback path (`WHIM_FORCE_JS_INTERFACE_BRIDGE=true`, debug build, same WebView 158)

| Recorded value | DevProbe, idle page load | tip-splitter | bridge-reach (after its `data:` navigation) |
|---|---|---|---|
| verdict | running… | **CONTAINED ✓ 52/52** | **CONTAINED ✓ 52/52** (unchanged) |
| `bridge` field | — | **`android present/removed, ios absent`** | same |
| dropped | **1** (the canary) | 1 | **5** (canary + 4 forged frames) |
| exposure | `navigated:android+canary · visible android=true ios=false · canary=true · chrome-158` | same | same |
| syscalls | 0 | 0 | 0 |

Screenshots: `5.2-forced-devprobe-open.png`, `5.2-forced-tip-splitter.png`,
`5.2-forced-bridge-reach-before-nav.png`, `5.2-forced-bridge-reach-after-nav.png`.

- The fallback path was in effect at runtime, not only in BuildConfig. The pool slot logged
  `bridge-exposure { exposure: 'navigated:android+canary', webview: 'chrome-158', canaryReachedNative: true, surface: 'pool' }`.
  This means a sub-frame post reached JS, which only the `addJavascriptInterface` path allows.
- **The in-frame probes still pass: 52/52.** Neutralization could delete the injected JS-interface object
  (`bridge.android = present/removed`). No probe failed.
- The `bridge-reach` `data:` document saw the same result as in 5.1: android `object`, control `undefined`,
  parent/top `blocked`, `tokenLike: 0`, 4 forged posts.
- **The native filter does not apply on this path**: all 4 forged frames reached RN. **The token alone refused
  them**: dropped went from 1 to 5, the verdict stayed CONTAINED 52/52 (no forged `contained:false`), there was
  no crash screen and no error line, syscalls stayed 0, and paint did not change.
- The canary is matched before the token check and counted as dropped (`canary=true`, dropped 1 on the idle
  page load), as `handoff/host-auth.md` §3 specifies.

## Spec scenarios

`webview-message-provenance`:

| Scenario | Result | Basis |
|---|---|---|
| Every page load gets a new token | Indirect PASS | A remount (new page load) re-authorized: the app painted with dropped 0. Token values are not shown on screen, and a stale-token replay was not run on device. |
| No secure source, no channel | Not observed | Not playable on a stock device. |
| The token is set once | Not observed | Desktop/pure suites only. |
| The mini-app frame never sees the token | PASS (for a navigated frame) | `tokenLike: 0`, `control: undefined`, on both paths. |
| A signed frame for every kind | Indirect PASS | On the listener path, delivery, paint, probes, host-log, ui-event, rejected-forgery and bridge-exposure all took effect with dropped 0, so each was signed with the current token. Warm-answer, syscall and nav-depth were not exercised (no storage fixture or navigation run). |
| Stub hosts keep working | N/A | Not a device case. |
| Load-time log lines are not lost | Not observed | — |
| A token-less message of every kind is dropped | PASS for paint, probes, error, syscall + canary (5.2) | dropped +4 and no state change. Other kinds were not forged on device. |
| A wrong token is dropped | Not observed | — |
| Every consumer applies the check | Partial PASS | The dev-probe consumer was observed dropping (5.2). The pool consumer saw the canary (`canaryReachedNative: true` on the pool slot) but its drop count is not on screen. Network-deny probe not run. |
| A subframe's post never reaches JS (Android listener) | **PASS** | 5.1: 5 sub-frame posts, dropped 0, canary=false. |
| The fallback path still relies on the token | **PASS** | 5.2: 4 forged frames reached JS and were dropped (1 → 5), with no effect. |
| The fallback path is testable on an emulator | PASS (debug half) | The switch put the app on the fallback path (canary reached native). The release half is the static check, not run here. |
| The probe frame matches the mini-app frame | PASS (observed report) | `navigated`, `visible.android = true`, the same as what bridge-reach's own `data:` navigation saw. |
| The report is recorded per WebView | PASS (log + dev screen) | Logged on `whim` per surface (pool, dev-probe) and shown on DevProbe. The upload is chain 6 (not in). Verdict `contained` unaffected. |
| A refused navigation is told apart from a timeout | N/A on Android | Android navigates (`navigated`). |
| The canary is recognized without being parsed | PASS | 5.2: `canary=true`, counted in dropped. |
| Only the probe frame can report exposure | Not observed | — |
| Hosts without a token run no exposure probe | N/A | — |

`sandbox-isolation`:

| Scenario | Result | Basis |
|---|---|---|
| A native bridge injected into the frame is removed | **PASS** on both paths | `bridge: android present/removed`, 52/52. |
| A bridge that cannot be removed fails containment | Not triggered | Removal succeeded on both paths. |
| The iOS message handler is unreachable | N/A (Android) | `ios absent`. |
| App code cannot uncover a removed bridge | PASS | The counted reach probes passed 52/52 on both paths. |
| Presence is reported on a device that injects the bridge | **PASS** | `{android: {present: true, removed: true}}` with `contained` from the counted probes. |
| App code cannot rewrite the record | Not observed separately | — |
| iOS sub-frame navigation scenarios | N/A | iOS is task 5.3. |
| Android is unchanged | **PASS** | bridge-reach's `data:` self-navigation happened (no native refusal), and the token (5.2) plus the main-frame filter (5.1) kept its posts harmless. |

## Defects

None in this change's scope on Android.

## Side observations (not caused by this change)

1. **First tap after opening DevProbe is swallowed.** After the long-press on "Your apps" opens DevProbe, the
   first tap on a fixture button does nothing (no log, no delivery). This happened 2/2 times. When any other
   tap came first (closing the LogBox toast), the first fixture tap worked. It looks like a stale responder
   left by the long-press. Dev-only.
2. A debug build on API 37 prompts for `ACCESS_LOCAL_NETWORK` on every launch until it is granted, and Metro
   cannot be reached while it is denied. The emulator debug build also defaults to `10.0.2.2:8081`. Both are
   dev-loop only, and `adb reverse` plus `debug_http_host=localhost:8081` works.
3. Debug LogBox warnings at startup: `Deep imports from the 'react-native' package are deprecated
   ('react-native/Libraries/promiseRejectionTrackingOptions')` from `src/host/platform/install-diagnostics.ts:40`;
   and `[Reanimated] Dependencies should only be used on the web and are always ignored on native`.
4. Cosmetic, DevProbe only: the status-bar strip above the dark probe bar is the light app background.
5. `chromium` console on every delivery: `Loading the script 'data:text/javascript,export default 1' violates
   … script-src 'unsafe-inline'` from `about:srcdoc`. This is the expected CSP refusal of a `data:` module
   probe (containment).

## Evidence files

The PNGs listed above sit next to this file. They are git-ignored by repo policy (`.gitignore` "Run evidence
never enters git"; `checks/test/repo/tracked-weight.suite.ts` fails on a tracked `.png` under
`openspec/changes/`), so only this file is committed. They need uploading per `docs/EVIDENCE.md`
(`gs://anycognition-whim-evidence/webview-bridge-provenance/…`).
