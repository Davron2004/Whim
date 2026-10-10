## Context

The design is settled: `docs/design/system.md` (values, components, motion, copy), decision #75 (philosophy,
reversals, surfaces, deferrals), the mockups (`docs/design/mockups/index.html`) and the palette proof. This
document decides how to build it. Terrain facts come from `research.md` (cited as R§).

Today: three token systems; a light-only shell whose palette is a frozen module constant read by 33 files and
baked into module-level `StyleSheet`s (R§ Relevant files); custom fonts on Android only; one `useState<Screen>`
machine with hard cuts; no animation, gesture, SVG or navigation library; `Vibration` for cues; a theme frame
that carries colours only; tiles as hex + monogram with exact-match reserved hues on device and server.

Constraints that shape every decision (R§ Constraints): containment and CSP unchanged; #45 inert theme; #41
no new syscall; Node suites can't import RN; device imports `@whim/contract` type-only; `CONFIG_SET` edits are
committed before gating; `StoreAccess.update` is wholesale.

## Goals / Non-Goals

**Goals:**
- Ship `system.md` faithfully on iOS and Android, shell and SDK, light and dark, at 100–200% text.
- One source for every value; drift is a gate failure, not a review comment.
- Installed apps keep working with no rebuild (re-theme through roles; deprecated props accepted).
- Each chain lands green on its own; the shell is usable between chains.

**Non-Goals:**
- Edge swipe over a running app (post-v1 spike), live preview on Ready, live tiles, blur, live theme updates
  inside a running app, server-sent time percentiles.
