# Research digest: what launcher terrain would store-launch compliance (AI-data consent, content reports, refusal UX, release config, app links) attach to?

<!-- Compiled from two researcher digests run this cycle against main (cb6f413) — "launcher-shell
surfaces" (A) and "generation error surfaces" (B) — plus a short planner spot-check section (C) for
facts verified directly or taken from the staging branch `integration/store-launch`. -->

## Relevant files
- `src/host/launcher/LauncherRoot.tsx` — `Screen` union + all host wiring; owns every network call site (A, B)
- `src/host/launcher/SettingsScreen.tsx` — the one settings surface; self-owned hardware back (A)
- `src/host/launcher/server-address.ts`, `device-id.ts` — KV-backed settings precedent (A)
- `src/host/launcher/HomeScreen.tsx` — tile long-press action sheet (Open/Fork/History/Prompt again/Delete) (A)
- `src/host/launcher/MiniAppView.tsx`, `Orb.tsx`, `orb-actions.ts`, `back-policy.ts` — mini-app host, in-app menu, guaranteed exit (A)
- `src/host/launcher/HistoryScreen.tsx`, `RunDetailsSheet.tsx` — the two existing sheet idioms (A)
- `src/host/launcher/copy.ts`, `test/product-verbs.suite.ts`, `theme.ts` — copy table, vocabulary guard, `SHELL_PALETTE` (A)
- `src/host/launcher/app-index.ts` — `AppIndex.get(id): InstalledApp | null` (A)
- `src/host/launcher/test/run.mjs` + `test/acceptance.ts` — Node-suite runner; manual import list (A)
- `src/host/launcher/prompt-flow.ts` — pure five-step machine; `isClarifySkip` (502 only) (B)
- `src/host/launcher/generation-client.ts`, `transport-shared.ts`, `xhr-transport.ts` — clients, `GenerationClientError`, `httpErrorFrom` (B)
- `src/host/launcher/generation-request.ts` — `buildGenerateRequest` / `buildRewriteAppContext` (B)
- `src/host/launcher/pending-builds.ts`, `build-lifecycle.ts` — pending record, `startPendingBuild`, `freshAppId` (B, C)
- `src/host/launcher/store-access.ts:216,234` — `activeSource` / `activeDescription` (B)
- `src/host/launcher/DoneStep.tsx`, `FailureScreen.tsx` — result step and failure screen (B)
- `contract/src/index.ts:113-177,257-275` — request schemas, `ApiError`, `DeviceIdError` (B)

## Current behavior
- **Screen model (A).** `Screen` is a discriminated union (`home | app | dev | settings | history | …FlowScreen | failure`) in one `useState` (`LauncherRoot.tsx:102-137,318`); no navigation library. Settings is entered from Home's `onSettings` (`:1220`) and compose's `onOpenSettings` (`:1134`); `goHome` (`:490`) is the exit, called by `SettingsScreen`'s own `BackHandler` (`SettingsScreen.tsx:40-46`). History and DevProbe follow the same self-owned-back pattern. First-run: one mount effect demotes building records, seeds, refreshes, then `setReady(true)`; a `HomeGridSkeleton` renders until ready (`:412-428,1078-1088`). `ScreenBoundary`, keyed by `screen.kind`, wraps only the screen-switch `content` (`:1229-1241`).
- **Sheets (A).** No shared primitive. `RunDetailsSheet.tsx` is an always-mounted Animated bottom sheet (scrim, `MOTION.sheetRise`, 72% height cap; caller owns back). `HistoryScreen.tsx:300-316,535-545` is a `Modal` confirm sheet with the safe option as the full-width 56px button.
- **Per-app actions (A).** Tile long-press opens an action-sheet `Modal` (`HomeScreen.tsx:7,13,163,175`). The in-app `Orb` menu carries `change/home/versions` only (`orb-actions.ts:34-37`) and is scoped to "cheap, undoable" actions (`orb-actions.ts:6-13`); tap counts persist per action id; `ORB_ROW_TINT`/`ORB_ROW_GLYPH` are `Record<OrbActionId, string>` (`:48,56`).
- **Mini-app host (A).** `MiniAppView.tsx` renders one `WebView` keyed by `webKey` (bump = realm recreate); the `Orb` is its only chrome (`:160`). `onOpen(app: InstalledApp)` (`LauncherRoot.tsx:433-444`) takes a resolved record; nothing maps an unknown id to UI. System back runs through `back-policy.ts`'s pure `step()` reducer.
- **Shell design system (A).** `SHELL_PALETTE` (bg/card/cardBorder/text/textMuted/accent/onAccent/danger) is derived once from SDK `DEFAULT_THEME` and frozen (`theme.ts:5-8`); type/radius/spacing come from `../../sdk/theme`. Agent prose renders through `WhimProse`; `COPY` strings are never marked (`copy.ts:16-18`). `COPY` is one flat object grouped by screen comments; voice: "sentence case, no exclamation marks, outcome not mechanism" (`copy.ts:12-13`). `product-verbs.suite.ts` regex-scans every `COPY` value against `git, commit, oid, sha, hash, ref, blob, tree, HEAD, realm, generation, dispatcher, iframe, webview, lineage, snapshot, fork-\d, 40-hex`.
- **Settings (A).** Two blocks: server address `TextInput` saving on every keystroke, and a Highlighting `Switch` (`SettingsScreen.tsx:67-99`). `server-address.ts`: `loadServerUrl`/`saveServerUrl`, key `whim.server-url:v1`, trim + strip trailing slashes, blank → `undefined`. `device-id.ts`: `getDeviceId(kv)`, key `whim.device:v1`. All ride one `createMmkvBackend('whim.launcher')` `KVBackend`; new settings follow `whim.<name>:v1`.
- **Links/clipboard (A).** Zero uses of RN `Linking`, `Share`, or any clipboard module; no clipboard dependency in `package.json:35-52`. `AndroidManifest.xml:24-27` has only MAIN/LAUNCHER. No `ios/` directory on main.
- **Tests (A).** `launcher:test` esbuild-bundles `test/acceptance.ts`, whose import list (`:10-47`) is edited by hand per suite. Pure logic lives in non-RN siblings (`home-grid.ts`, `boot-state.ts`, `orb-actions.ts`).
- **Decisions (A).** No decision covers privacy, consent, reports, or universal/app links; `decisions.md:539` defers SDK-`nav` deep links only.
- **Flow call sites (B).** All in `LauncherRoot.tsx`: `onComposeContinue` (`:613`) → `clarifyPrompt`; `openPlan` (`:578`) → `rewritePrompt`; `runAttempt` (`:756`) → `generateApp` SSE (`:815`). Step components only render.
- **Error taxonomy (B).** `GenerationClientErrorKind = 'network' | 'device_id' | 'http' | 'stream_parse'` (`transport-shared.ts:108`); the class carries `kind`, `status?`, `hint?` (`:117-129`), no error identifier and no retry field. `httpErrorFrom` parses the body, checks `DeviceIdError` first, else `kind:'http'` with `bodyJson.hint` — so any `ApiError` hint already surfaces regardless of status. The XHR path (`xhr-transport.ts:246-265`) builds a fake `Response` with only `status` + `json()`, so `Retry-After` is unreachable there; the fetch path never reads it.
- **Failure mapping (B).** `errorReason(err)` (`LauncherRoot.tsx:170-181`) is the single mapping site: hint → reason, else `GENERIC_STREAM_ERROR` (`:139`). `startPendingBuild` (`:769`) runs before the request, so any build-step failure, including pre-stream HTTP errors, settles the record `failed` (`:899-906`). Clarify/rewrite failures open a failure screen with no record (no Discard).
- **Contract (B).** `ApiError = z.object({ error: z.string(), hint: z.string().min(1) })` (`contract/src/index.ts:262-266`); every device import of `@whim/contract` is `import type` (zod must not enter Metro).
- **Payloads (B).** `buildGenerateRequest` (`generation-request.ts:40-61`): new app sends `{prompt, …clarifications}`; an edit adds `app.source` (when present), `app.manifest`, `app.schema`, `app.appliedSchema`. User rows are never read (`:84-90`).
- **Report data (B).** Installed app: `InstalledApp.name` (`app-index.ts:30`), `StoreAccess.activeDescription(entry)` → prompt text (`store-access.ts:234-241`), `StoreAccess.activeSource(entry)` (`:216-222`, `undefined` for legacy snapshots). Done step holds `BuildScreen.text` and `DoneScreen.app`. History rows expose `row.promptText` (field shape beyond usage not verified).
- **Action areas (B).** `DoneStep.tsx:35-49` has two fixed actions, no array. History's expanded row renders `row.actions` (`HistoryScreen.tsx:420-456`), which version-history caps at two.

