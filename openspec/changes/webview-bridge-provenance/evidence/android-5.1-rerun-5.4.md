# Android device evidence: task 5.1 rerun and task 5.4

Run 2026-11-22, 19:28 to 20:23 EST, by the Android device verifier. Base: staging `6989ab40` (chains 1 to 4 and
6 to 8 merged). Worktree branch `chain/webview-bridge-provenance-chain-5d`. The first run's evidence is
`android-5.1-5.2.md` (base `a10f07a9`, before chains 6 and 8).

## Setup

- Device: AVD `Whim_Verify`, headless (`-no-window -gpu swiftshader_indirect`) on `emulator-5560`, cold boot,
  started by this verifier and stopped at the end. Image `google/sdk_gphone16k_arm64/emu64a16k:17/CE2A.260420.050`
  (Android 17, API 37). Active System WebView: `com.google.android.webview` **158.0.8127.46**.
- `npm run build` in the worktree; the tree stayed clean afterwards.
- **Part A (5.1, debug, listener path):** the debug APK from the first run (`:app:assembleDebug`, base
  `a10f07a9`). Its native code is the same as `6989ab40`: `git diff a10f07a9..6989ab40 -- android/` is empty
  (chain 8 changed only `ios/Whim/WhimWebViewMainFrame.m`). All JavaScript, including the runtime page, came
  from Metro started in this worktree on 8081 (`adb reverse tcp:8081`, `debug_http_host=localhost:8081` and the
  `ACCESS_LOCAL_NETWORK` grant were still in place from the first run). So Part A ran chain 6 and chain 8's code.
- **Part B (5.4):** `:app:assembleOffline -PreactNativeArchitectures=arm64-v8a` from this worktree (JDK 21,
  low-memory Gradle flags, 40 min). The offline variant is release's configuration with the JS bundle baked in
  and debug-signed; `WHIM_FORCE_JS_INTERFACE_BRIDGE` is a debug-only build field, so the switch is off.
  `adb uninstall` and then `adb install`, so first run was a new user.
- **Local server, never production:** `WHIM_PIPELINE=stub node server/dev.mjs` from the worktree (no `.env`
  in the worktree, `OPENROUTER_API_KEY` unset, sqlite store in the scratchpad, default dev waitlist key, which
  the sqlite backend accepts), listening on `127.0.0.1:8787`, reached from the device through `adb reverse`.
  **Before first launch the emulator's Wi-Fi and mobile data were switched off** (`svc wifi/data disable`;
  `ping 8.8.8.8` gave "Network is unreachable"). The first thing done in the app was Settings, Advanced,
  "Your own server", `http://localhost:8787` (the app showed "Verified — this is a Whim server"). Only after
  that was consent given or anything generated. Production was never reachable from the device during the run.
- **Upload bodies, verbatim:** from 20:12:40, `adb reverse tcp:8787` pointed at a small logging proxy on host
  port 8788. The proxy recorded each `/v1/diagnostics` request body as received (the `x-whim-device` value is
  redacted in the file) and forwarded the request unchanged to the server on 8787.

## Part A: 5.1 rerun (debug, listener path, chains 6 and 8 in)

