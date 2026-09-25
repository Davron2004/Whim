# Research digest: what would the beta-1 tier-0/tier-1 fixes touch, and what must not break?

<!-- Four read-only digests (app shell, mini-app host + polish, server, Apple web docs), run in
     parallel on 2026-09-25 because one 120-line digest couldn't hold ~15 issues. Condensed here by
     the proposer, keeping each digest's file:line facts and "not verified" flags. Scope source:
     docs/beta-readiness-2026-09-24.md. -->

## Relevant files
- `ios/Whim/WhimAgeSignal.swift:34-64`: native Declared Age Range call, no timeout. `src/host/launcher/installed-age-signal.ts:10-12` passes the promise through.
- `src/host/launcher/age-check.ts:97-105` `runAgeCheck`: awaits `read()` with no deadline. Tests in `src/host/launcher/test/age-check.suite.ts`; none use a never-settling `read`.
- `src/host/launcher/LauncherRoot.tsx:1027-1065` (`legalScreen`, `advanceLegalFlow`, age-check effect) and `:1121-1138` (`onOpenAIFeaturesReview`, `onConsentReviewTurnOn`); `src/host/launcher/consent-flow.ts:44,68-75` (`LegalStep`, `nextLegalStep`).
- `src/host/launcher/ComposeStep.tsx:67,81-90` (autoFocus TextInput in a ScrollView), `PlanStep.tsx:129,155`, `SheetModal.tsx:25,65-84` (the only KeyboardAvoidingView), `MiniAppView.tsx:155-167` (WebView, no keyboard props), `android/app/src/main/AndroidManifest.xml:23` (`adjustResize`).
- `src/runtime/web/loader.js:97-154`: realm `error` listener posts `{where:'runtime'}`, mount/paint, `installTheme` (the one host→realm value channel, `msg.theme` → `__WHIM_THEME__`).
- `src/host/launcher/useMiniAppHost.ts:40-106`: `isFatalErrorWhere` / `isRealmErrorWhere`, `handlePaintFrame` / `handleErrorFrame`, the paint watchdog (`StartupDeadline`, `boot-state.ts`). `FailureScreen.tsx` is the recovery screen.
- `src/host/launcher/Orb.tsx`: `ORB_SIZE=54`, absolute `bottom: insets.bottom + SPACING.lg`, scrim, shadow*/elevation on `styles.btn`. `src/sdk/index.tsx:251-269` `Screen`: padding only, no bottom inset.
- `src/sdk/design-tokens.ts:280-299` `appColor`/`hashName`: name-hash mod palette. `src/host/launcher/tiles.ts:1-46`, `app-tile.tsx:31,200-210` (watermark width; comments already cite #48).
- `src/host/launcher/copy.ts:694`: `toLocaleString()` with no locale (#89 says :659; the file has moved).
- `src/host/logging/crash-capture.ts#thrownFields`: copies `error.stack` verbatim, with no platform branch and no path trimming.
- `server/src/admission/slots.ts:78-150`: in-memory, synchronous `SlotController.acquire`, no queue. `refusals.ts:25-36,116-118`: `at_capacity`/`draining` → `server_busy` 429, no Retry-After.
- `server/src/routes/generate.ts:163-251,354-397`: `admitGeneration` (credit → slot → daily unit → content policy) runs entirely before `new Response(stream)`.
- `src/host/launcher/transport-shared.ts:197` `CONNECT_TIMEOUT_MS = 15_000`; `xhr-transport.ts:65-67`: a JS timer covering request start → first chunk reaching the reader. `server/src/sse.ts:10-60`: `: keepalive` comment frames exist.
- `server/src/generation/prompts/index.ts:199-254`: `REWRITE_SYSTEM`/`CLARIFY_SYSTEM`, which name no capability limits.
- `server/src/generation/machine.ts:517-559,636-659,664-683,693-731`: `unverifiedRunOutcome`, `failureTerminalFor`, `endOnThrow`, `emitCompletion`, `runModelTurn`. `stages/run.ts:50-65` collapses the verdict to `{contained:false|null, diagnostics:[]}`.
- `server/src/openrouter.ts:159-171` `requestBody`: `provider:{data_collection:'deny', sort}`, no `order`/`quantizations`. `:387-410` `logSettle` logs the serving `provider` per call (Pino only).
- `server/src/generation/summarise.ts:23-52` `SummariserInput`: prompt, capabilities, attempts, diagnostics. No old/new source.
- `openspec/changes/developer-observability/tasks.md:54`: the 8.2(a) "not re-asked" text. `docs/release/mobile.md`: no upgrade-path procedure.

## Current behavior
- **#100:** `runAgeCheck` maps a rejection to `unavailable`, but a promise that never settles reaches neither branch. The age screen shows only "Back" forever. Nothing in Swift, the TurboModule or JS bounds it.
- **#49/#50:** Compose and Plan are full screens with `keyboardShouldPersistTaps="handled"` and no avoidance. Compose autofocuses. No keyboard library is installed. iOS has no dismissal path (multiline Return adds a newline). Android relies on `adjustResize`. The mini-app WebView has no host keyboard handling. `ClarifyStep.tsx` has no TextInput (answers look chip-driven; not fully verified).
- **#104:** Settings → `onOpenAIFeaturesReview` opens review-mode consent unconditionally. If terms aren't current, "Turn on" goes through `advanceLegalFlow` → terms → `nextLegalStep` → ask-mode consent again: two consent screens.
- **8.2(a):** `AI_CONSENT_VERSION` went 1→2 in legal-surface-v2, so a v1 grant now reads `outdated` and IS re-asked. Only an up-to-date grant isn't.
- **#88:** a post-paint uncaught error → `{where:'runtime'}` → logged only. React 19 unmounts the tree. The watchdog disarmed at first paint and never re-arms. Result: a blank WebView and no FailureScreen.
- **#82:** the orb is an RN sibling over the WebView. The SDK `Screen` has no inset input, and no host-geometry value reaches the realm today.
- **#105:** the scrim is `top:0`; why it misses the status bar wasn't found in styles. The grey disc is likely the Android `elevation` artifact from `shadow*` + `elevation` on `styles.btn` (not confirmed).
- **#48/#52:** a prior watermark fix exists (`app-tile.tsx` comments), so the live repro needs re-checking. Colour is a pure hash of the name, so a small fixed set can collide.
- **#101/#102:** nothing trims iOS stack paths. Where `errorClass:"Other"` is produced wasn't traced (loader's fallback is `'NonError'`).
- **#106:** the summariser is diff-blind by construction, so "No changes" and the persisted source are computed independently. The exact save-vs-no-op call site wasn't traced.
- **#118:** a 4th concurrent `generate` gets 429 before any stream exists. The device allows 15 s from request start to the first chunk, then fails `network`.
- **#57:** a provider throw in an engineer turn → `endOnThrow`, terminal, no retry (machine.ts:217 records a declined retry for a related case).
- **#58:** verdict detail is discarded in run.ts before the machine sees it. The terminal log carries only `{reason}`.
- **#68:** routing sends only `sort`. The provider is logged per call, not stored in the ledger.

## Constraints and invariants
- The age reduction (`adult|minor-approved|minor-not-approved|under-13|unavailable`) and "raw signal never stored" (Texas §121.055) hold. A timeout must land as `unavailable` through `ageSignalFrom`/`ageResultOf`.
- `nextLegalStep` is the single legal gate and `legalScreen` "the one place any legal screen is built". A #104 fix must add no bypass.
- Mini-apps never see HTML/DOM (#11). Tokens, not values (#13). Keyboard and inset handling live in host/SDK code, never in generated bundles.
- Only `trusted` (nonce-authenticated) frames are acted on (spike2 F4). Realm reset = recreate the iframe; never recover in place.
- `appColor` is shared by the grid, tiles and Whim Syntax prose. Changing the hash or palette recolours every app.
- `GenerationEvent` is a closed union. Server and shipped clients fail closed on an unknown `type` (`generation-client.ts:149-152,540-543`). Builds 381237/382511 bundle the old contract, so **no new event type or stage value**.
- `SlotHandle.release()` stays idempotent and is called on every exit path (generate.ts:12-18).
- `TERMINAL_FAILURE_CODES` is closed. The ledger stores codes, never prose. Model ids come only from env (`server/test/prompts.suite.ts` tripwire).
- The summariser is record-free and side-effect-free by design.
- The age-check, consent-flow and terms-flow suites are Node-runnable. Tests inject `read` and a fake clock.

## Integration points
- #100: race in `runAgeCheck` (JS) or `WhimAgeSignal.swift:35` (native). #104: `onOpenAIFeaturesReview` / `onConsentReviewTurnOn`.
- #86: new Swift beside `WhimAgeSignal.swift`, exposed through `WhimAgeSignalModule.mm`.
- Keyboard: ComposeStep/PlanStep roots, the SheetModal pattern, `MiniAppView` WebView props.
- #88: `useMiniAppHost.ts` fatal/realm classification, `loader.js:107` error listener / root mount. #82: `installTheme` + SDK `Screen`.
- #101: `crash-capture.ts#thrownFields`. #89: `copy.ts:694`. #52: examples' declared tile colour / `appColor`.
- #118: `admitGeneration` / `SlotController.acquire` (pre-stream). Load test: `deploy/loadtest/run.sh drive --devices N --cap C` (`docs/deploy.md:389-432`).
- #62/#70: `CLARIFY_SYSTEM`/`REWRITE_SYSTEM`. #57: `endOnThrow` / `runModelTurn`. #58: `stages/run.ts:63-64`. #68: `requestBody`, env via `ModelRoster`.

## Apple (web; confirmed = Apple page)
- **Confirmed:** PermissionKit `SignificantAppUpdateTopic(description:)`, iOS 26.2+. `AgeRangeService.shared.showSignificantUpdateAcknowledgment(in:updateDescription:)` shows the parent/guardian dialog. The cadence is per significant change, and the developer decides what counts as significant. `requiredRegulatoryFeatures` exists (iOS 26.4+).
- **Not documented by Apple:** behaviour for adult or unsupervised users, and whether a plain terms update in an app with no under-18 features must call it (forum thread 810754 is unanswered).
- **Community reports, not Apple:** `isEligibleForAgeFeatures` can hang (simulators, missing family setup). The known workaround is a 3–10 s deadline → unavailable.
- **Inferred, not Apple:** a new build of an already-approved version added to an external group is usually auto-approved in minutes (first review ~24 h). `POST /v1/betaAppReviewSubmissions` is confirmed.

## Risks and unknowns
- Not verified: the clarify contract schema file; whether a keepalive comment disarms the device's first-chunk timer; `usage-store.ts` columns; the Android age-signal hang risk; the #105 status-bar cause; the #106 save call site; whether #48 still reproduces.
