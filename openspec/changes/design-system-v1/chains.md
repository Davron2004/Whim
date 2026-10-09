# Context chains: design-system-v1

Every chain reads `docs/design/system.md` (the sections named in its block) as its design spec; the delta
specs say what must be true, `system.md` gives the values. Values are never copied out of `system.md` by hand:
from chain-1 on they come from `src/design/tokens.ts`.

**HUMAN-BOOTSTRAP chains** edit `CONFIG_SET` files (`package.json`, the lockfile, `babel.config.js`, `build/*`,
the Podfile and its lock): chain-1, chain-7 and chain-8. For each, the listed config edit is committed into
the chain's base first (a human applies or approves it), then the chain self-gates with the unmodified
`scripts/gate.sh`. No chain edits `invariants/`, gate scripts, `.claude/**`, tsconfig, eslint or knip config.

**Shared-file rules.** `checks/test/acceptance.ts` is edited only by chain-1 (it registers
`checks/test/repo/design-system.suite.ts`; later design checks go inside that suite). `fixtures/style-gallery.app.tsx`
and `src/sdk/index.tsx` belong to the SDK track (3 → 4 → 5 → 6). `LauncherRoot.tsx` and `copy.ts` belong to
the shell line (14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22). `MainApplication.kt` and the Xcode project
belong to the native track (7 → 8 → 9).

Dependency graph:
- chain-1 and chain-2 run first, in parallel.
- SDK track: chain-1 → chain-3; chain-2 + chain-3 → chain-4 → chain-5 → chain-6.
- Native track: chain-1 + chain-2 → chain-7 → chain-8 → chain-9.
- Shell primitives: chain-3 + chain-8 → chain-10 → chain-11.
- Host logic and server, parallel with the tracks above: chain-1 + chain-2 → chain-12; chain-1 + chain-2 → chain-13.
- Shell line: chain-9 + chain-11 → chain-14 → chain-15 (also after chain-12) → chain-16 → chain-17 → chain-18
  → chain-19 → chain-20 → chain-21 (also after chain-6) → chain-22.
- chain-23 after chain-6 and chain-13. chain-24 after everything.

## chain-1: design-tokens — HUMAN-BOOTSTRAP

- tasks: 1.1–1.5
- rationale: the one source of values, its generator and drift check, and the runtime page that must paint from it; all pure data plus the build script.
- files: new `src/design/tokens.ts`, `src/design/tints.ts`, `src/design/generated/springs.ts`; new `scripts/design-tokens.mjs`; `docs/design/system.md` (marked tables), `docs/design/mockups/index.html` (token block), `docs/design/system-v1/palette.json`, `docs/design/system-v1/palette-check.py`; new `checks/test/repo/design-system.suite.ts`, `checks/test/acceptance.ts` (one registration line); new `src/sdk/test/tints.acceptance.ts`; `build/assemble.mjs` and its regenerated outputs; the desktop delivery suite
- bootstrap edits (commit first): `package.json` `scripts.tokens`; `build/assemble.mjs` (bg per scheme, `color-scheme`, no `maximum-scale`, GEN stamp on forwarded `paint`)
- reads: specs/sdk-design-system/spec.md §"One token module is the single source of design values", §"Colour roles exist in light and dark with reserved status hues", §"Ten named app tints with a proven palette"; specs/sandbox-rendering/spec.md (both requirements); `system.md` §2, §4.2; design.md D1, D4; research.md §Relevant files (assemble.mjs lines); handoff: none
- writes-contract: handoff/design-tokens.md (module export names and shapes, `tints.ts` API, generated file paths and marker syntax, the `--check` CLI, the GEN-stamped `paint` payload shape)

## chain-2: icons

