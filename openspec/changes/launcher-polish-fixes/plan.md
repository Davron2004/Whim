# Plan: launcher-polish-fixes

<!--
  DONE specs written by the planner at integration/store-launch 117a88f, from the reconcile in
  findings.md. The orchestrator still runs `scripts/fixloop.sh stale` on each EVIDENCE fence at
  dispatch time (the staging tip will have moved). Tick a box only at a terminal ledger event.
-->

## Checklist

- [ ] F1 — ⚙ settings glyph renders as a colour emoji on iOS
- [ ] F2 — `process.platform = 'android'` polyfill (ALREADY FIXED: ledger `skipped` at run start)
- [ ] F3 — dev probe fixture buttons deliver nothing
- [ ] F4 — tile initials announced twice
- [ ] F5 — no test that `ConnectivityLoop.stop()` clears its retry
- [ ] F6 — stale "see ./polyfills" comment
- [ ] F7 — delete `contract-mirror.ts`; unbinary `report-payload.suite.ts`
- [ ] F8 — probe screens hard-code `paddingTop: 48`
- [ ] F9 — dev probe entry gated on `__DEV__` alone

Dispatch order: F6 and F8 are eligible now. F1, F3, F4, F5, F7 and F9 wait for `store-launch-compliance` chain-7 to merge (they touch `src/host/launcher/**`). Once eligible, all run in parallel; no two share a file. Don't merge F9 in the same regate window as `ios-launcher-back-navigation` chain-2 or chain-3, which also edit `LauncherRoot.tsx`.

## F1

- reconciled: live. `HomeScreen.tsx:160` renders `{'⚙'}` with no U+FE0E. A Node scan with `\p{Extended_Pictographic}` over every non-test `.ts`/`.tsx` under `src/host/` finds it as the only such character outside a comment (`realm-delivery.ts:10` `▶` and the `↔` in `bridge/contract.ts:29,75` and `version-store/engine.ts:167` are all in comments).
- fix sketch: change the literal to `'⚙\uFE0E'` (the gear followed by the six-character escape for U+FE0E, so the selector stays visible in source). Add one invariant case to `test/theme.suite.ts`, which already walks every file under `src/`: strip `//` and `/* */` comments, then fail naming `file:line` for any `\p{Extended_Pictographic}` code point in a non-test `src/host/**` `.ts`/`.tsx` source that isn't immediately followed by U+FE0E. Make it non-vacuous in the suite itself with two inline sources: the glyph inside a comment passes, the glyph in a string literal without the selector fails.
- allowlist:
  ```
  src/host/launcher/HomeScreen.tsx
  src/host/launcher/test/theme.suite.ts
  ```
