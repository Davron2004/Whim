## 1. Design tokens (HUMAN-BOOTSTRAP: `package.json` script, `build/assemble.mjs`)


> **HOLD (product owner, 2026-10-09):** the "Make a copy starts fresh, no share-or-fresh question" reversal of decision #52 D2 (tasks 15.3, 20.3 and the "copy made · fresh data" copy) is pending the owner's confirmation. Until then, implement "Make a copy" with #52 D2's existing share-or-fresh ask restyled to the new system; do not remove the question or its store path.

- [x] 1.1 Create `src/design/tokens.ts` (pure data, no RN/DOM import): colour roles light/dark, ember and glow stops, status fill/on/text/soft, type scale with tracking, space steps and SDK names, layout constants, radii, shadows, the six springs (response, ζ, derived stiffness/damping) and timings, all values from `docs/design/system.md` §2 and §4.2
- [x] 1.2 Create `src/design/tints.ts`: the ten tints with light/dark values, alias map, djb2 fallback by app id, ΔE2000, `nearestTint(hex)`, `assignTint(ranked, used)` and `farthestTint(original, used)`; unit tests in `src/sdk/test/tints.acceptance.ts` (auto-discovered by `sdk:test`)
- [x] 1.3 Write `scripts/design-tokens.mjs` (write and `--check` modes): regenerate the marked token tables in `docs/design/system.md`, the token block in `docs/design/mockups/index.html`, `docs/design/system-v1/palette.json`, and `src/design/generated/springs.ts` (60 Hz `linear()` strings, settled durations, nearest cubic-bezier); add the `tokens` npm script; make `palette-check.py` read `palette.json` and rerun it
- [x] 1.4 Add `checks/test/repo/design-system.suite.ts`, registered once in `checks/test/acceptance.ts` (later design checks are added inside it, never to `acceptance.ts`), that runs the generator in `--check` mode, enforces the WCAG floors of `system.md` §2 for every specified pair in both schemes, and scans `src/host/**`/`src/sdk/**` for hex literals and spring configs outside the token module (exemptions listed in the suite)
- [x] 1.5 Runtime page in `build/assemble.mjs`: outer page, srcdoc and iframe paint the scheme's `bg` from the delivered theme (default light `bg`), add `color-scheme: light dark`, drop `maximum-scale=1`, and stamp the host `GEN` onto forwarded `paint` frames as nav-depth does; regenerate with `npm run build` and extend the desktop delivery suite for the stamp and the viewport

## 2. Icons

