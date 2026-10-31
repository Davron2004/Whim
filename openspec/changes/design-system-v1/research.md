# Research digest: what does implementing `docs/design/system.md` touch, and what must not break?

Condensed from a sonnet `researcher` pass over the worktree at `6ae893b5` (its full digest ran ~400 lines;
this keeps the terrain facts the chains need) plus the design record now folded into `docs/design/system.md`.

## Relevant files
- `src/sdk/design-tokens.ts` — shell tokens v2 (`SHELL_COLORS`, `STATUS_COLORS`, `KIND_BADGE_COLORS`, `RADIUS`, `SPACING`, `MOTION`, `FONT_FAMILY`, `TYPE_SCALE` 14 roles, `RADIUS_SCALE`, `appColor` djb2 over 10 hues); pure data, imported by shell and SDK.
- `src/sdk/theme.ts` — `WhimTheme` (colors only), `DEFAULT_THEME`, `sanitizeTheme` (:99-112, hex check per colour, drops unknown keys).
- `src/sdk/tokens.ts` — SDK resolvers (`activeTheme`, `color`, `space`, `radius`, `textSize`), `FONT` already `system-ui`, `SPACE` 4/8/12/20/32, `TEXT_SIZE` body 16.
- `src/host/launcher/theme.ts` — `SHELL_PALETTE` frozen constant; 33 files / 108 uses; 38 files bake styles at module load.
- `src/host/launcher/tiles.ts` — `tileColor()` with `RESERVED_TILE_HUES` exact-string match (:19-47); `monogram`.
- `src/host/launcher/{build-lifecycle,manifest-tile-color,prompt-flow,store-access,app-index}.ts` — tile colour lift, ghost colour (`ghostTileColorFor`), fork carry-forward, `fork(…, {shareData})`.
- `src/host/launcher/LauncherRoot.tsx` — the whole shell state machine (`useState<Screen>` :588, kinds :152-220, render chain :2526-2746, `statusBarStyle='dark-content'` :2514).
- `src/host/launcher/{screen-exits,use-system-back*,system-back,back-policy}.ts` — #67 exit table and back seam.
- `src/host/launcher/{MiniAppView,useMiniAppHost,boot-state,deliver,orb-geometry,Orb,orb-actions}.ts(x)` — WebView host, theme delivery, paint acceptance, chrome inset, orb.
- `src/runtime/web/loader.js` — `handleHostInit`/`installTheme` (:219-252), mount + `paint` post (:170-204), `post()` nonce (:82-89).
- `build/assemble.mjs` — outer page (`maximum-scale=1` :204, `#0b1020` :201), srcdoc `#fff` (:82, :131), init frame + `pendingTheme` (:114-161), paint forwarding (:144-152), nav-depth GEN stamp (:140).
- `src/host/cue-backend.ts` — the only `Vibration` use (:12, :20-24, :38); `WhimTone?.play` for sounds.
- `src/native/NativeWhimTone.ts`, `android/.../tone/WhimTone{Module,Package}.kt`, `ios/Whim/WhimToneModule.mm` — the TurboModule pattern; `package.json` `codegenConfig` (:85-97).
- `src/sdk/{index,controls,surfaces,charts,navigation}.tsx` — SDK components; no `Icon`, no keyed `List`.
- `fixtures/style-gallery.app.tsx` — one screen of nested Cards, `tileColor '#a21caf'`; fixtures double as few-shot (`server/src/generation/prompts/inputs.ts:38,81`).
- `docs/sdk-reference.md` — system-prompt SDK reference; stale presets/shapes (:161, :315-323); no `tileColor`.
- `server/src/generation/prompts/index.ts` — `PLAN_ROW_LABELS` fixed four (:210-215), `CLARIFY_SYSTEM` (:288-314), layout-dictating lines (:436-438), `DELEGATED_ANSWER` (:155).
- `server/src/generation/stages/check.ts` — `validTileColor` + its own `RESERVED_HUES` (:30-64); `checks/passes/manifest-extraction.ts:134-174` extracts `tileColor`.
- `contract/src/index.ts` — `WireAppRecord.manifest` untyped (:142), `Clarification.decide` (:163), `ClarifyQuestion` (:180), `PlanRow` (:284).
- `android/app/src/main/java/com/whim/MainApplication.kt:46` — `MODE_NIGHT_NO`; `styles.xml` DayNight parent; manifest `configChanges` has `uiMode`; no `enableOnBackInvokedCallback`.

