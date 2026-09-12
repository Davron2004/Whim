## 1. Module constant and consumer migration

- [x] 1.1 Replace `shellPalette(theme)` in `theme.ts` with a `SHELL_PALETTE: ShellPalette` module
      constant derived once from `DEFAULT_THEME`; delete the function — test:
      `src/host/launcher/test/theme.suite.ts` (`npm run launcher:test`); gate: `./scripts/gate.sh`
- [x] 1.2 Delete `theme-context.tsx`; migrate the 15 other files that imported it to import
      `SHELL_PALETTE` (or `DEFAULT_THEME` where the full theme, not the derived palette, is what's
      used) directly from `theme.ts` / `../../sdk/theme` — test: `npm run launcher:test`; gate:
      `./scripts/gate.sh`
- [x] 1.3 Remove every palette prop/parameter: `app-tile.tsx`'s `pill.palette`,
      `tile-pill-view.tsx`'s `TilePillProps.palette`, `HomeScreen.tsx`'s `GhostActionRow` palette
      prop, `flow-chrome.tsx`'s `FlowHeaderProps`/`PrimaryActionProps`/`EditingEyebrowProps.palette`,
      `FailureScreen.tsx`'s `segmentColor`/`rowIcon` palette parameters, `LauncherRoot.tsx`'s
      `DevLogTools({ palette })`, and `HistoryScreen.tsx`'s `HistoryRowView`/`ActionButton`/
      `ConfirmBody`/`HistoryLoadingRows` palette parameters; each site reads `SHELL_PALETTE`
      directly. `MiniAppView.tsx`'s `theme: WhimTheme` prop is untouched (mini-app delivery, not
      shell rendering) — test: `npm run launcher:test`; gate: `./scripts/gate.sh`
- [x] 1.4 Remove the app-tile doc comment that justifies the (now-deleted) `palette` prop by appeal
      to "a future theme picker" — test: none (doc-only); gate: `./scripts/gate.sh`

## 2. Suite assertions and the tripwire

- [x] 2.1 Flip the `shellPalette(theme)` regex assertions in
      `src/host/launcher/test/failure-screen.suite.ts`,
      `src/host/launcher/test/observability-ui.suite.ts`,
      `src/host/launcher/test/run-timeline.suite.ts`, and the `palette`-prop regex in
      `src/host/launcher/test/prompt-flow-screens.suite.ts` to assert `SHELL_PALETTE` usage
      instead — test: `npm run launcher:test`; gate: `./scripts/gate.sh`
- [x] 2.2 Add a tripwire to `src/host/launcher/test/theme.suite.ts` scanning
      `src/host/launcher/**/*.ts(x)` (excluding `test/`) that fails, naming the offending file, on
      the phrase "theme picker", `useTheme`, `ThemeProvider`, `ThemePref`, `shellPalette(`, or the
      identifier `ShellPalette` named anywhere outside `theme.ts` (not just typed onto a prop or
      param — `theme.ts` is the only file allowed to name it at all, in its interface declaration
      and the constant's own annotation); include a non-vacuity assertion that the walk reaches
      `LauncherRoot.tsx` and `HomeScreen.tsx` — test: `npm run launcher:test`; gate:
      `./scripts/gate.sh`
- [x] 2.3 Red-check the tripwire: reintroduce a `palette: ShellPalette` prop on a component outside
      `theme.ts`, confirm 2.2's test fails naming that file, then restore — test:
      `npm run launcher:test`; gate: `./scripts/gate.sh`

## 3. Close-out

- [x] 3.1 Confirm no rendered value changed: every screen's palette values before and after this
      change trace back to the same `DEFAULT_THEME` — test: `npm run launcher:test` (existing
      color-mapping assertions); gate: `./scripts/gate.sh`
- [x] 3.2 Full gate before hand-off: `./scripts/gate-full.sh`
