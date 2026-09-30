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


## Pending-write recovery (2026-09-30)

The root initially planned this correction after a reviewed R2 integration. The later r3 cold-launch finding below supersedes that dispatch prerequisite: R2 is parked and its candidate is privately carried into chain-10, not merged independently. The supporting
read-only investigation was recorded in `/tmp/whim-beta1-terminal-recovery-policy.md`,
`/tmp/whim-beta1-sonar-r2-terminal-review-policy.md`, and
`/tmp/whim-beta1-pending-write-policy-proposal.md`; the facts needed by implementation follow here
so the change does not depend on temporary files. No product changes or tests were made in this
planning pass. The graph query located the modules but returned older, truncated line locations;
these facts were checked against current targeted source and spec reads.

- The live `pending-builds` spec requires truthful state, persisted terminal failure, and launch-time
  `building` → `interrupted` demotion. `interrupted` denotes process loss, not a known terminal
  failure whose write failed. The journal spec explicitly forbids journal-derived lifecycle state.
  `app-launcher` requires every applicable pending entry to remain represented; edit attempts keep
  their existing no-separate-ghost rule.
- `pending-builds.ts` is a synchronous KV wrapper. `get`/`list` read persisted keys; writes throw
  through to callers, and `demoteBuildingToInterrupted` presently stops on a write error. It has
  no current-state fallback. Keep those raw reads separate from the new current-state reads.
- `LauncherRoot.tsx#refresh`, `#onOpenPending`, `#failureActions`, and `#openAppLink` own the UI
  decisions. `openAppLink` passes `pending.list()` to `resolveAppLink`, then calls the same pending
  handler as a tile. `link-routing.ts` only consumes records, so passing current records needs no
  routing-module or Home change. These call sites all fit the existing LauncherRoot allowlist.
- The shell explicitly allows overlapping attempts and retains one `liveRef`. Its absence cannot
  prove that another pending attempt ended. Use an opaque lease from completed durable setup;
  fence terminal writes/recovery and retention by that lease, including reuse of one launcher ID.
- Setup writes pending then an empty journal before the generation call. Restoring the two raw
  snapshots already attempts each sibling independently. Preserve this behavior and the R2
  selective-write fix: after failed restoration, a verified generic failed pending write is useful
  even when the journal remains unavailable. Never treat a current volatile read as this readback.
- `native-storage.ts#failNativeStorageWritesWhen` faults only `set`, globally across adapters over
  a named store. `remove` currently returns `data.delete(key)`. The installed producer declares
  `remove(key): boolean` in `react-native-mmkv/src/specs/MMKV.nitro.ts`; its
  `cpp/HybridMMKV.cpp#remove` returns `removeValueForKey`'s boolean and notifies only on true.
  The host `mmkv-backend.ts` exposes this through `KVBackend.delete(): void`; callers do not inspect
  the native boolean. A non-throwing call is therefore insufficient evidence of deletion.
- Add a separate test-only seam in `src/host/launcher/test/native-storage.ts`:
  `failNativeStorageRemovalsWhen(({id, key}) => 'throw' | 'return-false' | undefined)`.
  `throw` leaves the key and throws; `return-false` leaves the key and returns false; undefined
  delegates to the existing Map deletion. Its returned cleanup restores the previous predicate;
  `resetNativeStorage` clears both independent predicates. Do not widen or change the existing
  write-failure hook. Include both modes in rendered Discard acceptance with actual readback.

All relevant writes can fail. No policy can guarantee a durable old pair or terminal state in
that condition. D19 instead preserves direct completion evidence in the owning store instance.
The memory state ends with that process; a later process knows only the surviving persisted
records and its predecessor's loss. Read failures/corruption keep their existing policy.

Cancel and successful-delivery write faults are adjacent but not covered by this correction.
In particular, deleting after an already completed install and aborting a live generation need
separate recovery reasoning; do not relabel either as a failed generation or add tombstones here.
The chain must preserve those successful paths and release its leases, and report any reproduced
adjacent fault to the orchestrator rather than silently extending D19.