- tasks: 2.1–2.4
- rationale: vendoring and resolving icon names is self-contained data plus a resolver, shared later by SDK, shell, server.
- files: new `scripts/vendor-icons.mjs`, `src/design/icons/{paths.ts,names.ts,ember.ts,squircle.ts,LICENSE}`, new `src/sdk/test/icons.acceptance.ts`
- reads: specs/sdk-design-system/spec.md §"An app names its tint and glyph, and every name resolves", §"One vendored icon set draws every icon"; `system.md` §3.1, §3.3; design.md D14; handoff: none
- writes-contract: handoff/icons.md (`GLYPH_NAMES`, `CHROME_NAMES`, `resolveIcon`/`resolveGlyph` signatures and diagnostic shape, path data format, ember and squircle exports)

## chain-3: sdk-theme

- tasks: 3.1–3.5
- rationale: the SDK side of the theme frame and token resolution, one layer (`src/sdk/theme.ts`, `tokens.ts`) and its tests.
- files: `src/sdk/{theme.ts,tokens.ts,index.tsx}`, `src/host/launcher/theme.ts` (pin only), `src/sdk/test/{theme.acceptance.ts,screen-inset.acceptance.tsx}`, `fixtures/style-gallery.app.tsx`
- reads: specs/sdk-design-system/spec.md §"Components resolve semantic tokens through the active theme", §"The host-supplied theme is inert, sanitized data", §"SDK components follow the system's defaults"; `system.md` §2.5, §2.7; design.md D3; research.md §Current behavior (theme frame); handoff: handoff/design-tokens.md
- writes-contract: handoff/sdk-theme.md (`WhimTheme` fields and defaults, resolver names, how `fontScale`/`increaseContrast` apply)

## chain-4: sdk-components-new

- tasks: 4.1–4.6
- rationale: the SDK additions share `index.tsx`, the surfaces files and the gallery.
- files: `src/sdk/{index.tsx,controls.tsx,surfaces.tsx,navigation.tsx}`, new `src/sdk/icon.tsx`, `src/sdk/toast.tsx`, `src/sdk/test/*` (new suites), `fixtures/style-gallery.app.tsx`
- reads: specs/sdk-design-system/spec.md §"The SDK adds components and deprecates without removing", §"The component kit renders under the unchanged containment contract", §"The style gallery shows every component and variant"; `system.md` §7.2; handoff: handoff/sdk-theme.md, handoff/icons.md
- writes-contract: handoff/sdk-components.md (new component props verbatim, `toast` API, `Screen` header behaviour)
- after: chain-3 (shared `index.tsx` and gallery)

## chain-5: sdk-components-restyle

- tasks: 5.1–5.6
- rationale: restyling every existing component and keyed lists touches the same SDK files and gallery as chain-4.
- files: `src/sdk/{index.tsx,controls.tsx,surfaces.tsx,charts.tsx}`, `src/sdk/test/*`, `fixtures/style-gallery.app.tsx`, `checks/test/repo/design-system.suite.ts` (gallery coverage)
- reads: specs/sdk-design-system/spec.md §"SDK components follow the system's defaults", §"Keyed lists animate and unkeyed lists stay still", §"The style gallery shows every component and variant"; `system.md` §7.2, §6; handoff: handoff/sdk-components.md
- writes-contract: handoff/sdk-surface.md (final export list with props, deprecations, keyed-list API and the no-motion flag)
- after: chain-4

## chain-6: sdk-motion

- tasks: 6.1–6.6
- rationale: all in-app motion shares the spring helpers and the same components.
- files: new `src/sdk/motion.ts`, `src/sdk/{index.tsx,controls.tsx,surfaces.tsx,navigation.tsx,toast.tsx}`, new desktop suite in `src/sdk/test/`, `fixtures/style-gallery.app.tsx`, `openspec/changes/design-system-v1/invariant-proposal.md`
- reads: specs/sdk-design-system/spec.md §"SDK motion uses the shell's springs and honours Reduce Motion", §"Keyed lists animate and unkeyed lists stay still", §"SDK controls emit no haptics"; `system.md` §4.1–4.5 (M24); design.md D10; handoff: handoff/design-tokens.md, handoff/sdk-surface.md
- writes-contract: none
- after: chain-5

## chain-7: native-deps — HUMAN-BOOTSTRAP

