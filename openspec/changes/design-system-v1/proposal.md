## Why

Whim has three token systems, two typographic worlds, no dark mode, no real motion or haptics, typed
characters for icons, a violet accent that means nothing, and generated apps that all look alike in that
violet. The owner-ruled design record (decision #75, `docs/design/system.md`) replaces it with one design
system for the shell and every app. This change builds it, before testers arrive, while breaking the look is
free.

## What Changes

- **One token module** (`src/design/tokens.ts`) for colour roles in light and dark, the ember, three status
  hues, ten named app tints, type scale, spacing, radii, shadows, springs and timings. The shell, the SDK
  theme and the runtime page read it; `system.md`'s tables, the mockup token block and the palette proof's
  input are generated from it and checked for drift.
- **Shell dark mode, system fonts, new components.** The shell follows the phone's appearance through one
  scheme hook; Instrument Sans, IBM Plex Mono and Newsreader and their bundled files go; one set of
  primitives (button, icon button, chip, field, grouped list, sheet, confirm sheet, context menu, toast,
  notice, skeleton, ember) replaces the per-screen treatments.
- **Icons and tiles.** A vendored Lucide subset (147 glyphs plus chrome icons) drawn as SVG; tiles become a
  tinted squircle with one glyph, named by the app (`defineApp` `tint`, `icon`) and assigned by the host, with
  aliases, deterministic fallbacks and "Customize tile". **BREAKING (wire):** `tileColor` is deprecated in
  favour of `tint`/`icon` in the manifest; installed hex colours map to the nearest tint.
- **Navigation.** Settings, Advanced, AI features, History and Report move to `react-native-screens`' native
  stack with the OS back gestures (edge, content-area, Android predictive back). No edge swipe over a running
  app (#67 kept).
- **Flows.** One making sheet with Describe, Plan (clarify merged in, "Decide for me" selected by default,
  long answers as rows), Making (ember, measured time lines, Stop, repair row), Ready and Failure (by kind);
  closing keeps the draft. Changing an app starts inside it and ends with Reload. Soft delete with Undo;
  immediate "Use this version" and "Make a copy" with Undo; Settings reorganised with the phone ID under
  Advanced.
- **Motion.** Reanimated 4.6, Gesture Handler and keyboard tracking in the shell; six named springs; container
  transforms for opening apps and making; honest light; Reduce Motion everywhere.
- **Haptics.** A `WhimHaptics` TurboModule replaces RN `Vibration`; the shell gets a fixed haptic map;
  `cues.haptic` plays through it with a host rate cap (10/s, burst 3).
- **SDK.** Restyled on the shared tokens with dark mode, `fontScale`, Increase Contrast and Reduce Motion from
  the theme init frame; adds `Icon`, `Stepper`, `DateInput`, `Picker`, `toast`, `Screen` header, keyed
  `List`, ring progress; deprecates `Heading`, `radius` props and `tileColor`; removes nothing. The style
  gallery shows every component and variant.
- **Theme frame and runtime page.** The init frame's theme gains `scheme`, `tint`, `fontScale`,
  `reduceMotion`, `increaseContrast`, `platform` and three roles; the page drops `maximum-scale=1` and sets
  `color-scheme`. The outer page stamps the host generation on forwarded `paint` frames for the opening
  morph.
- **Generator.** `docs/sdk-reference.md` rewritten; prompts stop dictating layouts, teach tints and glyphs,
  cap clarify options at 40 characters, write plan rows for the app and never restate answers; the check
  stage resolves tint/icon names with diagnostics; few-shot fixtures and exemplars updated.
- **Copy.** One name per concept, controls speak as the person, the maker says "I" only in prose; a copy lint
  enforces it.

## Capabilities

### New Capabilities

None. The design system already has a home in `sdk-design-system`; the shell parts live in `app-launcher`.

### Modified Capabilities

- `sdk-design-system`: one token module, light/dark, named tints and glyphs, the extended theme frame, new
  and deprecated components, keyed lists, built-in motion, targets, the style-gallery rule.
- `app-launcher`: scheme-aware shell tokens, tiles and their states, host tint assignment and Customize tile,
  the orb and Whim sheet, opening and closing, soft delete with Undo, Settings and Advanced, haptics,
  simplified Whim Syntax, the copy glossary.
- `prompt-flow`: the making sheet's four pages, merged plan page, making page, ready and failure kinds,
  draft keeping, Stop.
- `launcher-screen-exits`: pushed shell screens on the native stack.
- `sandbox-rendering`: runtime page scheme and zoom, generation-stamped `paint` as the opening signal.
- `mini-app-cues`: haptics through `WhimHaptics`, host rate cap.
- `generation-contract`: the manifest carries `tint` and `icon`.
- `generation-pipeline`: clarify option length, plan-row rules, tint/icon extraction and prompting, no layout
  dictation.
- `version-history`: immediate "Use this version" and copy with Undo, chain order, no filters.
- `content-reporting`: Report is a pushed screen.
- `privacy-settings`: the phone ID moves under Advanced.
- `app-icon-and-launch`: the ember mark, light and dark launch backgrounds from the tokens.
- `server-connectivity`: the offline notice turns on by request evidence and a foreground return, no steady probe.

## Impact

- Code: `src/design/` (new), `src/sdk/**`, `src/host/**` (most launcher screens), `src/runtime/web/loader.js`,
  `build/assemble.mjs`, `src/native/`, `android/`, `ios/`, `server/src/generation/**`, `checks/passes/`,
  `contract/` docs, `fixtures/`, `release/assets/`.
- Dependencies (pinned exact): `react-native-reanimated@4.6.0`, `react-native-worklets@0.12.2`,
  `react-native-gesture-handler`, `react-native-svg`, `react-native-screens`,
  `react-native-keyboard-controller`. Fonts removed.
- Docs: `docs/sdk-reference.md`, `docs/capabilities.md` (app-launcher line), `docs/design/system.md` tables
  (generated).
- Issues folded in: #48, #49, #50, #67 (issue), #82, #89, #103, #104, #105, #126, #127, #128, #129, #130,
  #131, #132, #133, #135, #136, #149, #151 (copy half), #153. Out of scope: #52 (issue), #62, #70, #88, #100,
  #102, #106, #125, #151 (keepalive half).