## Constraints and invariants
- `SHELL_PALETTE` only on shell screens; strings in `COPY` under the product-verbs guard (A).
- Every launcher screen renders inside the boundary-wrapped screen switch (host-observability); I did not verify a static check beyond that structure (A).
- The back-policy guaranteed exit must survive any new chrome over a mini-app (A).
- `@whim/contract` stays type-only in launcher code; diagnostics show only `hint`; the pending record is written before the request (B).

## Integration points
- `clientOptions` memo (`LauncherRoot.tsx:326-331`) is the one value every network call reads (A).
- New `Screen` members at `:102-137` and the `content` chain at `:1077-1227` (A).
- `httpErrorFrom` / `xhr-transport.ts#finishHttpError` for an error identifier and `Retry-After`; `errorReason` for mapping; a report client beside `clarifyPrompt`; a payload assembler beside `generation-request.ts` (B).

## Risks and unknowns
- `useMiniAppHost.ts` was not read in full; interrupting an open app from outside Home is unverified (A).
- The sandboxed iframe's interaction with link handling was not checked (A).
- `FailureScreen.tsx`'s action props were not read (B).

## C. Planner spot-checks
- `openPlan` and `onComposeContinue` open their target step immediately under a loading state, then fire the request ("the wait is that screen, never a grey button", `LauncherRoot.tsx:576-620`); `runAttempt` does `setScreen(building)` before `startPendingBuild` (`:756-769`).
- `buildRewriteAppContext(editing, aboutFor(editing))` also rides the clarify request (`:625-635`), so an edit's clarify and rewrite carry app name, collection/field names, and the current description.
- Launcher ids: `freshAppId()` → `app-<base36>-<random>` (`build-lifecycle.ts:61-64`); forks are `${repo}__${lineageId}` (`store-access.ts:333`); seeds carry fixture ids (`seed.ts:24,52`).
- `integration/store-launch` (sibling `public-generation-server`): `ServiceRefusalCode` is closed (`payload_too_large | daily_limit | device_busy | server_busy | content_policy | policy_unavailable`, plus `budget_exhausted` = 503 being added); `ReportRequest { reason: offensive|harmful|broken|other, note? ≤1000, appName? ≤200, prompt?, source? }`, `ReportResponse { reportId }`; byte caps on prompt/source answer `413`. `Retry-After` is integer seconds, present only on `daily_limit` and global-ceiling `server_busy`.
- `integration/store-launch:ios/Whim/AppDelegate.swift` has no `application(_:continue:restorationHandler:)` or `open url` forwarding to `RCTLinkingManager`.