## Current behavior
- Shell is light-only; no `useColorScheme`/`Appearance` anywhere. iOS has no `UIUserInterfaceStyle` override.
- Shell fonts: 7 TTFs in `assets/fonts/` hand-synced to `android/app/src/main/assets/fonts/` (plus `_bold`/`_italic` byte copies); iOS bundles none (no `UIAppFonts`, no pbxproj entries), so iOS already renders SF.
- Navigation is one `useState<Screen>` machine with hard cuts; no navigation library; Advanced is a collapsible section in Settings; Report is a sheet.
- Dependencies absent: reanimated, worklets, gesture-handler, svg, screens, keyboard-controller, any icon set.
- Theme frame: host forwards `{...theme, chromeInsetBottom}` opaquely; the loader strips `chromeInsetBottom` into its closure and freezes the rest as `__WHIM_THEME__`; `sanitizeTheme` keeps only colours.
- `paint` is posted by the trusted loader after a double rAF following `root.render()` (no `flushSync`), nonce-authenticated by the outer page, forwarded with `trusted: true`, not GEN-stamped. Host acceptance (`boot-state.ts:77-83`) is deliberately not generation-fenced: a reset recreates the iframe, and `payload.generation` is iframe-local. nav-depth, by contrast, is restamped with the host `GEN` and fenced by `BackPolicy`.
- Haptics: `Vibration.vibrate(18 | [0,22,90,22] | [0,70,50,120])`; at-most-once per request id; no rate cap.
- "Decide for me" already exists per question on the wire (`Clarification.decide`, stands alone) and in `ClarifyStep.tsx:203`.
- Fork: Home asks "Use the same saved data / Start fresh" (#52 D2); History forks without opts (fresh); rewind continuation forks with `shareData: true` silently (`build-lifecycle.ts:260`).
- No toast component; delete uses a native `Alert`.

## Constraints and invariants
- Containment legs unchanged: no CSP widening (fonts stay `font-src 'none'`), inline SVG is DOM; `invariants/` is owner-authored.
- #45 theme stays inert data on the init frame; no new message kind; `chromeInsetBottom` stays out of the bundle-visible theme.
- #41 registry append-only: no syscall added or changed. #43 cues stay manifest-gated, fire-and-forget, at-most-once.
- #43b/#52: a copy gets its own storage-engine `appId` unless created as a rewind continuation.
- `StoreAccess.update` is wholesale: host-injected record fields (assigned tint, glyph, overrides) must be passed back on rebuild.
- Node suites can't import RN components; pure logic lives in non-RN siblings (the `design-tokens.ts` model).
- Device imports `@whim/contract` type-only (zod must not enter Metro; `guard:metro`).
- Editing `package.json`, the lockfile, `babel.config.js`, `metro.config.js`, `knip.json`, `tsconfig*`, `build/*` or `invariants/` trips the gate's `CONFIG_SET` tripwire: commit first, then gate.
- `checks/test/release/native-network-deny.suite.ts` requires `WhimTonePackage()` and one WebView package replacement in `MainApplication.kt`; #74's network-deny WebView manager must survive.
- `scripts/release/lib/assets.ts:414` and `assets.suite.ts:202-210` tie `brand.launchBackground` to `SHELL_COLORS.paper`; `android-accent.suite.ts` ties `colors.xml`/`styles.xml` to the accent.

## Integration points
- Tokens: a new pure module consumed by `src/host/**`, `src/sdk/**` (bundled into the runtime) and `build/assemble.mjs`.
- Theme frame: host builds it in `MiniAppView.tsx:108`; SDK sanitizes in `theme.ts`; loader installs in `loader.js:219-230`.
- Tiles: manifest extraction (`checks/passes/manifest-extraction.ts`), server check stage, `build-lifecycle.ts mapWireRecord`, `tiles.ts`.
- Native stack: `LauncherRoot` render chain and the exit table; running-app back stays on `useMiniAppHost.ts:379` `BackHandler`.
- Haptics: `cue-backend.ts` (injected by `useMiniAppHost.ts`), `rows.ts:197` `cues.haptic` row, `contract.ts:229` `HAPTIC_KINDS`.
- Generator: `PLAN_ROW_LABELS`, `CLARIFY_SYSTEM`, `GENERATE_INSTRUCTIONS`, the rewrite turn's `clarificationsSection`.

## Tests that will need rewriting
`src/sdk/test/theme.acceptance.ts`, `screen-inset.acceptance.tsx`, `list.acceptance.tsx`; `src/host/launcher/test/{tile-colour,build-lifecycle,home-grid-ui,android-fonts,whim-prose,flow-screens-ui,keyboard-shell-ui,settings-screen,history-ui,orb-menu,mini-app-host-ui,product-verbs}.suite*`; `checks/test/repo/{android-accent,consent-coverage}.suite.ts`; `checks/test/release/assets.suite.ts`; `src/host/bridge/test/acceptance.ts:318-378`; `server/test/{prompts,machine,contract,wire-v2,flowbench,prod-build}.suite.ts`; desktop `deliver-by-source.desktop.mjs` (theme keys :253).

## Risks and unknowns
- Not verified: that React 19's concurrent commit always precedes the second rAF before `paint` (the boot watchdog already relies on it).
- Not verified: `react-native-screens` predictive back with RN 0.85.3 bridgeless and its coexistence with the running app's `BackHandler`.
- Not located: the #67 source scanner proving each screen uses the exit seam; the app-launcher :236 "no ShellPalette outside theme.ts" scan.
- Not inspected: how iOS registers the in-app `.mm` modules in the pbxproj; how the server bundle reaches `checks/` modules.
- `deploy/site/*.html` and store graphics also use the retired fonts (outside the app).
