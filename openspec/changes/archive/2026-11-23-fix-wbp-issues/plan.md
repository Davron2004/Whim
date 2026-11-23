# Plan: fix-wbp-issues

## Checklist

- [x] gh-299 — static checks flag frame self-navigation and bridge names
- [x] gh-300 — "Send error details" switch on/off states readable
- [x] gh-301 — "Server address" label inset matches other section labels
- [x] gh-302 — first-run "What stays on your phone" uses a device glyph
- [x] gh-303 — dev Logs pill clear of orb/composer; Logs times marked UTC
- [x] gh-304 — DevProbe first tap works; dark strip under status bar
- [x] gh-305 — no LogBox warning toast on debug launch
- [x] gh-306 — Podfile.lock and project.pbxproj match a clean pod install
- [x] gh-307 — one working, documented pod install path
- [x] gh-308 — v1-upgrade notice names the automatic app safety checks

## Lane ios-pods (gh-306, gh-307)

Allowlist: `ios/Podfile.lock`, `ios/Whim.xcodeproj/project.pbxproj`, `ios/Whim.xcworkspace/contents.xcworkspacedata`,
`Gemfile`, `Gemfile.lock`, `.bundle/config`, `docs/release/mobile.md`.

## gh-307
- reconciled: `docs/release/mobile.md:160-161` symlinks `vendor/bundle` from the primary tree then runs `bundle exec pod
  install`; the primary tree's `vendor/bundle/ruby/` is empty, so the symlink can't work. `.bundle/config` sets
  `BUNDLE_FORCE_RUBY_PLATFORM: 1` (native gems compile from source: the "native extensions" failure).
  `fastlane/Fastfile:163` (TestFlight lane) hardcodes `bundle exec pod install`, so the Bundler path must work anyway.
- fix sketch: Bundler is the one install path (Gemfile.lock pins cocoapods 1.15.2 exactly; a system-pod version
  check would need `scripts/**`). `bundle install` in the fresh worktree; if it fails only on native builds caused by
  `BUNDLE_FORCE_RUBY_PLATFORM`, drop that line (Gemfile.lock already lists prebuilt ffi for arm64-darwin). Commit
  Gemfile.lock only on a real change; keep cocoapods 1.15.2. Rewrite mobile.md: `bundle install` replaces the
  symlink line; `:164-166` says every checkout runs `bundle install` once, gems in gitignored `vendor/bundle`, never
  the system `pod`; drop the "restore Podfile.lock" advice at `:174-175`; rewrite the `:373-375` troubleshooting entry
  for what actually fails; state the Ruby prerequisite (Homebrew Ruby 4.x; macOS `/usr/bin/ruby` 2.6 can't run Bundler 4).
- test-class: structural-no-test — verification: the documented commands, run verbatim in a fresh worktree, succeed.
- severity: low · class-1 grant: none

## gh-306
- reconciled: `ios/Podfile.lock` has `COCOAPODS: 1.15.2` and a ReactCodegen checksum that changed under system pod
  1.17.0. Bundled 1.15.2 (xcodeproj 1.25.1, Gemfile caps `< 1.26.0`) is the version that agrees with the lockfile;
  the drift came from runners using system pod 1.17.0.
- fix sketch: after gh-307, `bundle exec pod --version` must print 1.15.2; `(cd ios && bundle exec pod install)`;
  commit Podfile.lock and project.pbxproj exactly as pod install leaves them (no hand edits); a second
  `bundle exec pod install` must leave `git status` clean.
- test-class: structural-no-test — verification: a second clean install leaves the tree clean.
- severity: low · class-1 grant: none

### EVIDENCE (gh-306, gh-307)
```
## ios/Podfile.lock
  ReactCodegen: f4d20d21b3dfcf4a00663f4f75a4774d01376aa7
COCOAPODS: 1.15.2
## docs/release/mobile.md
   mkdir -p vendor && ln -s <repo>/vendor/bundle vendor/bundle
```

## Lane static (gh-299)

## gh-299
- reconciled: `FORBIDDEN_DIRECT_NAMES` (`checks/contract.ts:259-278`) lacks `location`, `ReactNativeWebView`, `webkit`;
  `FORBIDDEN_MEMBER_PATHS` (`:282`) holds only `['navigator','sendBeacon']`. The pass flags a global identifier only
  when it is in `FORBIDDEN_DIRECT_NAMES ∪ GLOBAL_ROOTS` (`checks/passes/forbidden-globals.ts:16`, `:147`), so the bare
  forms (`location.href = …`, `location.assign/replace(…)`, `location = …`, `ReactNativeWebView.postMessage(…)`,
  `webkit.messageHandlers.X.postMessage(…)`) and their aliases are unflagged. Rooted forms (`window.location…`) are
  already flagged via the root, but with the generic DOM hint. The SDK (`src/sdk/events.ts`) is never scanned.
- fix sketch: add the three names to `FORBIDDEN_DIRECT_NAMES` under a new comment group (frame navigation + native
  bridge) and update the doc comment at `checks/contract.ts:254-257`. That plugs into `DIRECT_FORBIDDEN_NAMES`
  (bare reads), `TAINT_SOURCE_NAMES` in `checks/internal/scope.ts:79` (aliases), and the existing binding resolution
  (locals/params/destructured named `location`, `x.location`, `{ location: … }` keys stay exempt). Add hint branches
  in `hintFor` (`forbidden-globals.ts:19-36`): `location` → "Apps can't navigate or reload the page; move between
  screens with vc-sdk's `nav.navigate('ScreenName')`." (verify the real vc-sdk navigation API name in src/sdk and
  use it); `ReactNativeWebView`/`webkit` → "The native bridge is not available to apps; use vc-sdk capabilities
  instead." Rooted forms whose property is one of the three names should get the specific hint too.
