## Why

`shell-redesign-v2` (#59) cut the launcher's theme picker — six presets, ten accents, three corner
shapes, the persisted `ThemePref` — and adopted one fixed v2 token set. But the cut only removed the
picker's user-facing surface. Its code shape survived: `theme-context.tsx`'s `ThemeProvider`/
`useTheme()` still hand every screen a `{ theme }` that could in principle vary, `shellPalette`
still takes a theme as a parameter, and a whole family of other sites — an app-tile pill prop,
`GhostActionRow`, three `flow-chrome.tsx` prop types, two `FailureScreen.tsx` helpers,
`LauncherRoot.tsx`'s `DevLogTools`, and four `HistoryScreen.tsx` components — thread a
`ShellPalette` through as an explicit value even though there is only one value it can ever be. The
doc comment on the newest of these (`app-tile.tsx`'s `pill` prop) says the palette prop "keeps a
future theme picker from leaving the pill on a stale default" — which is the drift mechanism
written down: an agent reading `useTheme()` plus `shellPalette(theme)` has every reason to infer
themes vary, and to keep threading the pattern through whatever it builds next. Four suites even
lock the wrong direction, asserting each screen calls `shellPalette(theme)` (or, in one case,
matches a `palette` prop directly) rather than that the palette is one constant.

## What Changes

- `theme.ts` gains a `SHELL_PALETTE` module constant (`ShellPalette` derived once, from the fixed
  v2 theme) in place of the `shellPalette(theme)` function.
- `theme-context.tsx` is deleted. The 15 other files that imported it now import `SHELL_PALETTE`
  (or `DEFAULT_THEME`, where a full theme rather than the derived palette is what's needed)
  directly.
- Every palette prop/argument is removed: `app-tile.tsx`'s `pill.palette`, `tile-pill-view.tsx`'s
  `TilePillProps.palette`, `HomeScreen.tsx`'s `GhostActionRow` palette prop, `flow-chrome.tsx`'s
  three prop types, `FailureScreen.tsx`'s two helper parameters, `LauncherRoot.tsx`'s
  `DevLogTools({ palette })`, and `HistoryScreen.tsx`'s `HistoryRowView`/`ActionButton`/
  `ConfirmBody`/`HistoryLoadingRows` palette parameters. Each site reads `SHELL_PALETTE` where it
  used to receive a palette. `MiniAppView.tsx`'s `theme: WhimTheme` prop is untouched — it forwards
  the fixed theme opaquely into mini-app delivery, a separate, still-required contract.
- The four suites (`failure-screen`, `observability-ui`, `run-timeline`, `prompt-flow-screens`)
  that regex-asserted `shellPalette(theme)` (or a `palette` prop) per screen are flipped to assert
  `SHELL_PALETTE` usage instead.
- `theme.suite.ts` gains a source-scan tripwire over `src/host/launcher/**/*.ts(x)` (excluding
  `test/`) that fails, naming the offending file, on any of: the phrase "theme picker", `useTheme`,
  `ThemeProvider`, `ThemePref`, `shellPalette(`, or the identifier `ShellPalette` named anywhere
  outside `theme.ts` itself (not only as a prop/param type — `theme.ts` is the only file allowed to
  name it at all, in its interface declaration and the constant's own annotation), with a
  non-vacuity assertion that the walk reaches `LauncherRoot.tsx` and `HomeScreen.tsx`. Red-checked
  against a `palette: ShellPalette` prop reintroduced on a component.
- The app-tile doc comment that names "a future theme picker" as the reason for a palette prop is
  removed along with the prop it was justifying.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `app-launcher`: the shell palette becomes a module constant; no launcher component, hook,
  context, or helper may accept a theme or palette as a prop, argument, or context value except the
  fixed theme forwarded opaquely into mini-app delivery, and no launcher source may name a theme
  picker or theme preference.

## Impact

- Launcher: `src/host/launcher/theme.ts`, `src/host/launcher/theme-context.tsx` (deleted),
  `src/host/launcher/app-tile.tsx`, `src/host/launcher/tile-pill-view.tsx`,
  `src/host/launcher/HomeScreen.tsx`, `src/host/launcher/flow-chrome.tsx`,
  `src/host/launcher/FailureScreen.tsx`, `src/host/launcher/LauncherRoot.tsx`,
  `src/host/launcher/HistoryScreen.tsx`, and every other file importing `theme-context` (15 other
  files, plus the deleted file itself, per `research.md`).
- Tests: `src/host/launcher/test/theme.suite.ts` (new tripwire),
  `src/host/launcher/test/failure-screen.suite.ts`,
  `src/host/launcher/test/observability-ui.suite.ts`,
  `src/host/launcher/test/run-timeline.suite.ts`,
  `src/host/launcher/test/prompt-flow-screens.suite.ts` (flipped assertions).
- Untouched: mini-app delivery theme (`__whimHostInit`, `openspec/specs/app-launcher/spec.md`
  "A launched mini-app receives the active theme at delivery", forwarded through
  `MiniAppView.tsx`'s `theme: WhimTheme` prop), `sanitizeTheme`, `appColor`, `__WHIM_THEME__`, and
  the tile-colour system. Historical mentions in `docs/design/README.md:234`,
  `docs/design/reference/Whim Mobile.dc.html:611`, and
  `openspec/changes/archive/2026-08-11-shell-redesign-v2/tasks.md:64` are left alone.
- No wire change, no schema change, no user-visible behaviour change — the rendered palette values
  are identical before and after, because every call site already resolved to `DEFAULT_THEME`.