- test-class: invariant (the shell never renders an emoji-capable character without asking for text presentation; iOS draws it in colour otherwise, and no typecheck or lint sees it).
- test: the new `theme.suite.ts` case is red at BASE on `src/host/launcher/HomeScreen.tsx:160` and green after. `scripts/fixloop.sh redcheck <branch> src/host/launcher/test/theme.suite.ts -- src/host/launcher/HomeScreen.tsx` must exit 0.
- severity: med
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/HomeScreen.tsx
<Text style={[styles.settingsGlyph, { color: p.text }]}>{'⚙'}</Text>
```

## F2

- reconciled: ALREADY-FIXED. `src/host/platform/hermes-polyfills.ts:43,59` writes `process.platform` only when a platform is passed and none exists; `:63` passes none; `install-entry-polyfills.ts:12-14` passes the real `Platform.OS`; `index.js:5` imports it first; `checks/test/release/hermes-entry.suite.ts:121-138` locks it. No `'android'` default remains under `src/` or in `index.js`.
- fix sketch: none. Ledger `skipped (already fixed by platform-release-readiness chain-2)` at run start and tick the box.
- allowlist: none
- test-class: n/a
- severity: low
- class-1 grant: none

## F3

- reconciled: live. `DevProbeScreen.tsx:61` calls `host.deliverByRecord(recordFor(name), name)`; `useMiniAppHost.ts:244-248` reinjects by name with no source; `build/build.mjs:301` bakes `bundles: {}`; `build/assemble.mjs:130` returns on an unknown name after logging it. `deliverByRecord` has no other caller (`/usr/bin/grep -rn deliverByRecord src` shows only the interface `:157`, the definition `:244`, the return `:387`, the screen, and `bundle-error-watchdog.suite.ts:178`'s slice boundary).
- fix sketch: create React Native-free `src/host/launcher/dev-probe-fixtures.ts` exporting `DEV_PROBE_FIXTURES` (the current `DELIVERABLE` tuple, unchanged) and `devProbeFixture(name: DevProbeFixture): { record: AppRecord; source: string }`, reading `APP_RECORDS` (with `recordFor`'s current fallback) and `APP_BUNDLES` from `src/runtime/generated/`. In `DevProbeScreen.tsx` map over `DEV_PROBE_FIXTURES` and call `host.deliverBySource(fixture.record, fixture.source)`. Remove `deliverByRecord` from `MiniAppHost` and `useMiniAppHost`. In `bundle-error-watchdog.suite.ts:178` change the slice end from `'const deliverByRecord'` to `'const deliverBySource'` so it still bounds `bind`'s body. Leave `build/` alone.
- allowlist:
  ```
  src/host/launcher/dev-probe-fixtures.ts
  src/host/launcher/DevProbeScreen.tsx
  src/host/launcher/useMiniAppHost.ts
  src/host/launcher/test/dev-probe-back-button.suite.ts
  src/host/launcher/test/bundle-error-watchdog.suite.ts
  ```
- test-class: behavioral
- test: a case in `test/dev-probe-back-button.suite.ts` (the DevProbeScreen wiring suite): for every name in `DEV_PROBE_FIXTURES`, `devProbeFixture(name).source` is non-empty and `bundleDefinesApp` (from `bundle-validity.ts`) accepts it, and `record.appId` is set. New-module caveat: reverting to BASE deletes the module, so a revert red-check proves only a build failure. VERIFY judges non-vacuity against the weaker variant instead: a `devProbeFixture` that returns the baked page map's entry (empty) must fail the case.
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/DevProbeScreen.tsx
<TouchableOpacity key={name} style={styles.btn} onPress={() => host.deliverByRecord(recordFor(name), name)}>
## src/host/launcher/useMiniAppHost.ts
deliverByRecord: (record: AppRecord, bundleName: string) => void;
## build/build.mjs
bundles: {},
```

## F4

- reconciled: live. `app-tile.tsx:146-147` renders `{mono}` in two `Text` nodes with no accessibility props; neither touchable in `HomeScreen.tsx` (`:187-193`, `:296-303`) sets a label. React Native 0.85's iOS label composition skips only `accessibilityElementsHidden` subviews (`RCTViewComponentView.mm:1381-1384`).
- fix sketch: add `accessibilityElementsHidden` and `importantForAccessibility="no"` to both monogram `Text` nodes. Change nothing else, including the name `Text`, the pill and the touchables.
- allowlist:
  ```
  src/host/launcher/app-tile.tsx
  ```
