# Context chains: collapse-shell-theme

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 120 lines.
-->

## chain-1: collapse-shell-theme

- tasks: 1.1–1.4, 2.1–2.3, 3.1–3.2
- rationale: one module constant, the 15 other files that imported the deleted context, the whole
  family of threaded-palette call sites (app-tile, tile-pill-view, HomeScreen, flow-chrome,
  FailureScreen, LauncherRoot, HistoryScreen), and the tripwire that keeps them collapsed are one
  change to one subsystem's plumbing, mechanically linked (a mid-migration state fails typecheck).
  Splitting across chains would force a second worktree to touch files the first is still editing.
- files: `src/host/launcher/theme.ts`, `src/host/launcher/theme-context.tsx` (deleted),
  `src/host/launcher/app-tile.tsx`, `src/host/launcher/tile-pill-view.tsx`,
  `src/host/launcher/HomeScreen.tsx`, `src/host/launcher/flow-chrome.tsx`,
  `src/host/launcher/FailureScreen.tsx`, `src/host/launcher/LauncherRoot.tsx`,
  `src/host/launcher/HistoryScreen.tsx`, every other `theme-context` consumer under
  `src/host/launcher/`, `src/host/launcher/test/theme.suite.ts`,
  `src/host/launcher/test/failure-screen.suite.ts`,
  `src/host/launcher/test/observability-ui.suite.ts`, `src/host/launcher/test/run-timeline.suite.ts`,
  `src/host/launcher/test/prompt-flow-screens.suite.ts`
- reads: `specs/app-launcher/spec.md` §"The shell palette is a module constant, never a parameter"
  (ADDED); `research.md`; `design.md` D1–D5; handoff: none
- writes-contract: none (last chain in the change)
