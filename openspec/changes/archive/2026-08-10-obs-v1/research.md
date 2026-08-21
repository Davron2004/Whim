# Research digest: obs-v1

Terrain only — what exists and what must not break. Not strategy.

## 1. The two root causes (verified)

- **No React error boundary exists anywhere in `src/`.** Zero matches repo-wide for
  `componentDidCatch` / `getDerivedStateFromError` / any boundary component. A render throw in
  any launcher screen unmounts the whole tree with no log and no UI.
- **No logger abstraction exists.** Every device-side log is a raw `console.*`. The server's
  `server/src/dev-log.ts` is exactly two functions (`logRequest`, `logRun`) that prefix
  `[whim-server]` to a `console.log` line. Device `console` output reaches **logcat only**
  (`ReactNativeJS`), which truncates at ~4 KB — CLAUDE.md, "Android build & run".

## 2. Verified swallow sites

| Site | What it does today |
|---|---|
| `src/host/launcher/LauncherRoot.tsx:244–273` | `onOpen` / `onFork` / `onDelete` each `catch (e)` → `Alert.alert(...)` and log **nothing** |
| `src/host/launcher/useMiniAppHost.ts:115` | `try { …engine?.close() } catch { /* best effort */ }` |
| `src/host/launcher/useMiniAppHost.ts:167` | `try { m = JSON.parse(data) } catch { return; }` — untrusted-frame parse, silent |
| `src/host/launcher/teardown.ts:40` | `try { …engine?.close() } catch { /* best effort */ }` |
| `src/host/bridge/device-acceptance.ts:180` | `} catch { /* ignore */ }` |
| `synthrun/test/acceptance.ts:202,665` | `} catch (e) { /* one-way, best-effort */ }` |
| `src/host/launcher/test/deliver-by-source.desktop.mjs:70,83` | `} catch {}` |
| `server/src/routes/generate.ts:97–101` | `reconcileAbortedUsage(...).catch(() => {})` — documented intentional fire-and-forget |

`useMiniAppHost.ts:105` (`injectJavaScript(\`try{${js}}catch(e){};true;\`)`) is a **string
literal**, not an AST `CatchClause` — no lint rule sees it.

## 3. Existing prefixes that become channels

- `[whim:gen]` — `LauncherRoot.tsx:142–149` (`logGenError`: ctor / kind / status / hint / message /
  stack; never prompt text or generated source) and `transport-shared.ts:117–132`
  (`logMappedError`: path, host:port, kind, status, readyState, detail).
- `[whim]` — `MiniAppView.tsx:85` (`onError` → `console.log('[whim] webview error', …)`).
- `[whim:page]` — `useMiniAppHost.ts:167` region (`m.__whimHostLog === true` relay from the
  sandbox page).
- `[whim-server]` — `server/src/dev-log.ts`, both functions.

Both device breadcrumb functions carry a written **privacy floor** in their doc comments: never
prompt text, generated source, the `x-whim-device` value, or the API key. It is convention only —
nothing enforces it.

## 4. Lint terrain

- `.eslintrc.js` is **legacy config**, eslint `8.57.1` (`^8.19.0`), `root: true`, extends
  `@react-native` + `plugin:sonarjs/recommended-legacy`.
- It already carries one `no-restricted-syntax` entry — the `.sort()`-without-comparator ban —
  using a bare esquery selector and a `message`. Exact precedent for an AST tripwire with no new
  plugin and no new dependency.
- `.eslintignore` mirrors `tsconfig.json`'s excludes **plus** `src/runtime/web/`,
  `fixtures/adversarial/`, `invariants/`, `build/generated/`, `src/runtime/generated/`,
  `src/host/{version-store,storage-engine,bridge}/test/`, `docs/design/reference/`,
  `whim-design-handoff/`. The 13 silent catches under `src/runtime/web/` are therefore **out of
  lint scope**; the 8 sites in §2 are **in scope**.

## 5. FailureScreen vs design `3b`

- `src/host/launcher/FailureScreen.tsx` (81 lines) imports `COPY`, `shellPalette`, `useTheme` —
  **no design tokens at all**. Its own `StyleSheet` hardcodes `fontSize: 18/14/11/16/15`,
  `borderRadius: 12`, `borderWidth: 1`. Diagnostics render as a `FlatList` of `'• ' + hint`.
- Props today: `{ reason, diagnostics: readonly {hint: string}[], onRephrase, onDismiss }`.
  Hint-only by construction — `kind` / `symbol` / `message` never reach it.
- Design `3b` (`whim-design-handoff/reference/Whim Mobile.dc.html:306–333`): 26px/1.15
  `screenTitle` with `letter-spacing:-.025em` and a **dynamic colour**; a 13.5px sub-line;
  `rpShowAttempts`/`rpAttempts` (lines 309–316) = three 5px/radius-3 segments + a 10.5px mono
  uppercase label (`Try N of 3` / `Tried 3 times`); a `flex:1`, radius-20, 1px-bordered, 18px-padded
  panel (lines 318–324) whose rows each carry an 18×18 radius-9 ring/mark icon and 13px text.