- test-class: behavioral, device-only. No Node seam exists: the file imports React Native and the platform composes the label natively. Skip RED-CHECK. VERIFY confirms by inspection that the diff is exactly those two nodes' props, and that `tile-colour.suite.ts:161-174`, `grid-composition.suite.ts:212,228` and `app-busy.suite.ts:209` stay green. The screen-reader result is checked in the attended walk (`ios-launcher-back-navigation` task 4.1, VoiceOver; task 4.2, TalkBack).
- severity: med
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/app-tile.tsx
<Text style={[styles.ghostMonogram, isDone ? styles.ghostMonogramDone : null]} numberOfLines={1}>{mono}</Text>
<Text style={[styles.foregroundMonogram, isDone ? styles.foregroundMonogramDone : null]} numberOfLines={1}>{mono}</Text>
```

## F5

- reconciled: live as a coverage gap. `connectivity.ts:116-119` clears the timer, and `test/connectivity.suite.ts` never calls `.stop(` (count 0). This finding only adds a test, so its EVIDENCE shows the code under test exists; the stale check can't see a test's absence. Before dispatch, also confirm `/usr/bin/grep -c '\.stop(' src/host/launcher/test/connectivity.suite.ts` still prints 0.
- fix sketch: one case, "ConnectivityLoop: stop() cancels the pending retry and nothing runs afterwards", reusing the suite's `FakeTimers`. With a probe that counts calls and always returns `'unreachable'`: `start()`, `await whenIdle()`, assert `pendingCount === 1` and one probe call; `stop()`; assert `pendingCount === 0`, still one probe call, and no state published after `stop()`.
- allowlist:
  ```
  src/host/launcher/test/connectivity.suite.ts
  ```
- test-class: behavioral (the finding is the missing test; production code doesn't change)
- test: the red-check is a mutation, because BASE already clears the timer and `fixloop.sh redcheck` would report exit 5. Worker, and the orchestrator again before VERIFY: delete `this.clearPendingTimer();` from `stop()` in `connectivity.ts`, run `npm run launcher:test`, confirm the new case fails on `pendingCount`, then `git checkout src/host/launcher/connectivity.ts`. This mutation is also the plausible weaker implementation (`stop()` that only sets `stopped`).
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/connectivity.ts
stop(): void {
this.stopped = true;
```

## F6

- reconciled: live. `src/host/version-store/env.d.ts:4` says `see ./polyfills`; `src/host/version-store/polyfills.ts` doesn't exist; the code is at `src/host/platform/hermes-polyfills.ts`.
- fix sketch: replace `see ./polyfills` with `see ../platform/hermes-polyfills`. Nothing else.
- allowlist:
  ```
  src/host/version-store/env.d.ts
  ```
- test-class: structural-no-test
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/version-store/env.d.ts
* via text-encoding-polyfill — see ./polyfills) and native in Node, but the app's
```

## F7

- reconciled: live. Confirmed after compliance chain-6 merged: `contract-mirror.ts` still exists with five production importers and three suite importers (listed in findings.md), and `contract/src/index.ts` exports the same four names with identical shapes (`:193`, `:200-206`, `:210`, `:306-314`). `report-payload.suite.ts:131-133` holds literal NUL bytes; `file` reports the suite as `data`.
- fix sketch: in `service-refusal.ts`, `refusal-landing.ts`, `report-payload.ts`, `ReportSheet.tsx` and `generation-client.ts`, import the same names with `import type { … } from '@whim/contract'` (never a value import in these files; zod must not reach Metro), and reword the header comments in `service-refusal.ts:5`, `refusal-landing.ts:5` and `report-payload.ts:6,15-16` to name `@whim/contract`. In `test/service-refusal.suite.ts:15`, `test/refusal-landing.suite.ts:17` and `test/report-payload.suite.ts:20`, import the zod values from `@whim/contract`. In `test/report-payload.suite.ts:131-133` replace each literal NUL with the escape `\u0000`. Delete `contract-mirror.ts`. Don't touch `openspec/changes/store-launch-compliance/handoff/client-refusals-report.md`, which still names the mirror (in-flight change folder; the orchestrator notes it at that change's archive).
- allowlist:
  ```
  src/host/launcher/contract-mirror.ts
  src/host/launcher/service-refusal.ts
  src/host/launcher/refusal-landing.ts
  src/host/launcher/report-payload.ts
  src/host/launcher/ReportSheet.tsx
  src/host/launcher/generation-client.ts
  src/host/launcher/test/service-refusal.suite.ts
  src/host/launcher/test/refusal-landing.suite.ts
  src/host/launcher/test/report-payload.suite.ts
  ```
- test-class: structural-no-test. The existing suites become the assurance against the real contract: `service-refusal.suite.ts:29` now compares `REFUSAL_RULES` to the contract's own enum, and `report-payload.suite.ts` parses with the contract's `ReportRequest`. VERIFY also checks `/usr/bin/grep -rn contract-mirror src` is empty, `git diff --stat` shows `report-payload.suite.ts` as a text diff, and FULL GATE's `guard:metro` passes. If the launcher runner can't bundle a value import from `@whim/contract`, that's a class-B stop to escalate, not a reason to keep the mirror.
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/contract-mirror.ts
export const ServiceRefusalCode = z.enum([
## src/host/launcher/service-refusal.ts
import type { ServiceRefusalCode } from './contract-mirror';
## src/host/launcher/report-payload.ts
import type { ReportReason, ReportRequest } from './contract-mirror';
## src/host/launcher/test/report-payload.suite.ts
import { ReportRequest as ReportRequestSchema } from '../contract-mirror';
```