### R2 r3 park and durable journal association (2026-09-30)

The independent r3 review (`/tmp/whim-beta1-sonar-r2-terminal-review-r3.md`) rejects candidate
`645e7fc6d452b879f0c3e991e6141e7691003084`. Its 13,778 launcher checks and fast gate exit 0 prove
the tested same-session recovery, not cold-launch report correctness. `unavailableJournalRef`
is empty in a fresh LauncherShell, so a saved generic failed record can reopen its restored old
journal as the new attempt's report. The same-mounted Back/reopen test misses that path.
The mechanical revision cap was reached. Root's canonical park exited 0; the candidate remains
on `wip/beta-1-sonar-r2-terminal` and was never merged to staging. S3 stays open.

Root authorized a narrow architecture change: `PendingBuildRecord.journalUnavailable?: true`.
This supersedes the initial unchanged-JSON constraint. The field controls only diagnostic
association, never building/failed/interrupted state. Absence keeps legacy report eligibility;
true prevents record-driven journal/report attachment even if raw journal bytes exist.

Compatibility proof from the actual producer/reader:

- `src/host/launcher/pending-builds.ts#get` returns `JSON.parse(raw) as PendingBuildRecord`.
  No whitelist, zod schema, exact-key check, or record-version gate rejects an added optional key.
- `list` obtains each record through `get`. `setFailed` and startup demotion spread `...rec`, so
  those legacy transitions preserve unknown fields. `create` rebuilds an explicit object and
  would discard the field; the new implementation must explicitly emit true at every setup.
- `RunJournalStore#create` writes `[]`; journal parsing only checks `Array.isArray`. The existing
  journal remains an array with no new run ID, timestamp identity rule, or schema/version field.
- This proves storage read compatibility, not enforcement by obsolete app code. Older code does
  not know the flag and cannot provide the new report guarantee. Unflagged historical records
  retain their prior interpretation; no content/timestamp heuristic retroactively guesses which
  might have been created by the rejected candidate. That candidate has not shipped via staging.

New setup ordering is pending(building, flag=true) → verified empty journal → verified pending
flag-clear → lease activation/HTTP. A failed setup never clears its previous current view or
sends a request. If clearing the marker fails, setup failed. If a process dies before clearing,
startup demotes the flagged raw record while keeping its report unavailable.

Recovery has a provenance prerequisite. Before replacing a journal under a current record,
including resetting it for a generic fallback, persist/read back flag=true on that record (or verify the target journal already matches
those bytes, so no association-changing write is needed). If the guard cannot persist, do not
introduce that old journal; independently attempt safe pending recovery and generic fallback.
Restore an old pending snapshot with its original flag only after the exact corresponding old
journal bytes/absence are verified. Otherwise restore its data with flag=true. This allows exact
old-pair restoration when both siblings are verified while preventing the crash window between
journal restoration and a failed pending restoration. A failed pending restore leaves a guarded
record; a generic fallback without a verified current journal writes failed payload plus true
in the SAME pending write. That atomic write may guard a later generic journal reset; a failed
guard cannot be followed by that reset. There is no unflagged generic intermediate state.

Clearing is allowed only from verified current provenance: new empty-journal setup, verified
current terminal journal plus its matching pending settlement, or an exact verified old-pair
restore whose original marker was absent. An old snapshot with true stays true merely because
its raw journal can be restored. Generic saved-record readback checks both payload and flag.
All record-driven report entry points re-read the marker; an in-memory Set cannot replace it.

Dispatch starts at the root-pinned staging tip (reported source tip `4f729788...`), recorded as the
new lane's original BASE at creation. Root privately carries `2cc74989`, `9712c08a`, `645e7fc6`
in order into that lane before implementation. All are rejected-candidate work over the same two
launcher files, not a reviewed staging prerequisite. Review/gate the entire composed five-file
change against the original BASE. Do not reset the exhausted mechanical cap or mark S3 clean
because the architecture work has a new chain name.