- tasks: 7.1–7.4
- rationale: one place adds, pins and proves the new native dependencies on both platforms before any UI uses them.
- files: `App.tsx`, new `src/host/ui/Icon.tsx`, `ios/Podfile.lock` (pods only), any Gradle setting a dependency requires
- bootstrap edits (commit first): `package.json` and `package-lock.json` (six exact pins), `babel.config.js` (worklets plugin)
- reads: design.md D6, D9; `docs/research/animation-options-2026-09.md` (versions); research.md §Constraints (CONFIG_SET, network-deny suite); handoff: handoff/icons.md
- writes-contract: handoff/native-deps.md (pinned versions, root wrappers, the `Icon` primitive's props, build notes)
- after: chain-1 (both edit `package.json`), chain-2

## chain-8: haptics — HUMAN-BOOTSTRAP

- tasks: 8.1–8.5
- rationale: the TurboModule on both platforms, its JS map and its one consumer (`cue-backend.ts`) share one vocabulary.
- files: new `src/native/NativeWhimHaptics.ts`, new `android/app/src/main/java/com/whim/haptics/*`, `MainApplication.kt`, new `ios/Whim/WhimHapticsModule.mm`, the Xcode project, new `src/host/haptics.ts`, `src/host/cue-backend.ts`, `src/host/bridge/test/acceptance.ts`, `src/host/launcher/test/native-host.tsx`
- bootstrap edits (commit first): `package.json` `codegenConfig` (register `WhimHaptics`)
- reads: specs/mini-app-cues/spec.md (both); specs/app-launcher/spec.md §"The shell plays haptics from a fixed map"; `system.md` §5; design.md D11; research.md §Relevant files (WhimTone pattern, cue backend); handoff: handoff/native-deps.md
- writes-contract: handoff/haptics.md (`haptics.ts` moment names, native API, rate-cap constants)
- after: chain-7

## chain-9: platform-theming

- tasks: 9.1–9.5
- rationale: native dark mode, launch screens, icon and font retirement are all platform resources and release tooling.
- files: `MainApplication.kt`, `android/app/src/main/res/**`, `android/app/src/main/assets/fonts/` (delete), `assets/fonts/` (delete), `ios/Whim/` launch storyboard and asset catalog, the Xcode project, `release/assets/**`, `scripts/release/lib/assets.ts`, `checks/test/release/assets.suite.ts`, `checks/test/repo/android-accent.suite.ts`, `src/sdk/design-tokens.ts` (`TYPE_SCALE` faces only), `src/host/launcher/test/android-fonts.suite.tsx` (delete)
- reads: specs/app-icon-and-launch/spec.md (all); specs/sdk-design-system/spec.md §"The system font carries the whole type system"; `system.md` §2.7, §3.3; design.md D12, D13; handoff: handoff/design-tokens.md, handoff/icons.md
- writes-contract: handoff/platform.md (`hideLaunchScreen()` API, night resources, brand.json keys)
- after: chain-8 (both edit `MainApplication.kt` and the Xcode project)

## chain-10: shell-primitives-base

- tasks: 10.1–10.5
- rationale: the scheme hook and the small primitives every screen uses, in a new `src/host/ui/` layer.
- files: new `src/host/ui/{tokens.ts,tokens-pure.ts,Text.tsx,Button.tsx,IconButton.tsx,Chip.tsx,Notice.tsx,Skeleton.tsx,Ember.tsx}`, `src/host/launcher/theme.ts`, new suites under `src/host/launcher/test/`
- reads: specs/app-launcher/spec.md §"The shell follows the phone's appearance through one scheme hook", §"Shell motion runs on Reanimated with the named springs"; `system.md` §1, §2, §3.3, §6, §7.1 (Button, Icon button, Chip, Notice, Skeleton, Ember); design.md D2; handoff: handoff/design-tokens.md, handoff/icons.md, handoff/native-deps.md, handoff/haptics.md, handoff/sdk-theme.md
- writes-contract: handoff/shell-ui.md (hook and `makeStyles` API, each primitive's props verbatim)
- after: chain-3 (`launcher/theme.ts`), chain-8 (`native-host.tsx`, haptics)

## chain-11: shell-primitives-surfaces

- tasks: 11.1–11.5
- rationale: the gesture-driven containers and keyboard handling share Gesture Handler, Reanimated and keyboard-controller code.
- files: new `src/host/ui/{Sheet.tsx,ConfirmSheet.tsx,ContextMenu.tsx,Toast.tsx,TextField.tsx,GroupedList.tsx,AppTile-geometry.ts}`, `src/host/launcher/KeyboardShell.tsx`, `keyboard-shell.ts`, new suites
- reads: specs/app-launcher/spec.md §"Tile menus follow the tile's state" (menu mechanics), §"Shell motion runs on Reanimated with the named springs"; `system.md` §4.3, §6, §7.1 (Sheet, Confirm sheet, Context menu, Toast, Text field, Grouped list); handoff: handoff/shell-ui.md
- writes-contract: handoff/shell-surfaces.md (Sheet, ConfirmSheet, ContextMenu, Toast host, TextField and GroupedList APIs)
- after: chain-10

## chain-12: tile-identity

- tasks: 12.1–12.5
- rationale: host-side tint assignment, record fields and purge markers are launcher logic with Node tests, no UI.
- files: `src/host/launcher/{tiles.ts,build-lifecycle.ts,app-index.ts,store-access.ts,seed*.ts}`, new `src/host/launcher/tile-identity.ts`, `src/host/launcher/test/{tile-colour,build-lifecycle,store-access}.suite.ts`
- reads: specs/app-launcher/spec.md §"The host assigns each app's tint", §"Customize tile changes an app's tint and glyph", §"Deleting an app leaves no residue", §"Forking creates an independent launcher entry"; `system.md` §2.4, §3.2; design.md D5, D8, D16; research.md §Constraints (`StoreAccess.update`); handoff: handoff/design-tokens.md, handoff/icons.md
- writes-contract: handoff/tile-identity.md (record fields, assignment API, override and purge-marker APIs)
- after: chain-1, chain-2

## chain-13: generator-server

- tasks: 13.1–13.5
- rationale: extraction, prompts and evals of the generation server, one workspace and its suites.
- files: `checks/passes/manifest-extraction.ts`, `checks/contract.ts`, `server/src/generation/stages/check.ts`, `server/src/generation/prompts/*`, `contract/src/index.ts` (comment only), `server/test/*`, eval corpus files
- reads: specs/generation-pipeline/spec.md (all); specs/generation-contract/spec.md (all); `system.md` §3.1–3.2, §8; design.md D5, D15; research.md §Relevant files (prompts, check stage); handoff: handoff/design-tokens.md, handoff/icons.md
- writes-contract: handoff/generator.md (manifest field shapes, diagnostic kinds, prompt sections changed)
- after: chain-1, chain-2

## chain-14: shell-navigation

- tasks: 14.1–14.6
- rationale: the native stack and the screens that move onto it share `LauncherRoot`'s machine and the exit table.
- files: `src/host/launcher/{LauncherRoot.tsx,screen-exits.ts,SettingsScreen.tsx,settings-sections.ts,ConsentScreen.tsx,ReportSheet.tsx→ReportScreen.tsx,copy.ts}`, new `src/host/launcher/{NativeStack.tsx,AdvancedScreen.tsx}`, `AndroidManifest.xml`, the related suites
- reads: specs/launcher-screen-exits/spec.md (all); specs/app-launcher/spec.md §"Settings puts common settings first and diagnostics under Advanced"; specs/privacy-settings/spec.md; specs/content-reporting/spec.md; `system.md` §9 (Settings, Advanced, Report); design.md D6, D7; handoff: handoff/shell-surfaces.md, handoff/platform.md
- writes-contract: handoff/navigation.md (stack entries, how a screen is pushed and popped, exit-table additions)
- after: chain-9, chain-11

## chain-15: home

- tasks: 15.1–15.6
- rationale: the home grid, tiles, menus, delete and customize share `HomeScreen.tsx` and the tile component.
- files: `src/host/launcher/{HomeScreen.tsx,app-tile.tsx,tile-pill*.ts,LauncherRoot.tsx,copy.ts}`, new `src/host/launcher/{CustomizeTileSheet.tsx}`, `src/host/ui/AppTile.tsx`, home suites
- reads: specs/app-launcher/spec.md §"A tile is a tinted squircle with one glyph", §"Tiles show their state", §"Tile menus follow the tile's state", §"The home grid orders and lays out apps for every text size", §"The home screen shows a live offline notice", §"Deleting an app leaves no residue", §"Forking creates an independent launcher entry", §"Customize tile changes an app's tint and glyph"; `system.md` §3.2, §9 (Your apps, Delete); handoff: handoff/tile-identity.md, handoff/navigation.md, handoff/shell-surfaces.md
- writes-contract: handoff/home.md (tile state model, toast and purge wiring)
- after: chain-12, chain-14

## chain-16: making-describe-plan

- tasks: 16.1–16.6
- rationale: the sheet's page machine and its first two pages share `prompt-flow.ts` and the flow components.
- files: `src/host/launcher/{prompt-flow.ts,LauncherRoot.tsx,ComposeStep.tsx,ClarifyStep.tsx,PlanStep.tsx,ConsentScreen.tsx,TermsScreen.tsx,copy.ts}`, new `src/host/launcher/{MakingSheet.tsx,DescribePage.tsx,PlanPage.tsx,FirstRunSheet.tsx}`, flow suites
- reads: specs/prompt-flow/spec.md §"The making flow is one sheet with four pages", §"The plan page shows the questions and the plan together", §"The plan page is the approval gate before making", §"Leaving the making sheet keeps the run and the draft"; `system.md` §7.1 (Question row, Plan row), §9 (First run, Describe, Plan, Can't make as asked); design.md D15; handoff: handoff/home.md, handoff/shell-surfaces.md
- writes-contract: handoff/making-sheet.md (page machine, draft store, how a run is keyed)
- after: chain-15

## chain-17: making-progress

- tasks: 17.1–17.5
- rationale: the run's later pages share the stream model and the failure taxonomy.
- files: `src/host/launcher/{BuildStep.tsx→MakingPage.tsx,DoneStep.tsx→ReadyPage.tsx,FailureScreen.tsx→FailurePage.tsx,RunTimeline.tsx,flow-working.tsx,prompt-flow.ts,copy.ts,LauncherRoot.tsx}`, suites
- reads: specs/prompt-flow/spec.md §"The Making page shows honest progress without internals", §"The Ready page opens the app or returns home", §"Failure is shown by kind, honestly, never as a crash", §"Details of a run are reachable from its tile and its failure"; `system.md` §7.1 (Status line, Step list), §8 (time lines, failure kinds), §9 (Making, Ready, Didn't work); handoff: handoff/making-sheet.md
- writes-contract: handoff/making-progress.md (stream-activity signal shape for the ember)
- after: chain-16

## chain-18: opening

- tasks: 18.1–18.4
- rationale: theme delivery, the opening signal and the WebView pool live in the app container.
- files: `src/host/launcher/{MiniAppView.tsx,useMiniAppHost.ts,boot-state.ts,deliver.ts,LauncherRoot.tsx}`, new `src/host/launcher/webview-pool.ts`, `mini-app-host-ui` and boot-state suites, the desktop delivery suite
- reads: specs/app-launcher/spec.md §"A launched app receives the theme for the phone's settings at that moment", §"Opening an app grows out of its tile and waits for the realm's paint"; specs/sandbox-rendering/spec.md §"The host can tell which launch a paint belongs to"; design.md D3, D4; research.md §Current behavior (paint, nav-depth); handoff: handoff/design-tokens.md, handoff/shell-ui.md, handoff/making-progress.md
- writes-contract: handoff/opening.md (opening-signal API, pool lifecycle, measured tap-to-first-paint)
- after: chain-17

## chain-19: running-app

- tasks: 19.1–19.5
- rationale: the orb, the Whim sheet, change handling and the crash screen all sit over a running app in `MiniAppView`.
- files: `src/host/launcher/{Orb.tsx,orb-actions.ts,orb-geometry.ts,MiniAppView.tsx,LauncherRoot.tsx,copy.ts}`, new `src/host/launcher/WhimSheet.tsx`, suites
- reads: specs/app-launcher/spec.md §"The orb is an opaque, draggable disc that opens the Whim sheet", §"The Whim sheet is a running app's one menu", §"Changing an app keeps it running and offers Reload", §"A crashed app keeps the orb and offers a way forward"; `system.md` §7.1 (Orb), §9 (Whim sheet, Changing in use, App crashed); handoff: handoff/opening.md, handoff/making-sheet.md, handoff/navigation.md
- writes-contract: none
- after: chain-18

## chain-20: history

- tasks: 20.1–20.4
- rationale: one screen and its logic module.
- files: `src/host/launcher/{HistoryScreen.tsx,history-logic.ts,history-wait.ts,ConfirmSheet.tsx (History use removed),LauncherRoot.tsx,copy.ts}`, history suites
- reads: specs/version-history/spec.md (all ADDED); `system.md` §7.1 (Timeline row), §9 (History); handoff: handoff/navigation.md, handoff/home.md
- writes-contract: none
- after: chain-19

## chain-21: copy-and-cleanup

- tasks: 21.1–21.5
- rationale: the glossary sweep, copy lint, Whim Syntax and deleting the retired components touch every screen's strings and imports, so they come last in the line.
- files: `src/host/launcher/copy.ts`, every launcher screen (string keys and imports only), `src/host/ui/whim-prose/*`, `src/host/launcher/highlighting.ts` (delete), retired components (delete), `src/sdk/design-tokens.ts`, `checks/test/repo/design-system.suite.ts`, copy suites
- reads: specs/app-launcher/spec.md §"Shell copy has one name per concept and controls speak as the person", §"Shell prose renders through one Whim Syntax renderer with simplified channels"; `system.md` §2.7 (Whim Syntax), §8; design.md D17; handoff: every earlier shell contract
- writes-contract: none
- after: chain-20, chain-6 (both edit `checks/test/repo/design-system.suite.ts` after chain-5)

## chain-22: shell-motion

- tasks: 22.1–22.5
- rationale: container transforms and honest light span several screens but share one motion vocabulary and the Ember.
- files: `src/host/ui/{Ember.tsx,motion.ts}`, `MiniAppView.tsx`, `HomeScreen.tsx`, `MakingSheet.tsx`, `ReadyPage.tsx`, `HistoryScreen.tsx`, `Orb.tsx`, `checks/test/repo/design-system.suite.ts`, motion suites
- reads: specs/app-launcher/spec.md §"Shell motion runs on Reanimated with the named springs", §"Opening an app grows out of its tile and waits for the realm's paint"; `system.md` §4; design.md D9; handoff: handoff/opening.md, handoff/making-progress.md, handoff/home.md
- writes-contract: none
- after: chain-21

## chain-23: generator-reference

- tasks: 23.1–23.4
- rationale: the generator's reference and few-shot must describe the final SDK, so it follows the SDK track and the server chain.
- files: `docs/sdk-reference.md`, `fixtures/tip-splitter.app.tsx`, `fixtures/water-counter.app.tsx`, new exemplar fixtures, `server/test/{prompts,prod-build}.suite.ts`, `docs/capabilities.md`
- reads: specs/generation-pipeline/spec.md §"The generator learns tiles and defaults from the reference, not from layout rules"; specs/sdk-design-system/spec.md §"The SDK adds components and deprecates without removing"; `system.md` §3.1, §7.2; handoff: handoff/sdk-surface.md, handoff/generator.md
- writes-contract: none
- after: chain-6, chain-13

## chain-24: verification (attended)

- tasks: 24.1–24.7
- rationale: device checks on both platforms need a person and the finished build; nothing here is dispatchable to an implementer.
- files: evidence outside the repo; results recorded in `openspec/changes/design-system-v1/verification.md` and decision #75's status tag
- reads: design.md §Verification plan; `system.md` §6; every handoff
- writes-contract: none
- after: chain-22, chain-23