- planner side finding, folded in (same pass, same files): a shorthand property `{ fetch }` in an object literal is
  a READ of the global, but `NAMED_BINDING_DECLARATION_KINDS` includes `ShorthandPropertyAssignment`
  (`checks/internal/scope.ts:95`), so `const o = { fetch }; o.fetch(u)` / `({ location }).location.href = …` evade
  every name on the list. Fix: a `ShorthandPropertyAssignment` name resolves as a value reference to its binding
  (a write target inside an assignment pattern is a global write — flagging it is correct too).
- allowlist:
```text
checks/contract.ts
checks/passes/forbidden-globals.ts
checks/internal/scope.ts
checks/test/acceptance.ts
checks/test/hostile/corpus.ts
openspec/specs/static-checks/spec.md
```
- test-class: behavioral
- test: in `checks/test/acceptance.ts` `testForbiddenGlobalsWalk()` (:353) add the three names to the written-out
  `mustFlag` set (:358-361); add cases: bare `location.href = 'data:text/html,x'` (symbol `location`, navigation
  hint), bare `location.replace`/`assign`, `window.location.href`/`globalThis.location.assign` (specific hint),
  alias `const l = location; l.href = 'x'`, `ReactNativeWebView.postMessage` bare + via window (bridge hint),
  `webkit.messageHandlers.h.postMessage` bare + via window, shorthand `const o = { fetch }; void o;` and
  `({ location }).location.href = 'x'` flagged; NEGATIVE: `const location = { href: '' }; location.href = 'x';`,
  a param property `trail.location`, `{ location: 'Park' }` key, `const { location: where } = …`, and a shorthand of
  a LOCAL (`const fetch = 1; const o = { fetch };`) not flagged. Hostile corpus (`checks/test/hostile/corpus.ts`): an
  aliased-location data: self-navigation case expecting `forbidden_global`. Run `npm run checks:test -- --only globals:`
  and the full `npm run checks:test`. Red without fix: bare, alias, shorthand and hint cases fail.
- false-positive check: no corpus app or honest fixture names `location`, `webkit` or `ReactNativeWebView`; only
  `fixtures/adversarial/*` do and they already fail. Expected false-positive rate ≈ 0.
- severity: low · class-1 grant: none

### EVIDENCE (gh-299)
```
## checks/contract.ts
export const FORBIDDEN_MEMBER_PATHS: readonly (readonly string[])[] = [['navigator', 'sendBeacon']];
## checks/passes/forbidden-globals.ts
const DIRECT_FORBIDDEN_NAMES: ReadonlySet<string> = new Set([...FORBIDDEN_DIRECT_NAMES, ...GLOBAL_ROOTS]);
## checks/internal/scope.ts
const TAINT_SOURCE_NAMES: ReadonlySet<string> = new Set([...GLOBAL_ROOTS, ...FORBIDDEN_DIRECT_NAMES]);
```

## Lane launcher-ui (gh-300, gh-301, gh-302, gh-308)

