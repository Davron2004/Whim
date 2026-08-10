## Why

The app swallows errors, so screens fail invisibly. Two root causes, both verified in
`research.md` §1:

1. **There is no React error boundary anywhere in `src/`** — zero matches repo-wide. A render throw
   in any launcher screen unmounts the whole tree, leaving a blank frame, with no log and no way
   back.
2. **There is no logger abstraction** — everything is raw `console.*`, and device `console` output
   reaches logcat only, where it truncates at ~4 KB. The server's `dev-log.ts` is two functions
   that prefix a string to stdout.

The consequence is a debugging loop that has no evidence in it. `LauncherRoot.tsx:244–273` shows a
native Alert on open/fork/delete failure and logs **nothing** — the user is told "Could not open
this app" and the reason exists nowhere afterwards. `useMiniAppHost.ts:115,167`, `teardown.ts:40`,
`device-acceptance.ts:180` and `synthrun/test/acceptance.ts:202,665` are silent best-effort
catches. The privacy floor that keeps prompt text, the device id and the API key out of logs is
written in doc comments and enforced by nothing.

The one screen whose entire job is to explain a failure — `FailureScreen.tsx` — imports no design
tokens and renders a plain bulleted `FlatList`. That is why the design rebuild is in this change
and not in the parallel design fix-loop: the diagnostic surface and the design spec are the same
screen.

## What Changes

- **Per-screen React error boundaries** on `react-error-boundary` v6.1.2, wrapping the launcher's
  screen-switch boundary so every screen — `HomeScreen`, `SettingsScreen`, `HistoryScreen`,
  `ComposeStep`, `ClarifyStep`, `PlanStep`, `BuildStep`, `DoneStep`, `FailureScreen` — is covered
  without editing each screen file. A caught throw reports through the logger and renders a
  recoverable error screen with a retry that remounts the subtree.
- **A device-side logging seam** at `src/host/logging/` on `react-native-logs` v5.6.0: levels,
  scoped channels, structured events, and a bounded in-memory ring buffer. The existing
  `[whim:gen]` / `[whim]` / `[whim:page]` string prefixes become **channels**. `logGenError`
  (`LauncherRoot.tsx:142–149`), `logMappedError` (`transport-shared.ts:117–132`) and every
  currently-silent catch in §2 of `research.md` migrate onto it.
- **Sink A — an in-app dev log overlay**: a hand-rolled `View`/`FlatList` reading the ring buffer,
  sited alongside the existing `DevProbeScreen` affordance (`LauncherRoot.tsx:568`), gated so it
  cannot reach a shipping build. No third-party overlay package is viable (`research.md` §6).
- **Sink B — a batched device→host POST** to a dev-only server endpoint that appends to a file,
  plus an `npm run whim:logs` tail. Transport is `adb reverse`, which is proven from a release APK
  (`research.md` §7).
- **The server adopts `pino` v10.3.1 + `pino-pretty` v13.1.3**, replacing `server/src/dev-log.ts`,
  and uses pino's `redact` to make the currently-convention-only rule — prompt text, device id and
  API key are never logged — a property of the serializer instead of a comment.
- **A lint tripwire** banning catch blocks that neither rethrow nor log, using the core
  `no-restricted-syntax` rule with an AST selector. No new plugin, no new dependency; exact
  precedent is the `.sort()`-without-comparator ban already in `.eslintrc.js`.
- **`FailureScreen.tsx` is rebuilt to design `3b`** (`whim-design-handoff/reference/Whim
  Mobile.dc.html:306–333`): a 26px screen title with a dynamic colour, an attempt-progress bar row,
  and a bordered 20px-radius panel of checklist rows each carrying a coloured ring/mark icon. The
  hardcoded literals at `MiniAppView.tsx:92–99` are resolved to tokens in the same pass.

## Capabilities

### New Capabilities

- `host-observability` — the device-side observability contract: every screen is inside a
  recoverable error boundary, every log record goes through one seam with named channels and a
  bounded ring buffer, sensitive fields are structurally unloggable, no error is swallowed
  silently, and both sinks read the same records.

### Modified Capabilities

- `app-launcher` — the developer-diagnostics requirement is extended to cover the new log overlay,
  and the mini-app container's launch-failure state stops carrying hardcoded style literals.
- `prompt-flow` — the honest-failure requirement gains the `3b` presentation (title, attempt
  progress, checklist panel) and an obligation to report the failure through the logger, while
  keeping the hint-only discipline unchanged.
- `generation-server` — the runtime dependency budget admits `pino`; request/run logging becomes
  structured and redacted; a dev-only, off-by-default log-sink route appends batched device
  records to a file.
- `generation-contract` — the shared log-envelope module is declared type-only, an explicit
  narrow exception to the package's zod-only rule, so the device never gains a reason to
  value-import from `@whim/contract`.

## Out of scope

- **Crash reporting / telemetry off-device.** No Sentry, no Crashlytics, no analytics. Sink B is a
  LAN dev sink reachable only over `adb reverse`, off by default, with no retention policy beyond
  a file the developer deletes.
- **Reactotron and Rozenite.** Both rejected on evidence (`research.md` §6); this change does not
  leave a seam for either.
- **Per-screen boundary placement inside each screen file.** The boundary goes at the
  screen-switch boundary precisely so `obs-v1` does not edit the screen files a parallel design
  fix-loop is holding.
- **Making `server/src/routes/generate.ts:97–101` non-fire-and-forget.** That `.catch(() => {})` is
  documented and intentional (the SSE response has already ended); it gains a log line and stays
  fire-and-forget. It is also not an AST `CatchClause`, so the lint tripwire never sees it.
- **A log level or channel filter persisted as a user setting.** The overlay filters in memory;
  nothing new is persisted.
- **Changing what `errorReason()` shows the user.** The scrubbing at `LauncherRoot.tsx:132–137`
  stays; the logger is what recovers the detail it scrubs.

## Impact

- **New**: `src/host/logging/**` (logger, channels, ring buffer, redaction, HTTP sink transport),
  `src/host/launcher/ScreenBoundary.tsx`, `src/host/launcher/ScreenErrorFallback.tsx`,
  `src/host/launcher/DevLogOverlay.tsx`, `contract/src/dev-log.ts`, `server/src/logger.ts`,
  `server/src/routes/dev-logs.ts`, `server/logs-tail.mjs`.
- **Modified (device)**: `LauncherRoot.tsx`, `transport-shared.ts`, `useMiniAppHost.ts`,
  `teardown.ts`, `FailureScreen.tsx`, `MiniAppView.tsx`, `copy.ts`,
  `src/host/bridge/device-acceptance.ts`.
- **Modified (server)**: `server/src/dev-log.ts` (deleted, replaced), `server/src/main.ts`,
  `server/test/**`.
- **Modified (protected, Class 1 — one batched human ratification)**: `package.json`
  (+`react-error-boundary`, +`react-native-logs`, +`whim:logs`), `package-lock.json`,
  `server/package.json` (+`pino`, +`pino-pretty`), `knip.json`, `.eslintrc.js`.
- **Tests**: new suites join the **existing** runners — `src/host/launcher/test/acceptance.ts`
  (launcher) and `server/test/run.mjs` (server). No agent adds an npm script.
- **Docs**: `docs/capabilities.md` gains the `host-observability` line; `docs/decisions.md` records
  the `adb reverse`-is-not-Metro-NAT correction and the type-only contract-module exception.