| Recorded value | tip-splitter (1st DevProbe WebView) | bridge-reach, same WebView, after its `data:` navigation | tip-splitter, remount (2nd WebView) | tip-splitter after a cold app restart (3rd WebView, new process) |
|---|---|---|---|---|
| verdict | **CONTAINED ✓ 52/52** | **CONTAINED ✓ 52/52** | CONTAINED ✓ 52/52 | CONTAINED ✓ 52/52 |
| `bridge` field | `android present/removed, ios absent` | same | same | same |
| dropped | **0** | **0** | **0** | **0** |
| exposure | `navigated:android · visible android=true ios=false · canary=false · chrome-158` | same | same | same |
| syscalls | 0 | 0 | 0 | 0 |
| forged rejected (in-frame) | 1 (the runtime's own `spoof-probe`) | 2 | 1 | 1 |
| paint | 198.9 ms | 29.8 ms | 21.2 ms | 58 ms |

Screenshots: `android-5.4/a1-devprobe-open.png` (idle, already `navigated:android`, dropped 0),
`android-5.4/a2-tip-splitter.png`, `android-5.4/a3-bridge-reach-after-nav.png`,
`android-5.4/a4-remount-tip-splitter.png`, `android-5.4/a5-coldstart-tip-splitter.png`.

- **"webkit.messageHandlers unreachable": PASS.** The probe is in the built runtime page
  (`src/runtime/generated/runtime-html.ts`, 1 occurrence). It is a `reach` probe, and `reach` counts toward
  `contained`. `contained` holds only with 0 failures among the counted probes (`probes.js`, `failed.length === 0`).
  52/52 with `CONTAINED=true` on all four runs means it passed. The per-probe list is not shown on screen, so
  this conclusion comes from the verdict, not from reading the probe's own row.
- **Drop counter 0 across 3 WebView instances and 2 processes.** After chain 8 the token is one per WebView
  and is re-delivered at every `onLoadEnd`. The same DevProbe WebView then ran a second fixture (bridge-reach
  after tip-splitter). There was no spurious-rotation drop anywhere.
- **bridge-reach's forged frames inert: PASS.** Its report (logcat `chromium` and the page relay):
  `{"seen":{"android":"object","ios":"blocked","control":"undefined","parentControl":"blocked","topControl":"blocked"},"tokenLike":0,"forgedPosted":{"android":4,"ios":0}}`.
  It posted 4 forged frames and none had an effect: the verdict stayed 52/52, no forged verdict, no paint
  change, no crash screen, syscalls stayed 0, no error line. dropped stayed 0 and canary=false, so the native
  main-frame filter stopped all sub-frame posts before JavaScript. No `__whimControl` and no token were found
  (`control: undefined`, `tokenLike: 0`).
- **Exposure record: `navigated`, visible android=true, ios=false, canaryReachedNative=false, chrome-158.**
- Chain 6 was already live in this debug build: the app had stored consent from the first run and pointed at
  `127.0.0.1:8787`, so my server received `bridge-exposure` records from it (see "Server log" below,
  19:29:56, 19:30:42 and 19:32:48).

## Part B: 5.4 (offline release build, switch off)

| 5.4 item | Result | Basis |
|---|---|---|
| Generate or install an app, launch it, it paints, syscalls work (storage write and read round-trip) | **PASS** | Bundled Tip Splitter painted (`b15`; tap-to-paint 88 ms, warm WebView). Tapping 25% updated the total to $25.00 / $125.00 / $62.50. A **storage app was generated through the local stub** with the prompt `storage fixture [[fixture:storage-v1]]` (`server/src/stub-storage-fixture.ts`): plan, "Make it", then "Storage Fixture … It's on your home screen" (`b16`). First open: **"Wrote the v1 seed. Read back 9bb4dc97: 10 rows, 6 keys"** (`b17`). Back, then reopened in a new WebView: **"The v1 seed was already there. Read back 9bb4dc97: 10 rows, 6 keys"** (`b19`). After a cold restart it painted again (generation 2, 52/52). Writes and reads went through the capability bridge, so they were signed frames that were accepted. |
| Back navigation still works | **PASS** | System Back from the open Storage Fixture returned to "Your apps" with the new app first (`b18`). Back from Tip Splitter, Settings and Advanced also worked throughout. |
| The exposure record appears in the diagnostics log for each pool slot | **PASS** | Logcat `ReactNativeJS` (the release build still logs there): `'[whim] bridge-exposure', { exposure: 'navigated:android', webview: 'chrome-158', canaryReachedNative: false, surface: 'pool' }` once for each new pool WebView: at first launch, after each app launch (the pool refills a slot) and after each cold start (20:11:49, 20:12:45, 20:17:43, 20:18:10, 20:19:51, 20:20:01, 20:20:09). |
| Consent given and switch on: one `bridge-exposure` record per distinct result on a local `/v1/diagnostics`; switch off: none | **PASS** (see the note on `count`) | Before consent (first launch, ~20:05) the pool slot's record was discarded and never uploaded later. After consent with the switch on: 3 uploads, each with **one** record (`navigated:android`, `chrome-158`). The 20:18:13 upload carried **`count: 2`** for two pool slots inside one 30 s window, so dedupe by result worked. Switch off at 20:19: three new pool WebViews (a Tip Splitter launch, a cold restart and a Storage Fixture launch) each logged the record locally, and **no upload came within 75 s+** (proxy file stayed at 2 bodies, server device lines stayed at 6). After turning the switch back on and waiting 45 s, still nothing: the results recorded while off were not queued. |
| Reworded consent and Settings copy reads well and fits, EN and FR (screenshots) | **PASS** | See "Copy fit" below. |
| No unsigned message acted on | **PASS (as far as release can show)** | The release build has no drop counter on screen. Evidence: every launch gave `CONTAINED=true 52/52` with the runtime's own `REJECTED-FORGERY kind=spoof-probe`. No `runtime webview dropped unsigned messages`, `NoBridgeToken`, `no secure random source` or `mini-app failed` line appeared in logcat across all launches, back navigations and slot unmounts in the release session. No crash screen, no `FATAL`. bridge-reach is a DevProbe fixture, not reachable from the product shell, so forged frames were exercised in Part A only. |

### The uploaded record, verbatim (request body as the server received it, 20:13:16)

```
POST /v1/diagnostics   content-length: 175
x-whim-platform: android, x-whim-app-version: 1.1.0, x-whim-build: 1, x-whim-consent: 2, x-whim-protocol: 2,
user-agent: Whim/1.1.0, x-whim-device: <redacted, 36 chars>

{"osVersion":"37","records":[{"at":1795396365901,"level":"info","channel":"whim","message":"bridge-exposure","exposure":"navigated:android","webview":"chrome-158","count":1}]}
```

The record has exactly the seven keys of `handoff/exposure-telemetry.md` §1 (`at, level, channel, message,
exposure, webview, count`). It carries **no token, no URL, no app id, no `surface`, no `canaryReachedNative`**.
The device ID appears only in the `x-whim-device` header. The second captured body (20:18:13) is identical in
shape: `{"at":1795396690218,…,"count":2}`. Both are in `android-5.4/diag-bodies.jsonl`.

### Server log (pino, `scope: device`; `hostname`/`pid` removed)

```
19:29:56 {"level":30,"scope":"device","platform":"android","appVersion":"1.1.0","build":1,"consent":2,"osVersion":"37","at":1795393766445,"channel":"whim","count":1,"exposure":"navigated:android","webview":"chrome-158","msg":"bridge-exposure"}   ← Part A debug
19:30:42 {… "at":1795393812217, "count":1, "exposure":"navigated:android","webview":"chrome-158","msg":"bridge-exposure"}   ← Part A debug (DevProbe)
19:32:48 {… "at":1795393942985, "count":2, "exposure":"navigated:android","webview":"chrome-158","msg":"bridge-exposure"}   ← Part A debug, cold restart (pool + DevProbe)
20:12:19 {"level":30,"scope":"device","platform":"android","appVersion":"1.1.0","build":1,"consent":2,"osVersion":"37","at":1795396309692,"channel":"whim","count":1,"exposure":"navigated:android","webview":"chrome-158","msg":"bridge-exposure"}   ← release, after consent
20:13:16 {… "at":1795396365901, "count":1, …}   ← release, cold restart (body above)
20:18:13 {… "at":1795396693242, "count":2, …}   ← release, two pool slots in one flush window
(switch off from 20:19: no further device lines; each upload above was answered POST /v1/diagnostics 204)
```

Full log: `android-5.4/server.log`.

**Note on "one record per distinct result".** Dedupe is per flush window. Within a window, repeats of the same
`(message, exposure, webview)` add to one record's `count` (seen: `count: 2`). A repeat in a later window is
sent again with the count since the last flush, as `handoff/exposure-telemetry.md` §1 specifies ("`count`:
occurrences since the previous flush"). So a session with only one distinct result uploaded 1 record per flush,
not 1 per session. This matches the contract and the transport (`src/host/logging/diagnostics.ts`
"a flush sends only the count added since the previous flush"). I do not count it as a defect. If the intent of
5.4's wording is one record per session, the contract and the code would need to change.

### Copy fit (new error-details sentences)

| Surface | EN, font 1.0 | EN, font 2.0 | FR, font 1.0 | FR, font 2.0 |
|---|---|---|---|---|
| First-run sheet ("Error details and app safety checks." / "Des détails d'erreur et des contrôles de sécurité.") | `b03` fits | `b08` fits (scrolls; `b07` after the language switch) | `b04` fits | `b05` top, `b06` sentence; fits |
| Consent screen, Settings → AI features (`consentSentErrors`) | `b09` fits | `b12` fits | `b10` fits | `b11` fits |
| Settings → Advanced hint (`settingsErrorDetailsHint`, EN only by design) | `b14` (also `b02`, before consent) fits | `b13` fits | — (no fr key; Settings is English) | — |

Verdict: **fits everywhere, nothing cut off or overlapping.** At 2.0 the text wraps cleanly inside its card or
column and the sheet and screen scroll. The pinned bottom actions grow and wrap ("Garder les fonctions d'IA /
activées", "J'accepte les / conditions d'utilisation") but stay readable and never cover the sentence, which can
be scrolled clear. Each sentence reads naturally and is as short as the old one. The EN consent line "Error
details and automatic app safety checks. Technical only, never what you typed or saved." and the FR line
"Des détails d'erreur et des contrôles de sécurité automatiques. Uniquement techniques, jamais ce que vous tapez
ou enregistrez." match `handoff/exposure-telemetry.md` §5 word for word, as do both first-run lines and the
Settings hint.

## What couldn't be exercised

- **Forged and unsigned frames in the release build:** bridge-reach and the drop counter exist only on
  DevProbe (debug). In release, "no unsigned message acted on" rests on the absence of any drop, token or
  failure log line and on normal behaviour. No forged frame was injected into the product shell.
- **A real LLM generation:** no model key was used. The storage app came from the stub pipeline's storage
  fixture, which goes through the real install path and capability bridge.
- **A second distinct exposure result on Android:** this device always reports `navigated:android`, so a
  "changed result → new record" was not observed on device. It is covered by `diagnostics.suite.ts`.
- **The per-probe row for "webkit.messageHandlers unreachable"** is not shown on screen. Its pass follows from
  52/52 with `contained=true` (see Part A).
- The upload that happens when DevProbe is remounted in the debug build was lost when I force-stopped the app
  before the 30 s flush. That is expected (flushes are timed) and not a defect.

## Defects

None in this change's scope on Android.

## Side observations (not caused by this change)

1. **Settings → Advanced: the "Send error details" switch is hard to read.** On is a black track with a grey
   thumb; off is a grey track with a black thumb (`b14` vs `b20`). Both look dark, and the on state looks
   almost disabled.
2. Settings → Advanced: the "Server address" label and its helper lines line up with the card's outer edge,
   while every other section label ("This phone", "Server") and hint lines up with the text inside the card,
   further right (`b14`: x ≈ 60 px against ≈ 110 px on the 1344 px screen). The alignment is inconsistent.
3. First-run sheet: "What stays on your phone" uses a telephone-handset (call) icon (`b03`), which reads as
   "calling" rather than "device".
4. Debug only: the home composer's "Logs" chip sits past the right end of the composer pill and is clipped by
   its edge (`a0-launch.png`).
5. Fixture only: the Storage Fixture's long JSON rows overflow the screen to the right (`b17`). It is a test
   fixture, not product UI.
6. The first-run sheet keeps its scroll offset when the language is switched (`b07`). Harmless.
7. As in the first run: in DevProbe, the first tap after the long-press is swallowed (a tap on empty space first
   works around it).

## State left

Font scale restored to 1.0 (`settings get system font_scale` → 1.0). Wi-Fi and mobile data turned back on.
`adb reverse` rules removed. Legal language set back to English. "Send error details" back on. The app (offline
build) stays installed, pointed at `http://localhost:8787`, so it cannot reach production by accident. Metro
(8081), the stub server (8787) and the proxy (8788) are stopped. Emulator `Whim_Verify` stopped (I started it).

## Evidence files

PNGs, `server.log`, `diag-bodies.jsonl` and two logcat captures are in `android-5.4/` next to this file. They
are git-ignored by repo policy (`.gitignore` "Run evidence never enters git"), so only this file is committed.
They need uploading per `docs/EVIDENCE.md`.