- New syscalls, CSP changes, or any change under `invariants/` by an implementer.
- The marketing site (`deploy/site/`) and store graphics typography.
- Content-policy and clarify-capability semantics (#62, #70, #125) beyond copy.

## Decisions

**D1 — Token source: `src/design/tokens.ts`, pure data, plus generated outputs with a drift check.**
The module exports roles per scheme, ember, status, tints, type scale, space, radii, shadows, springs (response,
ζ and the derived stiffness/damping), timings and layout constants. `scripts/design-tokens.mjs` writes the
outputs between markers: `system.md` token tables, the mockup's token block, `docs/design/system-v1/palette.json`
(read by `palette-check.py`) and `src/design/generated/springs.ts` (each spring sampled at 60 Hz into a `linear()`
string plus its settled duration and nearest cubic-bezier). A Node suite in `checks/` runs it in `--check` mode.
Alternatives: hand-kept copies with a review rule (rejected: finding 21, the docs disagreed within a week);
JSON as the source (rejected: loses types and comments; TS is what both bundlers read).

**D2 — Shell theming: one scheme hook over two constant objects.** `useTokens()` returns
`TOKENS.light|dark` from RN `useColorScheme()`; components build styles with `makeStyles((t) => …)` memoised
per scheme. No context provider, no palette prop (amends #62; app-launcher delta). Increase Contrast and
Reduce Motion come from `AccessibilityInfo` listeners in the same hook; text scale from
`useWindowDimensions().fontScale`. Alternative: a ThemeContext (rejected: a second channel #62 removed for
good reason; the OS is the only source).

**D3 — Theme frame: extend `theme`, sanitise in the SDK.** The host builds the frame from D2's state plus the
app's assigned tint; `sanitizeTheme` gains every field with defaults; `chromeInsetBottom` stays in the loader
closure (R§ Current behavior). Applied at mount, next open for changes. Alternative: fields beside the theme
in the loader closure (rejected: they are inert, bundle-readable by design, and the SDK needs them).

**D4 — Opening signal (C1 open item a): reuse `paint`, stamp the generation, no `firstPaint`.** `paint` is
already posted by the trusted loader after a double rAF following the first `render()` (R§ Current behavior),
so it is the first-paint signal; adding `firstPaint` would duplicate it. It is not generation-fenced today
because a reset recreates the iframe, but a frame forwarded to RN before a new bind can still be delivered
after it. So the outer page stamps the host `GEN` on forwarded `paint` (as it already does for nav-depth) and
the host accepts it as the opening signal only for the current bind; the boot watchdog keeps its trusted check.
Forgery stays bounded: a bundle cannot post a nonce-authenticated frame (F4), and the worst case is an early
release of the morph. Verification: on device, confirm `paint` arrives after the first visible frame on both
platforms; fallback if not: the loader wraps the first render in `flushSync` (still no new field).

**D5 — Tiles on the wire and on the device.** `defineApp` gains `tint` and `icon`; the check stage extracts
them with the existing single extraction and resolves them with diagnostics (generation-pipeline delta);
`validTileColor` and both `RESERVED_HUES` sets are deleted, because no tint can be a reserved hue. Name lists,
alias maps, the keyword table and the resolvers live in pure modules under `src/design/` (`tints.ts`,
`icons/names.ts`) that the host, the SDK, `checks/passes/manifest-extraction.ts` and the server check stage
import (the server already consumes `checks/`; the generator chain confirms the server bundle reaches
`src/design/` the same way, else re-exports through `checks/`). The host assigns at install, stores
`tint`/`icon`/`tileOverride` on the host record, and passes them back on every `StoreAccess.update`. Old hex
records map on read; no storage migration. `ghostTileColorFor` goes (tiles being made are ember tiles).

**D6 — Native stack: `react-native-screens` primitives driven by the existing machine.** Home is the stack root;
Settings, Advanced, AI features, History and Report (from History/Settings) are `ScreenStackItem`s rendered
from `LauncherRoot`'s state; `onDismissed` (gesture pops) writes back to the machine, which stays the single
source of truth and keeps #67's exit table. The making flow and the Whim sheet are sheets, not stack entries;
a running app is a full-screen layer above the stack. Alternative: `@react-navigation/native-stack`
(rejected: a second routing model beside the exit table, two more dependencies for one stack).

**D7 — Predictive back (C1 open item b): verify, with a fallback.** Set
`android:enableOnBackInvokedCallback="true"`; verify on API 34 and 37 that the pinned screens version previews
the pop and that the running app's `BackHandler` (R§ `useMiniAppHost.ts:379`) still receives back over the
WebView. Fallback if either fails: leave the flag off (standard native-stack pop, no preview), record it in
#75's entry, and open an issue; nothing else changes.

**D8 — Copies (C1 open item c): fresh data, no question.** "Make a copy" calls `StoreAccess.fork` without
`shareData`, so the copy gets its own storage-engine appId (#43b D8's behaviour, #52's unshared default); the
Home share-or-fresh sheet and its copy keys are deleted; rewind continuations keep `shareData: true` (#53 D5).
Docs cite it this way and never imply shared data for copies.

**D9 — Motion stack.** `react-native-reanimated@4.6.0`, `react-native-worklets@0.12.2` (babel plugin),
`react-native-gesture-handler` (sheets, orb), `react-native-svg`, all pinned exact after re-verifying against
RN 0.85.3 bridgeless (animation research). Keyboard tracking: `react-native-keyboard-controller`, because it
handles edge-to-edge insets and IME height changes (#128) on both platforms and Reanimated's own guidance points
to it over `useAnimatedKeyboard`. A static check bans `Animated`, `LayoutAnimation`, `useNativeDriver` and
literal spring configs in `src/host/`. Shell motion lands in phases: press and sheets with the primitives,
container transforms and honest light in the motion chain.

**D10 — SDK motion.** Springs from `src/design/generated/springs.ts` as `linear()` easings with a one-time
`CSS.supports` gate and cubic-bezier fallback; WAAPI for enter/leave/push/toast/progress; a ~40-line rAF spring
for retargetable controls and sheet drag; `List` uses FLIP for gap closing. `reduceMotion` from the theme frame
selects the reduced form inside each component. No public motion API.

**D11 — Haptics.** `WhimHaptics` TurboModule beside `WhimTone` (codegen spec in `src/native/`, Kotlin
`performHapticFeedback` with API-34 constants and fallbacks, Obj-C++ feedback generators prepared on touch-down).
The shell calls a pure `haptics.ts` map. `cue-backend.ts` plays `cues.haptic` through it with a token bucket
(10/s, burst 3) after the bridge's dedupe. `VIBRATE` stays for `EFFECT_*` cues.

**D12 — Platform theming.** Remove `MODE_NIGHT_NO` (follow system), add `values-night` colours, status and
navigation bar content per scheme; iOS keeps no override; launch screens and `brand.json` carry light and dark
`bg`; the release check compares both to the tokens; `android-accent.suite.ts` follows the new caret/selection
colours.

**D13 — Fonts retired.** Delete `assets/fonts/` and the Android copies, `FONT_FAMILY`, `TYPE_SCALE`'s face
fields and `android-fonts.suite.tsx`; the type scale moves to tokens with tracking in em converted to
`letterSpacing` per size.

**D14 — Icons vendored once.** `scripts/vendor-icons.mjs` reads `lucide-static@0.460.0` through
`npx --ignore-scripts --package=lucide-static@0.460.0` (no dependency added) and writes
`src/design/icons/paths.ts` (147 glyphs, chrome set, `circle`) plus the ISC notice. The ember silhouette path
is taken from the mockup and lives beside them.

**D15 — The making flow as one sheet.** `FlowScreen` becomes the sheet's page state (`describe | plan | making |
ready | failure`) keyed by the run journal id (#131); Continue fires clarify, the questions render as they
land and the rewrite starts at once with every question sent as `decide: true` (the rows must not restate
them; generation-pipeline delta); answers go to generate as `clarifications`. No wire change.

**D16 — Soft delete.** Delete hides the entry and arms a 10 s purge; a pending-purge marker in the launcher KV
makes the next launch finish an interrupted purge; Undo clears it. Same pattern for Discard (6 s).

**D17 — Copy and lint.** `copy.ts` adopts the glossary; a `checks/` pass flags retired words and first-person
control labels (keys are tagged as control or prose in the copy table); numbers format with the copy table's
language (#89). `product-verbs.suite.ts` is extended rather than duplicated.

**D18 — Style gallery rule.** Every SDK chain updates `fixtures/style-gallery.app.tsx`; a check fails when an
exported component isn't used in it. The gallery becomes four screens using `nav` and `Screen title`.

**D19 — First run: one sheet, two acts (ruled 2026-10-10 by the product-owner session, provisional until the
owner confirms on #173).** `system.md` §9 "First run" wins over the "own step" wording the live
`terms-acceptance` and `ai-data-consent` specs kept from legal-surface-v2; this change now carries MODIFIED
deltas for both. What stays a requirement: accepting the terms (the checkbox) and agreeing to send data (the
button) are two separate affirmative acts, neither pre-selected, each recorded with its own version; nothing
leaves the phone before every due act is recorded; "Not now" and back record nothing; the age gate still
blocks. The full disclosure sits on the sheet under "Full details" and may start collapsed. One tightening:
the always-visible first layer (the lead and the three summary rows) names every category of data sent, who
receives it and what for, in every legal language. Alternative not taken: two pages in one sheet (terms, then
the whole disclosure before the buttons). D8 ("copies: fresh data, no question") is superseded by the RESOLVED
note in tasks.md and the Forking requirement.

## Risks / Trade-offs

- [New native dependencies on RN 0.85.3 bridgeless break a platform build] → one bootstrap chain adds and pins
  them, builds both platforms and runs the release checks before any UI chain starts.
- [Predictive back or `BackHandler` coexistence fails] → D7 fallback; the exit table still guarantees exits.
- [`paint` precedes the first visible frame on a device] → D4 fallback (`flushSync`), measured on both
  platforms; the 600 ms cap bounds the wait either way.
- [Dark mode misses a hard-coded colour somewhere] → the scheme hook is the only colour path and a source scan
  fails on hex literals outside the token module.
- [Long serial line of shell chains] → the SDK, native and generator tracks run in parallel; each shell chain
  leaves the app usable.
- [The tracking table pinches SF titles on iOS] → device check; if it does, iOS display tracking drops to 0 in
  the token module (one value).
- [Removing the share-data question surprises someone who used it] → pre-users; rewind continuations still
  share; recorded in #75.
- [Server check stage can't import `src/design/`] → re-export through `checks/` (D5).

## Migration Plan

1. Land the token module, icons and SDK theme first: installed apps re-theme through roles with no rebuild.
2. Add native dependencies and modules (bootstrap chains), then the shell primitives.
3. Move screens one chain at a time; old and new components coexist until the copy chain deletes the old.
4. Generator changes land after the SDK surface is final; installed `tileColor` apps keep working through the
   nearest-tint mapping, and pre-release builds are not a compatibility constraint.
5. Rollback is per chain (each merges separately onto the staging branch); no data migration needs reversing:
   assigned tints and overrides are additive record fields, and hex records are mapped on read.

## Verification plan

- Every chain: `scripts/gate.sh` green in its worktree; `gate-full.sh` (Chromium invariants, knip,
  `guard:metro`, `openspec validate`) before merge.
- Mechanical: token drift, contrast floors, gallery coverage, `Animated`/spring-literal ban, copy lint, exit
  table, release asset checks, the `paint` generation fence, cue rate cap, tint assignment and resolver suites.
- Device (attended, chain `verification`): Android emulator or device at API 29, 34 and 37 and the iOS
  simulator (latest and the oldest supported runtime available); for each: light and dark, text at 100%,
  135% and 200%, Reduce Motion, Increase Contrast (iOS) / high-contrast text (Android), keyboard flows (Describe,
  plan row edit, Whim sheet send, Advanced address, Report note, in-app inputs), every screen exit (#149),
  predictive back (D7), `paint` ordering (D4), haptic map and cue latency, the style gallery's four screens,
  slow-motion recordings of each moment against the mockup motion lab, tap-to-first-paint before and after.
- Owner checks: the ember silhouette at 24 pt grey; iOS title tracking; the motion recordings.

## Open Questions

None blocking. The three C1 items are decided above (D4, D7, D8). Two choices are made here rather than in the
record and are open to the owner's veto: `react-native-keyboard-controller` (D9) and driving
`react-native-screens` primitives directly instead of React Navigation (D6).