Allowlist:
```text
src/host/ui/GroupedList.tsx
src/host/ui/TextField.tsx
src/host/launcher/AdvancedScreen.tsx
src/host/launcher/FirstRunSheet.tsx
src/host/launcher/DescribePage.tsx
src/host/launcher/copy.ts
src/host/launcher/test/settings-screen.suite.tsx
src/host/launcher/test/shell-surfaces-ui.suite.tsx
src/host/launcher/test/shell-controls-ui.suite.tsx
src/design/icons/names.ts
src/design/icons/paths.ts
src/design/icons/LICENSE
docs/design/system.md
docs/design/mockups/index.html
docs/sdk-reference.md
deploy/site/privacy.html
deploy/site/fr/privacy.html
```

## gh-300
- reconciled: every shell switch is `RowSwitch` in `src/host/ui/GroupedList.tsx:196-210`. It draws exactly what
  `docs/design/system.md:635` specifies: on-track `ink`, off-track `border`; on Android the knob is `border` when on
  and `ink` when off (the knob overhangs the track onto the group). Result on Android: on = dark track + grey knob,
  off = grey track + dark knob — two inverses, and "on" reads as disabled. There is no "accent" token; `ember` is
  reserved for "Whim is doing the work" (system.md:47) and fails the 3:1 switch test on Android dark.