- Row/mark vocabulary (html:943, 998): `done` → teal ring+fill, mark `✓`; `bad` → red ring+fill,
  mark `!`; `run` → accent ring, transparent fill, no mark; `wait` → `#c9c3b8` ring, transparent
  fill, no mark and muted text. Panel variants (html:995–997): `bad` → `#fef2f2`/`#fecaca`,
  `good` → `#f0fdf9`/`#99f6e4`, neutral → `#f1efea`/`#e0dcd4`.
- Terminal-failure state (html:940, `RP[5]`) is the one obs-v1 renders: a `done` row (the last
  working version is untouched), a `bad` row (what failed), a `wait` row (what usually gets past
  it), `rpShowAttempts` true, label `Tried 3 times`.
- `MiniAppView.tsx:92–99` — the `styles` block: `fontSize: 20/15`, `borderRadius: 8`,
  `paddingVertical: 12`, `paddingHorizontal: 24/32`, `marginBottom: 12/24`, all literals.

## 6. Library evidence

- `react-error-boundary` **6.1.2** — pure JS, zero runtime deps, peer `react ^18 || ^19`,
  renderer-agnostic (no `react-dom` import), so bridgeless-safe.
- `react-native-logs` **5.6.0** — pure JS, zero deps, actively maintained. Chosen over
  hand-rolling and over `loglevel` (no release since 2024-09).
- `pino` **10.3.1** + `pino-pretty` **13.1.3** — **server only**. `pino/browser` rejected for
  device use: it is a thin `console` mapper that loses redact-at-serialize, and its `console.error`
  path triggers RN's redbox.
- **Reactotron: rejected.** It monkey-patches RN's internal `XHRInterceptor`, relocated in RN 0.80
  and slated for removal at 0.82; this repo is on RN **0.85.3**. Upstream issue
  `infinitered/reactotron#1591` has been open since 2025-10-22, unfixed. It is also `__DEV__`-gated.
- **Rozenite: rejected** — needs a live Metro/CDP connection, which a release-only build has not got.

## 7. Transport terrain for a device→host sink

- `adb reverse tcp:<port> tcp:<port>` **works from a release APK**. Precedent:
  `openspec/changes/archive/2026-08-01-fix-generate-stream-transport/progress.md:128` — chain-7
  on-device verification, `emulator-5554`, release APK from `./gradlew assembleRelease`, real
  generation over `adb reverse tcp:8787`, `POST /v1/generate 200 155815ms`.
- The "emulator NAT route to Metro is dead" note (`docs/decisions.md:441`, CLAUDE.md "Android
  build & run") is about **Metro's own dev-server protocol**, not TCP port forwarding. The same
  decision line already says "also retry `adb reverse` for plain HTTP — the Metro failure may have
  been dev-server-specific"; §7's precedent is that retry, and it passed.
- The device already persists a server address through `SettingsScreen`, and already reaches
  `http://localhost:8787` over `adb reverse` for `/v1/generate`.

## 8. Constraints that must not break

- **`zod` must never enter the Metro graph.** Every device-side `@whim/contract` import is
  `import type` and carries an explicit `TYPE-ONLY import` comment. `generation-contract`'s
  "Shared wire-contract package" requirement says schemas SHALL be zod values with `z.infer`
  types — a plain-interface module is a departure that has to be spelled out.
- **`npm run guard:metro`** bundles `index.js` in release mode and asserts exit 0 plus an output
  size floor; it must be re-run after any device-side dependency is added.
- **Protected files.** `.claude/hooks/protect-harness.sh:109–112` — `package.json`,
  `package-lock.json`, `.eslintrc*`, `knip.json` are **Class 1** (grantable in a worktree, blocked
  for a subagent without a grant, `ask` for the main thread). `*/package.json` also matches
  `server/package.json` and `contract/package.json`. None of obs-v1's edits touch Class 2.
- **`__DEV__` is false in this project's builds.** The emulator NAT is dead for Metro, so the
  working recipe is `npm run android:release` (debug-signed, offline). Anything gated on `__DEV__`
  alone is invisible on the device this project actually runs on. The existing on-device probes
  use build-time boolean flags instead (`RUN_VSTORE_PROBE`, `RUN_STORAGE_PROBE`,
  `RUN_BRIDGE_PROBE`, default `false`) — CLAUDE.md, decisions #40/#41.
- **No new npm script may be added by an agent**; suites join an existing runner. The launcher
  registry is `src/host/launcher/test/acceptance.ts` (`npm run launcher:test`); the server entry is
  `server/test/run.mjs` (`npm run server:test`).