## F8

- reconciled: live. The four probe screens each render a root `View` whose style is `paddingTop: 48` (`BridgeProbeScreen.tsx:34,61`, `VersionStoreProbeScreen.tsx:48,75`, `NetworkDenyProbeScreen.tsx:221,254`, `StorageProbeScreen.tsx:38,65`); `App.tsx:40` already provides `SafeAreaProvider`. No suite pins their layout (`logging.suite.ts:61-68` lists three of them by path for its `console` carve-out, which this fix doesn't affect).
- fix sketch: in each file, import `SafeAreaView` from `react-native-safe-area-context`, make it the root element with its default edges, and delete `paddingTop: 48` from `styles.root`. Keep `flex`, `backgroundColor` and `paddingHorizontal`.
- allowlist:
  ```
  src/host/BridgeProbeScreen.tsx
  src/host/VersionStoreProbeScreen.tsx
  src/host/NetworkDenyProbeScreen.tsx
  src/host/StorageProbeScreen.tsx
  ```
- test-class: structural-no-test (layout only; confirmed on the iPhone in the next attended probe run)
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/BridgeProbeScreen.tsx
root: { flex: 1, backgroundColor: '#0b1020', paddingTop: 48, paddingHorizontal: 12 },
## src/host/VersionStoreProbeScreen.tsx
root: { flex: 1, backgroundColor: '#0b1020', paddingTop: 48, paddingHorizontal: 12 },
## src/host/NetworkDenyProbeScreen.tsx
root: { flex: 1, backgroundColor: '#0b1020', paddingTop: 48, paddingHorizontal: 12 },
## src/host/StorageProbeScreen.tsx
root: { flex: 1, backgroundColor: '#0b1020', paddingTop: 48, paddingHorizontal: 12 },
```

## F9

- reconciled: live. `LauncherRoot.tsx:1719` is the only non-comment `__DEV__` in `src/host/launcher/` that isn't the sole argument of a gate call; the others are `LauncherRoot.tsx:370`, `:601` and `DevLogOverlay.tsx:56`.
- fix sketch: `onOpenDevProbe={devLogOverlayEnabled(__DEV__) ? () => setScreen({ kind: 'dev' }) : undefined}`. Add one case to `test/observability-ui.suite.ts` beside the overlay-gate case (`:274`): after stripping comments, every `__DEV__` in a non-test launcher source must match `/\w+\(__DEV__\)/`; name `file:line` otherwise. Make it non-vacuous in the suite with two inline sources: `gate(__DEV__)` passes, `__DEV__ ? a : b` fails.
- allowlist:
  ```
  src/host/launcher/LauncherRoot.tsx
  src/host/launcher/test/observability-ui.suite.ts
  ```
- test-class: invariant (decision #60(c) and `app-launcher` §"Production builds hide developer diagnostics surfaces": no diagnostics surface is gated on `__DEV__` alone)
- test: red at BASE on `src/host/launcher/LauncherRoot.tsx:1719`. `scripts/fixloop.sh redcheck <branch> src/host/launcher/test/observability-ui.suite.ts -- src/host/launcher/LauncherRoot.tsx` must exit 0.
- severity: low
- class-1 grant: none

### EVIDENCE

```
## src/host/launcher/LauncherRoot.tsx
onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
```