- SUPERSEDED 2026-11-23 by the owner after seeing the device screenshots: keep the native switch on both platforms,
  recolour only so ON is obvious; colour on the knob allowed. Landed as role `switch-on` (#208E4E): Android ON = green
  knob on the ink track, OFF = ink knob on the border track; iOS ON track = switch-on. The original sketch follows.
- orchestrator decision (owner asked for the issue to be done): keep `ink` as the shell-switch colour (system.md §1),
  and fix the Android mapping so the state reads at a glance, following the platform convention: ON = the knob in the
  strongest colour (`ink`) at the trailing end over a mid-tone track; OFF = a neutral, lighter knob over the `border`
  track. Pick tokens that keep `switchShortfalls` (shell-controls-ui.suite.tsx:394) green in every OS × scheme ×
  surface × state. iOS keeps the platform look (ink track, `on-ink` knob; off `border`) unless the worker finds it
  also misreads. Update system.md:635 and the comments at GroupedList.tsx:8-10/190-195 to the new mapping. If no
  token mapping satisfies both "reads correctly" and the existing 3:1 rule, STOP and report the options with the
  measured contrast ratios — never relax the test.
- test-class: behavioral (existing pins): `shell-surfaces-ui.suite.tsx:1752` (trackColor pin) changes to the new
  mapping and gains a case asserting the Android on-knob is the strongest colour and differs from the off-knob;
  `shell-controls-ui.suite.tsx:394` stays green unchanged. Run
  `npm run launcher:test -- --only shell-surfaces-ui --only shell-controls-ui`. Device screenshots after merge.

## gh-301
- reconciled: section headers/footers inset `ROW.paddingHorizontal` (= `LAYOUT.listRowPaddingHorizontal`, 16) at
  `GroupedList.tsx:85-86`; `TextField`'s label and helper rows have no horizontal inset (`TextField.tsx:86`, `:96`);
  AdvancedScreen's probe `checkLine` and `ownServerCaption` (`AdvancedScreen.tsx:90-91`, `:213`, `:227`) neither.
- fix sketch: inset label, helper/error row, probe check line and caption by `LAYOUT.listRowPaddingHorizontal`; the
  field box stays full width. Make the TextField inset unconditional (a field label is a section-label-like caption
  everywhere); the only other helper user, `DescribePage.tsx:109`, moves with it — check it still reads right in the
  test render, it gets a device screenshot after merge. Update system.md's Text field row if it names the inset.
- test-class: behavioral: one case in `src/host/launcher/test/settings-screen.suite.tsx` (`advanced()` with
  `serverChoice: 'own'`) summing ancestors' left padding/margin (pattern `history-ui.suite.tsx:529`) and asserting
  `COPY.serverAddressSectionTitle`, `COPY.serverAddressHint`, the caption and `COPY.settingsThisPhoneSection` share
  one x. Run `npm run launcher:test -- --only settings-screen`. Red without fix: label/hint at 0 vs header at 16.

## gh-302
- reconciled: `FirstRunSheet.tsx:224` uses `icon="phone"` (Lucide handset); the vendored set has no smartphone glyph.
- fix sketch: vendor Lucide `smartphone` as a CHROME icon: add it to the `ICONS` map in
  `docs/design/mockups/index.html` (verify the exact markup against Lucide's `smartphone` — rect 14×20 at 5,2 rx 2,
  path `M12 18h.01`), append to `CHROME_NAMES` (`src/design/icons/names.ts:52-56`), to system.md's chrome-set list
  (`:321-323`) and to `docs/sdk-reference.md:81` interface icons (same order), run `node scripts/vendor-icons.mjs`
  (regenerates `paths.ts` + `LICENSE`), set `icon="smartphone"`.
- test-class: structural-no-test; tripwires stay green: `npm run sdk:test -- --only icons`,
  `npm run server:test -- --only prompts`.

## gh-308
- reconciled: `copy.ts:676/678` (en) and `:697/699` (fr) still say "when something goes wrong"; the consent sheet now
  says "Error details and automatic app safety checks" (`copy.ts:360`; fr `:816` "Des détails d’erreur et des
  contrôles de sécurité automatiques").
- orchestrator decision (owner asked for the issue to be done): reword. en text starts `New: error details and
  automatic app safety checks, and checks by Apple or Google …`, covers `'category:error-details': 'error details and
  automatic app safety checks'`; fr text starts `Nouveau : les détails d’erreur et les contrôles de sécurité
  automatiques, et les vérifications par Apple ou Google …`, covers `'détails d’erreur et les contrôles de sécurité
  automatiques'` (keep U+2019). Rest unchanged. Also read the error-details row of `deploy/site/privacy.html:92` and
  `deploy/site/fr/privacy.html:93` — it already names the safety checks; change it only if it now contradicts.
- test-class: invariant (existing): `npm run checks:test -- --only disclosure --only consent-coverage` and
  `npm run launcher:test -- --only product-verbs --only whim-prose`.

### EVIDENCE (launcher-ui lane)
```
## src/host/ui/GroupedList.tsx
  const androidKnob = value ? t.colors.border : t.colors.ink;
## src/host/ui/TextField.tsx
  label: { ...typeStyle('footnote', true), color: t.colors['text-2'], marginBottom: FIELD.labelGap },
## src/host/launcher/FirstRunSheet.tsx
        <GroupedRow icon="phone" title={copy.firstRunStaysTitle} subtitle={copy.firstRunStays} />
## src/host/launcher/copy.ts
        'category:error-details': 'error details when something goes wrong',
```

## Lane dev-ui (gh-303, gh-304, gh-305)

Allowlist:
```text
src/host/launcher/LauncherRoot.tsx
src/host/launcher/dev-log-view.ts
src/host/launcher/test/observability-ui.suite.ts
src/host/launcher/HomeHeader.tsx
src/host/launcher/test/home-grid-ui.suite.tsx
src/host/launcher/DevProbeScreen.tsx
src/host/launcher/screen-exits.ts
src/host/launcher/test/screen-exits*.ts*
src/host/platform/install-diagnostics.ts
src/host/launcher/MiniAppView.tsx
src/host/ui/Sheet.tsx
src/host/launcher/test/native-reanimated.tsx
src/host/launcher/test/native-reanimated.suite.tsx
```

## gh-303
- reconciled: the dev pill is `position:'absolute', right: SPACE[4]`, `bottom: bottomInset + SPACE[4]`
  (`LauncherRoot.tsx:758`, styles `:4043-4049`), inside the orb's footprint (`orb-geometry.ts:15-40`, either corner)
  and the composer's band (`ComposerBar.tsx:24`, 12–64 pt above the inset). Top corners are taken on Home (title,
  Settings). `formatRecordTime` returns bare UTC `HH:MM:SS.mmm` (`dev-log-view.ts:66-69`, pinned by
  `observability-ui.suite.ts:267`).
- fix sketch: `bottom: chromeInsetBottom(bottomInset) + SPACE[2]` (already imported from `./orb-geometry`), keep
  `right: SPACE[4]`; update the comment at `:748`. `formatRecordTime` appends ` UTC`; update its doc comment.
- test-class: behavioral for the UTC marker (`observability-ui.suite.ts:267` expects `'09:30:15.250 UTC'`;
  `npm run launcher:test -- --only observability-ui`; red without fix). Placement: structural-no-test (`__DEV__` is
  false in the launcher runner), device-checked after merge.

## gh-304
- reconciled: `HomeHeader.tsx:46` `onLongPress={onOpenDevProbe}` → `setScreen({ kind: 'dev' })`
  (`LauncherRoot.tsx:3437`) navigates while the finger is still down; `dev` is not on the `NativeStack`, so the
  stack (including the Pressable holding the responder) unmounts mid-gesture and the release is lost (inferred).
  The light strip: for `dev` the shell's SafeAreaView pads `['top']` (`screen-exits.ts:52`) on `colors.bg`;
  DevProbe's own RN `SafeAreaView` (`DevProbeScreen.tsx:11`) is deprecated and iOS-only.
- fix sketch: HomeHeader arms a ref on `onLongPress` and navigates on `onPressOut` (then clears it). DevProbeScreen
  uses `SafeAreaView` from `react-native-safe-area-context` like `src/host/BridgeProbeScreen.tsx:14,35,62` (same
  dark root), with `<StatusBar barStyle="light-content" />`. `screen-exits.ts` returns `[]` for `dev` (`app` keeps
  `['top']`), matching `openspec/specs/launcher-screen-exits/spec.md:56` ("The developer probe screen applies its
  own safe area"); update its doc comment and any test pinning it.
- test-class: behavioral for the deferred navigation: in `home-grid-ui.suite.tsx`, `renderHome({ onOpenDevProbe:
  spy })`, the Pressable with `COPY.homeTitle`: `onLongPress()` leaves the spy at 0, then `onPressOut()` makes it 1,
  a later `onPressOut()` with no long-press keeps it 1. `npm run launcher:test -- --only home-grid-ui`. The
  swallowed tap itself gets device verification after merge.

## gh-305
- reconciled: (a) `install-diagnostics.ts:40` deep-requires `react-native/Libraries/promiseRejectionTrackingOptions`;
  RN 0.88.1 has no public replacement. The warning is a `console.warn` appended to the importing module by
  `@react-native/babel-preset`'s `plugin-warn-on-deep-imports.js`; `LogBox.ignoreLogs` matches substrings.
  (b) = gh-304's SafeAreaView. (c) Reanimated `warnOnce` for a deps array: five `useAnimatedReaction` call sites
  pass one — `MiniAppView.tsx:446/461`, `:469/474`, `:553/558`; `Sheet.tsx:560/573`, `:820/825`.
- fix sketch: (a) documented narrow exception: under `if (__DEV__)`, `LogBox.ignoreLogs(["Deep imports from the
  'react-native' package are deprecated ('react-native/Libraries/promiseRejectionTrackingOptions')."])` with a
  comment citing #281 (verify the exact message text in node_modules/@react-native/babel-preset). (c) drop the deps
  argument at the five sites (native ignores it; the mapper is keyed by the worklet closures). The Node double
  (`native-reanimated.tsx:734`, `deps = []`) must then re-track on every commit when deps are omitted, as native
  re-keys on a closure change; adapt its deps test (`native-reanimated.suite.tsx:375-392`) without lowering its
  assertion count (removal ratchet).
- test-class: structural-no-test; regression: `npm run launcher:test -- --only native-reanimated,mini-app-host-ui,
  sheet-morph-ui,mini-app-delivery`, then the full `npm run launcher:test`. Device check after merge: no toast.

### EVIDENCE (dev-ui lane)
```
## src/host/launcher/dev-log-view.ts
  return new Date(at).toISOString().slice(11, 23);
## src/host/launcher/HomeHeader.tsx
      <Pressable style={s.title} onLongPress={onOpenDevProbe} accessible={false}>
## src/host/launcher/DevProbeScreen.tsx
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
## src/host/platform/install-diagnostics.ts
  return __DEV__ ? require('react-native/Libraries/promiseRejectionTrackingOptions').default : undefined;
## src/host/ui/Sheet.tsx
    [anchored, grew],
```

## Round 2 and 3 checklist (findings from the device check of the merged tip)

Each was planned, fixed and device-verified on an iOS simulator by one agent per lane (bug fixes start from a real
reproduction), then reviewed, red-checked where behavioral, full-gated and merged. Details: dispositions.md.

- [x] wbp-d1 — a launch before the page's first load end waits for its bridge token (product path never exposed)
- [x] wbp-d2 — no dev LogBox toast on launch (ReducedMotionConfig removed; the deep-import filter works)
- [x] wbp-d3 — the Whim-menu field is no longer covered by the Done bar's in-tree host (RN 0.88 un-hide bug; #310)
- [x] wbp-d4 — the iOS switch knob is white in both schemes (`switch-knob`)
- [x] wbp-d5 — not reproduced (screenshots predated consent); consent → verified pinned by a test
- [x] wbp-d6 — DevProbe's chips hold still while status lines arrive
- [x] wbp-d7 — AI features content sits a full 16 pt under the header (the reported overlap did not reproduce)
- [x] wbp-d8 — the dev Logs panel sets its own status bar style