- [x] 2.1 Write `scripts/vendor-icons.mjs` reading `lucide-static@0.460.0` via `npx --ignore-scripts --package=lucide-static@0.460.0`, emitting `src/design/icons/paths.ts` (the 147 glyphs, the chrome set of `system.md` §3.1, `circle`) and `src/design/icons/LICENSE` (ISC notice)
- [x] 2.2 Create `src/design/icons/names.ts`: `GLYPH_NAMES` (147, grouped), `CHROME_NAMES`, the glyph alias map (including `trash`→`trash-2`), the keyword table, `resolveIcon(name, appName?)` returning `{ name, diagnostic? }` (aliases, then keywords on the name's parts, then on the app name, else `circle`) and `resolveGlyph` for tiles (glyph set only)
- [x] 2.3 Add the ember silhouette (48 grid path taken from the mockup) and the squircle path generator (corner 22.5%) to `src/design/icons/`
- [x] 2.4 `src/sdk/test/icons.acceptance.ts` (auto-discovered by `sdk:test`): every name resolves, aliases and keywords are deterministic, unknown names fall back to `circle`, no glyph in the set is missing a path

## 3. SDK theme

- [ ] 3.1 `src/sdk/theme.ts`: `WhimTheme` gains `scheme`, `tint`, `fontScale`, `reduceMotion`, `increaseContrast`, `platform` and the roles `sheet`, `sheet-group`, `thumb`; `DEFAULT_THEME` = light roles + `slate`; `sanitizeTheme` validates and defaults every field (clamp 0.85–2.0) and still drops `chromeInsetBottom`
- [ ] 3.2 `src/sdk/tokens.ts`: resolvers read `src/design/tokens.ts`; `primary`/`on-primary` resolve the tint per scheme; status roles resolve fill vs text form per use; SDK text sizes 13/17/20/28/40 with tracking × `fontScale`; space names on the 4-pt grid; radii 10/14/20; `increaseContrast` maps `text-muted`→`text`
- [ ] 3.3 Keep the shell unchanged for now: pin `src/host/launcher/theme.ts`'s `SHELL_PALETTE` to its current v2 values locally instead of deriving from the new `DEFAULT_THEME`
- [ ] 3.4 SDK runtime basics: `user-select: none` and `-webkit-tap-highlight-color: transparent` on controls only, `overscroll-behavior` on `Screen`/`Modal`, `font-variant-numeric: tabular-nums` helper, `Text color` narrowed with old values mapped
- [ ] 3.5 Rewrite `src/sdk/test/theme.acceptance.ts` and `screen-inset.acceptance.tsx` for the new fields; update `fixtures/style-gallery.app.tsx` so it still shows every component and variant under the new theme (dark and light)

## 4. SDK components: additions

- [ ] 4.1 `Icon` (inline SVG from `src/design/icons`, `name: string` resolved per §3.1, sizes 16/20/24, `color` from the narrowed set, `label` or decorative) and `icon` props on `Button`, `ListItem`, `EmptyState`
- [ ] 4.2 `Screen` `title` and `action`: header row with back control when the nav stack is deeper than one (calls `nav.back()`), trailing icon action, `title1` title; bottom padding keeps `chromeInsetBottom`
- [ ] 4.3 `Stepper`, `DateInput` (epoch ms, `date` stores local midnight, native picker) and `Picker` (native list) per `system.md` §7.2
- [ ] 4.4 `toast(text)` module function (bottom capsule above the orb footprint, 4 s, replaces the previous, ignored during first render, announced politely)
- [ ] 4.5 `defineApp` `tint` (name or up to three) and `icon` types; `tileColor` kept and marked deprecated in the type
- [ ] 4.6 Acceptance tests for each addition; update `fixtures/style-gallery.app.tsx` to show every new component, variant and prop

## 5. SDK components: restyle and keyed lists

- [ ] 5.1 `Button` (capsule 52, `primary` tint fill, `secondary`, `ghost`, `danger` as soft capsule, disabled `fill`/`text-3`, `radius` accepted and ignored), `Text` sizes and narrowed `color`, `Heading` as an alias of `Text size="title"`, `Row` defaults `center`/`start`
- [ ] 5.2 Controls: `TextInput`/`NumberInput` field anatomy, `Switch` (platform shape), `Checkbox`, `Slider`, `SegmentedControl`, each with 44/48 targets from `platform` and stacking from `fontScale` 1.35
- [ ] 5.3 Surfaces: `Card` and `List` without borders (`sheet-group` inside `Modal`, outline with `increaseContrast`), `Badge` tones with status icons and amber `warning`, `ProgressBar` `variant: 'ring'` and `label`, `EmptyState`, `Chart` colours, `Modal` sheet anatomy (grabber, `title2`, close button, scrim, action row padded by `chromeInsetBottom`)
- [ ] 5.4 `List` `items`/`keyBy`/`renderItem` with stable identity; duplicate or index-shaped keys give a dev diagnostic and set a no-motion flag (motion itself lands in 6.x)
- [ ] 5.5 Add a gallery-coverage check to `checks/test/repo/design-system.suite.ts`: every `vc-sdk` component export must appear in the style gallery
- [ ] 5.6 Split `fixtures/style-gallery.app.tsx` into four screens (Text and buttons; Controls; Surfaces; Modal and toast) using `nav` and `Screen title`, tint `purple`, one filled button per screen, `danger` beside `secondary`, `List keyBy` with add/remove; update `list.acceptance.tsx` and component suites

## 6. SDK motion

- [ ] 6.1 Motion helpers in `src/sdk/`: spring easings from `src/design/generated/springs.ts`, one-time `CSS.supports('animation-timing-function', 'linear(0, 1)')` gate with cubic-bezier fallback, WAAPI play helpers, a small rAF spring that keeps velocity on retarget
- [ ] 6.2 Press feedback on every pressable (scale per kind, reduced: opacity 0.7), `Switch`/`SegmentedControl`/`Slider` thumbs on the rAF spring, `Checkbox` stroke, `Stepper` digit roll
- [ ] 6.3 `Screen` push/pop per `platform` (iOS trailing push with −30% and 0.12 dim; Android shared X axis), `Modal` present/dismiss and drag on the rAF spring with projection commit, `toast` rise/sink, `ProgressBar` value motion
- [ ] 6.4 Keyed `List` enter (rise 8 px + fade) and leave (fade, then FLIP gap close); children-style lists and flagged keys stay still
- [ ] 6.5 Reduce Motion pairs: a desktop Chromium suite in `src/sdk/test/` proving each moment runs animations with `reduceMotion: false` and only the reduced form with `true` (via `getAnimations()`); draft the owner-authored invariant for `invariants/` as a proposal file in the change folder, not in `invariants/`
- [ ] 6.6 Update `fixtures/style-gallery.app.tsx` to show every motion preset (keyed add/remove, modal, toast, push)

## 7. Native dependencies (HUMAN-BOOTSTRAP: `package.json`, lockfile, `babel.config.js`, Podfile)

- [ ] 7.1 Add exact pins: `react-native-reanimated@4.6.0`, `react-native-worklets@0.12.2`, `react-native-gesture-handler`, `react-native-svg`, `react-native-screens`, `react-native-keyboard-controller` (versions verified against RN 0.85.3 bridgeless); add the worklets babel plugin; `pod install` and restore any unrelated `Podfile.lock` churn
- [ ] 7.2 Root wiring in `App.tsx`: `GestureHandlerRootView`, `KeyboardProvider`, Reanimated `ReducedMotionConfig` following the OS; `src/host/ui/Icon.tsx` (react-native-svg, from `src/design/icons`) as the first SVG use, so knip sees every new dependency imported
- [ ] 7.3 Build the Android release APK (offline) and the iOS simulator build; run `guard:metro`, knip and the release checks; record versions and any build flags in the chain contract
- [ ] 7.4 Confirm `native-network-deny.suite.ts` and #74's WebView manager replacement still pass with the new autolinked packages

## 8. Haptics (HUMAN-BOOTSTRAP: `package.json` `codegenConfig`)

- [ ] 8.1 `src/native/NativeWhimHaptics.ts` spec (`impact(style)`, `selection()`, `notification(kind)`, `prepare(kind)`, `cue(kind)`); register it in `codegenConfig` beside `WhimTone`
- [ ] 8.2 Android `com.whim.haptics.WhimHapticsModule`/`Package` (`performHapticFeedback` on the root view with API-34 constants and the fallbacks of `system.md` §5; `VibrationEffect.createPredefined` for cue kinds) registered in `MainApplication.kt` without disturbing `WhimTonePackage` or the network-deny manager
- [ ] 8.3 iOS `WhimHapticsModule.mm` (impact, selection and notification generators, prepared on touch-down) in the Xcode project
- [ ] 8.4 `src/host/haptics.ts`: the shell moment map of `system.md` §5 (pure, Node-testable) over the native module, no-op when absent
- [ ] 8.5 `src/host/cue-backend.ts`: `cues.haptic` through `WhimHaptics` with a per-realm token bucket (10/s, burst 3, drop) after the bridge dedupe; remove `Vibration`; update `src/host/bridge/test/acceptance.ts` and the native-host test double; add the rate-cap test

## 9. Platform theming, launch and icon

- [ ] 9.1 Android: remove `MODE_NIGHT_NO` from `MainApplication.kt`, add `values-night` colours, launch/window backgrounds from the tokens' light and dark `bg`, caret and selection colours (`text`/ink), update `checks/test/repo/android-accent.suite.ts`
- [ ] 9.2 Release assets: replace `release/assets/icon-foreground.svg` with the ember on warm dark, add iOS dark and tinted variants and the Android monochrome silhouette, set `brand.json` light and dark launch backgrounds, and make `scripts/release/lib/assets.ts` and `assets.suite.ts` compare both to the tokens; regenerate assets
- [ ] 9.3 iOS launch screen: the ember on a light/dark `bg` colour asset; Android 12+ splash icon; a native `hideLaunchScreen()` that keeps the launch screen up until called (Home calls it on its first frame in 15.2)
- [ ] 9.4 Retire the custom fonts: delete `assets/fonts/` and the Android font assets with their `_bold`/`_italic` copies, point every `TYPE_SCALE` face at the system font (no `fontFamily`) so current screens keep compiling, delete `android-fonts.suite.tsx` and the font references in `scripts/release/lib/assets.ts` (the `FONT_FAMILY` constant and face fields go in 21.4)
- [ ] 9.5 Render the ember grey at 24 pt for the owner's silhouette check and store the PNG in the evidence archive (`Whim-evidence/`), never under `openspec/changes/`; note its path in the chain contract

## 10. Shell primitives: base

- [ ] 10.1 `src/host/ui/tokens.ts`: `useTokens()` (scheme from `useColorScheme`, Increase Contrast, Reduce Motion, `fontScale`) and `makeStyles()` memoised per scheme; pure parts in a non-RN sibling for Node tests
- [ ] 10.2 `Text` primitives on the type scale (tracking per size, tabular figures helper), `Button` (all seven variants, sizes, busy/disabled/focus, press M1 with Reanimated), `IconButton`, back control
- [ ] 10.3 `Chip` (selected `ink` with `check`, "Decide for me" ember variant, suggestion), `Notice`, `Skeleton` (`breathe`, exported geometry)
- [ ] 10.4 `Ember` (sizes, working/stuck/out, `activity` prop, spark trigger, reduced form) and `AmbientLight`, hidden from screen readers
- [ ] 10.5 Switch `src/host/launcher/theme.ts` consumers to `useTokens()` screen by screen only where a primitive replaces them; keep `SHELL_PALETTE` for untouched screens until chain 21; Node/UI suites for each primitive

## 11. Shell primitives: surfaces and keyboard

- [ ] 11.1 `Sheet` on Gesture Handler + Reanimated: `fit`/`large` detents, grabber, header with close, scrim following position, projection commit with `fling`, rubber-band, Android back, Escape, modal accessibility, commit-point haptic
- [ ] 11.2 `ConfirmSheet` (safe `ink` above `danger`), `ContextMenu` (anchored card, rows as separate accessibility elements, second step) (#135), `Toast` host with queue-of-one, pause under screen reader and on touch, swipe dismiss
- [ ] 11.3 `TextField`/`TextArea` and keyboard handling on `react-native-keyboard-controller`: focused field 16 pt above the keyboard in screens and sheets, sheets lift on the keyboard curve, IME height changes tracked (#50, #128); retire `KeyboardShell`'s `LayoutAnimation`
- [ ] 11.4 `GroupedList` (sections, rows, trailing kinds, destructive row) and `AppTile` geometry constants (no states yet)
- [ ] 11.5 UI suites for each surface, including back closing a sheet and every menu row being reachable by accessibility

## 12. Tile identity (host logic)

- [ ] 12.1 Host record fields: `tint`, `icon` (resolved), `tileOverride?`; `mapWireRecord` reads `manifest.tint`/`manifest.icon`, assigns with `assignTint` over installed apps, and `StoreAccess.update` carries the host fields forward on rebuild
- [ ] 12.2 Copies take `farthestTint`; hex `tileColor` records resolve with `nearestTint` on read; seeded examples get fixed distinct tints and glyphs; no generated app can claim an example's tile by declaration (#127)
- [ ] 12.3 Reimplement `tileColor()` over the tints, keeping its signature for `checks/test/acceptance.ts:51` and the current screens; drop `RESERVED_TILE_HUES` (no tint can be a reserved hue); leave `ghostTileColorFor`, `monogram` and `manifest-tile-color.ts` in place for chain 21 to delete once Home no longer calls them
- [ ] 12.4 Customize-tile override storage API (set/clear, survives changes) and the pending-purge marker for soft delete and discard (D16)
- [ ] 12.5 Rewrite `tile-colour.suite.ts`, `build-lifecycle.suite.ts` and `store-access.suite.ts` cases: install-then-rebuild keeps tint and glyph, copy takes the farthest tint, interrupted purge completes at launch

## 13. Generator: server

- [ ] 13.1 `checks/passes/manifest-extraction.ts` and the server check stage extract `tint`/`icon`, resolve them through `src/design/tints.ts` and `src/design/icons/names.ts` with warning diagnostics; delete `validTileColor` and the server `RESERVED_HUES`; confirm the server bundle reaches `src/design/` (else re-export through `checks/`)
- [ ] 13.2 Prompts: replace `PLAN_ROW_LABELS` with the plan-row rules (labels for the app, ≤ 3 words, ≤ 2 sentences, never restate a question on the page); rewrite treats delegated questions as open; generation decides delegated questions
- [ ] 13.3 Prompts: clarify options ≤ 40 characters; limit reasons use the glossary; remove the layout-dictating sentence and point at SDK defaults; add the tint/icon section (lists come from the shared modules, four rules)
- [ ] 13.4 Contract docs: `contract/src/index.ts` comment for `manifest.tint`/`icon`; update `server/test/{prompts,machine,contract,wire-v2,flowbench}.suite.ts`
- [ ] 13.5 Eval: corpus cases for option length, tint/icon present and valid, tint/icon stable across a change, and an invalid-icon rate metric

## 14. Shell navigation and settings

- [ ] 14.1 Native stack with `react-native-screens` primitives driven by `LauncherRoot`'s machine: Home root; Settings, Advanced, AI features, History, Report pushed; gesture pops write back to the machine; status and navigation bar content per scheme
- [ ] 14.2 `android:enableOnBackInvokedCallback="true"`; keep the running app's `BackHandler` path; extend the exit table and its scanner for the new screens (#67)
- [ ] 14.3 Settings and Advanced per `system.md` §9 (AI features with "Review what's sent", Language, About, Advanced; Send error details, Phone ID truncated with copy, Make a new ID confirm sheet, Whim's server / Your own server rows keeping the address); one health probe per typing pause (#130); remove the Highlighting section
- [ ] 14.4 AI features review screen on the stack shows consent once (#104)
- [ ] 14.5 Report as a pushed screen (chips, note, include switch, collapsed preview, ID footer, `Sending…`, neutral thank-you on your own server (#153), failure notice above the buttons)
- [ ] 14.6 Update `settings-screen`, `privacy-settings-ui`, `request-envelope-ui` and launcher-interaction suites

## 15. Home and tiles

- [ ] 15.1 `AppTile` states of `system.md` §3.2 (being made, queued, failed, stopped, collapsed old attempts, needs update, changing ring, change failed, copy, example) with accessibility labels and hints (#48, #133)
- [ ] 15.2 Home layout (calls `hideLaunchScreen()` on its first frame): "Your apps", settings button, 4/3-column grid and the 200% list, order rule (being made, recent attempts, apps, newest first) (#132), search from 13 apps, skeleton with exact cells, empty state with idea chips, live offline notice, composer bar with draft state
- [ ] 15.3 Tile context menus per state (Open, Change it, History, Make a copy, Customize tile, Share link, Delete; Details/Stop; What happened/Try again/Discard) on `ContextMenu` (#135); Share link via the platform share sheet; remove the share-or-fresh fork sheet and its copy keys
- [ ] 15.4 Soft delete with the 10 s Undo toast and Discard with 6 s, on the pending-purge marker; no native `Alert`
- [ ] 15.5 Customize tile sheet (ten tints, searchable glyph grid) writing the override
- [ ] 15.6 Update `home-grid-ui`, `launcher-interactions` and product-verbs suites

## 16. Making flow: sheet, first run, describe, plan

- [ ] 16.1 The making sheet with pages `describe | plan | making | ready | failure` keyed by the run journal id; composer opens Describe; closing keeps the draft (text, answers, plan edits) and aborts in-flight clarify/rewrite
- [ ] 16.2 First-run sheet: summary rows, Privacy policy, Full details (expands in place), Language, unticked terms checkbox row with the Terms link outside its hit area, "Agree to send descriptions" (`ink`) and "Not now"; both acts recorded as today; age stays silent unless blocked
- [ ] 16.3 Describe page: `title1`, 17 pt area focused, helper line, Continue (`ember`) riding the keyboard (#49), idea chips when empty, change mode header
- [ ] 16.4 Plan page: quoted words, "A few choices" (question rows with chips ≤ 20 characters or radio/checkbox rows, "Decide for me" default and exclusive, collapse when scrolled past), "What I'll make" (plan rows, skeletons, in-place edit, "Edited"), notice above Make it; rewrite sent at once with every question delegated; answers to generate as `clarifications`
- [ ] 16.5 Can't-make-as-asked state ("I can't make this as asked", alternative card, Make that instead, Change my idea)
- [ ] 16.6 Update `prompt-flow-ui`, `prompt-flow-screens`, `flow-screens-ui` and consent suites

## 17. Making flow: making, ready, failure

- [ ] 17.1 Making page: 128 ember with ambient light, title, quoted words, step list with elapsed time on the current step and the repair row, time lines from one measured constant (flowbench 53/144/225 s), stall and queue lines, Stop; no transport wording or output counter; never shows another run's progress (#131)
- [ ] 17.2 Ready page (96 tile, name, words, "It's on your home screen.", Open it in the tint, Done) and the closed-sheet toast "… is ready · Open"
- [ ] 17.3 Failure page by kind (`system.md` §8 table) including "I lost the connection to the server partway through." with Try again on reconnect (#151, copy half), untouched/current-version line, collapsed "What happened" with rows as separate accessibility elements (#136), Discard in the body
- [ ] 17.4 Pre-run connection problems stay on the page as a notice with Try again
- [ ] 17.5 Update build-screen, failure and pending-build suites

## 18. Opening and the app container

- [ ] 18.1 Host theme frame: build it from `useTokens()` state and the app's tint (`scheme`, `tint`, `fontScale`, `reduceMotion`, `increaseContrast`, `platform`, all roles) in `MiniAppView`; update `mini-app-host-ui` and the desktop delivery suite
- [ ] 18.2 Opening signal: accept a GEN-stamped `paint` only for the current bind; keep the boot watchdog; test that a stale paint does not release the opening
- [ ] 18.3 Opening state: WebView hidden until the signal or 600 ms, then a 160 ms fade; tile-sized tint plate with glyph on `bg`; "Opening…" after 1.5 s; launch failure replaces it; closing returns to Home (container motion lands in chain 22)
- [ ] 18.4 One warm WebView in a pool; measure tap-to-first-paint before and after and record it in the chain contract

## 19. Running app: orb, Whim sheet, changes, crashes

- [ ] 19.1 Orb: 44 pt opaque disc, 52 pt target, two corners inside `chromeInsetBottom` with projection snap and per-app memory, hide on the host keyboard signal, dots, accessibility label and action; no dim layer or stray shape (#82, #105)
- [ ] 19.2 Whim sheet: tile, name, version line, "New version ready · Reload" row, send field, History, Report a problem (pushed inside the sheet), Back to your apps; each row its own accessibility element (#103); sending grows into the change's plan page
- [ ] 19.3 Changing while in use: the app keeps running, the orb glows, toast with Reload, dot and row until reloaded, failed-change dot and toast with See why
- [ ] 19.4 Crash screen: message, Reload, "Ask Whim to fix it" (prefilled request with the error attached), Back to your apps; the orb stays
- [ ] 19.5 Retire `Orb.tsx`'s `Animated` menu and `orb-actions` tap counters (delete the stored counters); update `orb-menu`, `mini-app-host-ui` suites

## 20. History

- [ ] 20.1 History on the native stack: header back and `Report`, title, 40 tile, name in tint, version count; timeline rows (quoted words, summary, tabular meta, neutral kind chips with icons, `Current`), rail stopping at v1; no filters
- [ ] 20.2 Order by the version chain, not commit time; "Start" on the true first version (#126)
- [ ] 20.3 Expanded rows: Use this version (immediate, "Back on version N · Undo", Undo reachable after the toast), Make a copy from here (immediate, fresh data, "Copy made · Open"), Change it on the current version, the hidden-data line; remove the confirm sheets
- [ ] 20.4 Update `history-ui`, history-logic and version-history suites (including two versions in one second)

## 21. Copy, Whim Syntax and cleanup

- [ ] 21.1 `copy.ts` glossary sweep (app, make, change, History, version, Use this version, Stop, Decide for me, Make a copy, Your apps, Discard, Delete; the before/after table of `system.md` §8); tag keys as control or prose
- [ ] 21.2 Copy lint in `checks/test/repo/design-system.suite.ts`: retired words and Whim first person on control keys fail; extend `product-verbs.suite.ts`; numbers formatted with the copy table's language (#89)
- [ ] 21.3 Whim Syntax renderer: simplified channels, `state` = ready/failed only, cap and flat-render rules kept; delete `highlighting.ts` and the stored preference
- [ ] 21.4 Delete the retired components and constants (`SheetModal`, `ActionSheet`, `RunDetailsSheet`, `ServiceNotice`, `PrimaryAction`, `SHELL_PALETTE`, `src/sdk/design-tokens.ts` shell exports no longer read, `KIND_BADGE_COLORS`, `FONT_FAMILY` and the `TYPE_SCALE` face fields, `ghostTileColorFor`, `monogram`, `manifest-tile-color.ts`, `appColor`); point every remaining consumer at `useTokens()` and the tints
- [ ] 21.5 Update `whim-prose`, `consent-coverage` and copy-asserting suites

## 22. Shell motion

- [ ] 22.1 Container transforms on Reanimated: M2 open (bg container width/height/radius on the UI thread, tint plate, fade on the opening signal) and M3 close, M6 composer to Describe, M5 making sheet into its tile, M9 Make it ember travel, M10 Ready flare, M4 ghost to tile
- [ ] 22.2 Honest light (M20): activity from the stream (tokens/s ÷ 40), 0.6 s smoothing spring, flicker from token arrivals only, stuck easing, out fade; shared by the making ember, ambient lights, tiles, changing ring and orb
- [ ] 22.3 Grid and list motion: M17 first-launch stagger, M18 delete reflow with Undo reversal, M26 History row expand, M8 plan arrival, M25 row edit, M12 menu lift, M14 toast, M16 orb, M23 keyboard
- [ ] 22.4 Static check in `checks/test/repo/design-system.suite.ts`: no `Animated`, `LayoutAnimation`, `useNativeDriver` or literal spring configs in `src/host/`; Reduce Motion pair tests for each moment
- [ ] 22.5 Slow-motion (0.25×) recordings of every moment on an Android emulator and the iOS simulator, compared with the mockup motion lab, saved to the evidence archive and linked from the change

## 23. Generator: reference and few-shot

- [ ] 23.1 Rewrite `docs/sdk-reference.md` to match the SDK exactly: tokens, every component and prop, `tint`/`icon` with the ten tints, the glyph groups and four rules, `List keyBy`, `toast`, `Screen title`, no presets, shapes, `Heading` or `tileColor`
- [ ] 23.2 Update `fixtures/tip-splitter.app.tsx` and `fixtures/water-counter.app.tsx` to `tint`/`icon` and idiomatic layouts; add two curated exemplar apps to the few-shot set; rewrite the navigation example around `Screen title`
- [ ] 23.3 In `server/test/prompts.suite.ts`: `docs/sdk-reference.md` documents every `vc-sdk` export and no deprecated one; update `prod-build.suite.ts`
- [ ] 23.4 Update `docs/capabilities.md`'s `app-launcher` line (glyph tiles in a named tint, light and dark) and any other line this change made stale

## 24. Verification on device (attended)

- [ ] 24.1 Android at API 29, 34 and 37 (emulator or device, headless ports other than 5554) and the iOS simulator (newest and oldest available runtimes): light and dark on every screen and the style gallery's four screens, contrast spot checks against the token floors
- [ ] 24.2 Text at 100%, 135% and 200% (Home columns and list, stacked buttons, ember 64, ring labels, SDK rows), Reduce Motion, Increase Contrast (iOS) and high-contrast text (Android)
- [ ] 24.3 Keyboard flows: Describe, plan row edit, Whim sheet send, Advanced address, Report note, in-app inputs, Android IME height change (#50, #128, #129)
- [ ] 24.4 Every screen exit by tap and by system back on both platforms (#149); predictive back on API 34/37 and `BackHandler` over a running app (D7, fallback recorded if needed)
- [ ] 24.5 `paint` ordering versus the first visible frame on both platforms (D4); tap-to-first-paint with and without the warm WebView
- [ ] 24.6 Haptics: every shell moment and cue kinds on an iPhone (if available) and Android; cue latency measured and recorded; rate cap observed
- [ ] 24.7 Owner checks: ember silhouette at 24 pt, iOS title tracking, motion recordings; record results and any token adjustments in decision #75's status tag
