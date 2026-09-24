# Research digest: request envelope (app version and build number, consent version), a server-minted request id, and a minimum-build "update required" refusal

## Relevant files
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/transport-shared.ts: `requestHeaders` (:206-208) is the only place device request headers are built. It returns `content-type` + `x-whim-device` only. Also holds `ClientOptions` (:116-123), `consentedClientOptions` (:146-155), `httpErrorFrom` (:240-254) and `retryAfterSecondsOf` (:80-87).
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/generation-client.ts: fetch-based `clarifyPrompt` (:199, POST at :208), `rewritePrompt` (:240/:250), `sendReport` (:285/:293), and the fetch stream path for `/v1/generate` (:381/:414). Each passes `headers: requestHeaders(opts)`.
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/xhr-transport.ts: the XHR SSE path for `/v1/generate`. It sets headers from `requestHeaders` (:271-274), acts on `HEADERS_RECEIVED` (:276-279), and on errors builds a fake `Response` whose `headers.get` forwards to `xhr.getResponseHeader` (:253-260).
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/server-probe.ts: the connectivity probe, `GET ${baseUrl}/healthz` (:53). It is outside `/v1` and sends no headers.
- /Users/davrondjabborov/Work/other/Whim/src/host/logging/sink.ts: dev-only `POST /dev/logs` (:26, :58-65). Outside `/v1`, content-type header only.
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/ai-consent.ts, /Users/davrondjabborov/Work/other/Whim/src/host/launcher/release-config.ts, /Users/davrondjabborov/Work/other/Whim/src/host/launcher/consent-options.ts: the consent grant store, `AI_CONSENT_VERSION = 1` (:39), `RELEASE` URLs, and `liveClientOptions`.
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/service-refusal.ts, /Users/davrondjabborov/Work/other/Whim/src/host/launcher/refusal-landing.ts: `REFUSAL_RULES` mapped over `ServiceRefusalCode` (:29-37), `serviceRefusalOf` (:53), and `refusalLanding`.
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/LauncherRoot.tsx: `Screen` union (:128-150), `reportClientOptions` (:450-454), the connectivity loop (:483-499), `serviceRefusalOf` call sites (:943, :1000, :1323), and the `ScreenBoundary` wrapper (:1758-1769).
- /Users/davrondjabborov/Work/other/Whim/src/host/launcher/screen-exits.ts: the `ScreenKind` union and the `SCREEN_EXITS` exit table (decision #67), plus `frameEdgesFor`.
- /Users/davrondjabborov/Work/other/Whim/server/src/app.ts: middleware order, the `/v1/*` device gate (:253-260), `onError` (:206-219) and route mounting.
- /Users/davrondjabborov/Work/other/Whim/server/src/device-identity.ts: `DeviceVerifier` and `shapeOnlyVerifier`.
- /Users/davrondjabborov/Work/other/Whim/server/src/admission/refusals.ts: `ServiceRefusal` bodies, hint table, `Retry-After`.
- /Users/davrondjabborov/Work/other/Whim/contract/src/index.ts: `ApiError` (:283), `DeviceIdError` (:292) and `ServiceRefusalCode` (:306-314, seven members).
- /Users/davrondjabborov/Work/other/Whim/server/src/config.ts: `ServerConfig` and the `readPositiveInt`/`readString` readers. `loadServerConfig` is the only server reader of `process.env`.
- Deploy config: /Users/davrondjabborov/Work/other/Whim/deploy/lib.sh (:27 `WHIM_VALUE_KEYS`, :73-89 load order), /Users/davrondjabborov/Work/other/Whim/deploy/deploy.sh (:162-176 builds `config.env`), /Users/davrondjabborov/Work/other/Whim/deploy/defaults.env, /Users/davrondjabborov/Work/other/Whim/deploy/operator.env.example, /Users/davrondjabborov/Work/other/Whim/deploy/profiles/{standard,event}.env, and /Users/davrondjabborov/Work/other/Whim/server/test/deploy-config.suite.ts (:1639-1651 runbook rule, :683 profile rule).
- Native version sources: /Users/davrondjabborov/Work/other/Whim/release/whim-release.xcconfig, /Users/davrondjabborov/Work/other/Whim/android/app/build.gradle (:82-148), /Users/davrondjabborov/Work/other/Whim/ios/Whim/Info.plist (:21-26), /Users/davrondjabborov/Work/other/Whim/src/native/NativeWhimTone.ts (the only TurboModule).
- /Users/davrondjabborov/Work/other/Whim/openspec/changes/developer-observability/{proposal,design,tasks,chains}.md and specs/server-observability/spec.md: the planned request id.
- /Users/davrondjabborov/Work/other/Whim/docs/research/legal-surface-2026-09/README.md: B10 (:152), the task row (:44), the drop-in requirement (:379-437), manifest v2 (:440-463), implementation pointers (:549-557).

## Current behavior
- **Device → server calls today.** There are four `/v1` routes: clarify, rewrite and report (fetch, unary), and generate (fetch or XHR). The device never calls `/v1/usage`. All of them get headers only from `requestHeaders(opts)`, and `ClientOptions` carries only `baseUrl`, `deviceId` and test hooks. The probe (`/healthz`) and the dev sink (`/dev/logs`) are outside `/v1` and build their own requests.
- **Reading response headers.**
  - Unary fetch paths: `response.headers.get(...)` is already used for `Retry-After`, but only on error, inside `httpErrorFrom`.
  - Successful paths: headers are thrown away. Unary calls return the parsed JSON; the stream paths return a `ResponseBodyReader` only.
  - XHR path: `getResponseHeader` is available from `HEADERS_RECEIVED` onward.
  - RN fetch is whatwg-fetch over XHR, and its `Headers` come from `getAllResponseHeaders`. I did not verify this in `node_modules`.
- **Version and build number at runtime.** JS has no source today.
  - `package.json` has no react-native-device-info, expo-application or react-native-config.
  - `release-config.ts` holds only the domain, URLs and `AI_CONSENT_VERSION`.
  - `whim-release.xcconfig` has `WHIM_MARKETING_VERSION = 1.0.0` and `WHIM_BUILD_NUMBER = 1`. The real build number is minutes since 2026-01-01 (decision #66 D3). It is injected at build time: Android uses the `-PwhimBuildNumber` Gradle property (build.gradle:139); iOS uses `CURRENT_PROJECT_VERSION = $(WHIM_BUILD_NUMBER)`, overridden by the fastlane lane.
  - Android `versionName`/`versionCode` come from the xcconfig. There is no `buildConfig` or `BuildConfig` reference in `android/`.
  - The only native module precedent is `WhimTone`, a TurboModule through `codegenConfig` `WhimAppSpecs`, with `jsSrcsDir src/native`, Kotlin and `ios/Whim/WhimToneModule.mm`.
- **Consent.**
  - The grant is stored under `whim.ai-consent:v1` as `{version, grantedAt}`. `consentStatus` returns `granted`, `absent` or `outdated`; the `granted` result does not carry the version, since it equals `AI_CONSENT_VERSION` by construction.
  - `consentedClientOptions` is the only constructor of the branded `ConsentedClientOptions`, and returns null unless the grant is current.
  - `sendReport` takes plain `ClientOptions` (`reportClientOptions`, LauncherRoot:450) and is sent with no grant.
  - A build already running survives revocation. Its request was sent under the grant that was current at send time.
- **Server.**
  - Middleware order: `*` request logger (:184), `onError`, then `/healthz` and `/healthz/sse` (anonymous), then the `/v1/*` device gate. The gate calls `deviceVerifier.verify(headers)` and fails with 400/401/403 and an `ApiError` body.
  - Drain and all admission checks run inside the routes, not as middleware. The drain check goes through `slots`.
  - There is no request id today. `usageStore.admit` mints `randomUUID()` (usage-store.ts:354, :529).
  - There is no CORS middleware. Caddy (`deploy/Caddyfile`:6-13) is a plain `reverse_proxy` with `flush_interval -1`, and I found no header rewriting.
  - The pino redaction list includes `x-whim-device` (logger.ts:50).
- **Refusal to UI.**
  - `serviceRefusalOf` recognises only `kind:'http'`, a code that is an own key of `REFUSAL_RULES`, and a non-empty hint.
  - Rules support two landings, `text` or `sender`, and two tones.
  - They are consumed at LauncherRoot:943/1000/1323 and in ReportSheet.tsx:136.
  - Nothing today handles a refusal as a full screen.
- **Store URLs.** `WHIM_APP_STORE_URL` and `WHIM_PLAY_STORE_URL` are only site-build values. They are used in `server/src/site/build.ts` for the `deploy/site/app-link.html` fallback, passed by deploy.sh:134-137, listed in `WHIM_VALUE_KEYS`, and optional. The app does not know any store URL. `Linking.openURL` is used only for `RELEASE.privacyPolicyUrl` and `RELEASE.supportUrl` (SettingsScreen:194/201, ReportSheet:241, ConsentScreen:112). The Info.plist and AndroidManifest have no `LSApplicationQueriesSchemes` entries or `<queries>` blocks.

## Constraints and invariants
- **Device identity.** Every `/v1` route is gated by the device verifier, by path prefix and not route by route. The suite must assert this over the whole route table. Routes read only the verified id, never the raw header (the device-identity requirement in `specs/generation-server` and its public-generation-server delta).
- **Refusal vocabulary.** `ServiceRefusalCode` is a closed set that grows only additively. `ApiError` stays `{error: string, hint: string.min(1)}`, and a refusal must never introduce a second error shape (public-generation-server generation-contract delta, "Service refusal codes are a closed vocabulary"). On the device, `REFUSAL_RULES` is a mapped type, so adding a contract member without a rule fails the typecheck (service-refusals, "A refusal is recognised by the contract's closed refusal vocabulary").
- **Admission order.** The fixed order is: device identity, body cap, validation, prompt cap, credit, drain, exclusivity, concurrency, daily limits, policy. Report has its own order (server-admission-control delta, "Admission checks run in a fixed order before any model work"). Every refusal body must be a `ServiceRefusalCode` with a one-sentence hint that names no internal identifier or environment variable ("Every refusal is a structured, user-facing ApiError").
- **Consent gate.** From ai-data-consent (store-launch-compliance delta):
  - "Nothing is sent to the server before consent is granted" (the report is the one exception).
  - "The first action that would send data asks for consent at that moment".
  - "The disclosure names what is sent, what is never sent, and who receives it".
  - "Permission is explicit and declining keeps installed apps usable".
  - "Consent grants are versioned" (includes "A policy change asks again").
  - "Settings shows consent and can review or turn it off".
  - release-config: "The consent version is declared with the release configuration" (only one place writes it).
- **Report exception.** content-reporting's "Sending a report posts it and keeps the user in the app" says sending does not require consent. A report can therefore carry no granted consent version.
- **Error taxonomy.** generation-stream-transport's "The streaming transport preserves the client error taxonomy" keeps four kinds: `network`, `device_id`, `http`, `stream_parse`.
- **Contract imports.** The device imports `@whim/contract` type-only, so zod never enters Metro (service-refusal.ts:5, the generation-contract Metro-safe requirement, the `guard:metro` byte-size check). A header-name constant would be a value import. developer-observability task 4.4 plans a static literal-equality check instead.
- **Server config.** New operator values go through `loadServerConfig`, which parses, fails naming the variable, and freezes. A variable named in `docs/deploy.md` must be in `WHIM_VALUE_KEYS`, read by `loadServerConfig`, or be a release-config key (deploy-config.suite.ts:1642). Profiles may hold only keys that `loadServerConfig` reads, and `standard` must not override limits (:694).
- **Launcher screens.** A new screen kind must join the `ScreenKind` union and `SCREEN_EXITS` (decision #67). `ScreenBoundary` wraps every screen (host-observability).
- **Governing decisions.** #33 (Model 1, stateless server), #65 (store-launch compliance), #66 (build numbers, one native config file), #68 (public server). The legal note "#64" refers to GitHub issue #64, not decision #64.

## Integration points
- **Device headers.** `requestHeaders(opts)` is the one choke point for all four `/v1` calls. `ClientOptions` and `consentedClientOptions(status, baseUrl, deviceId)` are where extra fields would ride. `ConsentStatus.granted` has no version field today. `reportClientOptions` is built separately.
- **Device response headers.** Four places:
  - `httpErrorFrom` (error path, both transports).
  - Unary success returns in generation-client.ts after :223/:269/:308.
  - fetch stream open at :414-434.
  - XHR `decide()` at `HEADERS_RECEIVED`.
- **Server edge.** In `createApp`, the slot between the `*` logger (:184) and the `/v1/*` gate (:253) is where D7 places request-id minting ("before device identity"). The verifier's `verify(headers)` return type is fixed to `{ok:false; status:400|401|403; body:ApiError}`.
- **Server config.** `ServerConfig` plus a reader in config.ts. To reach production, a value must be emitted into `config.env` either through a profile file or through deploy.sh:174's key list plus `WHIM_VALUE_KEYS` and operator.env.example. The runbook table is `docs/deploy.md`.
- **Launcher.** The `Screen` union (LauncherRoot:128), `renderScreenContent` branches (:1560-1727), `screen-exits.ts`, `AppLinkMissingScreen` (the existing full-screen informational precedent), `copy.ts`, and `Linking.openURL`. The refusal handlers at :943/:1000/:1323, the detached-build settle path and ReportSheet:136 are where a refusal currently lands.
- **Moving the request id out of developer-observability.**
  - What moves: task 2.2 (middleware before identity, header on every `/v1` response including refusals and SSE opens, a child logger in the Hono context), task 2.3 (`usageStore.admit` takes the id; `RunTrace` makes the terminal line carry it), part of task 2.1 (`WHIM_REQUEST_ID_HEADER = 'x-whim-request-id'`), the spec requirement "One request id follows a /v1 request everywhere", and design D7.
  - What stays behind and consumes it:
    - Task 4.4: the device reads the header and attaches `requestId` to `logMappedError` and the LauncherRoot failure logs.
    - Chain-4 reads `handoff/server-diagnostics.md`, which lists `WHIM_REQUEST_ID_HEADER`. That file is not written yet.
    - The `DiagnosticsBatch` envelope (`platform`, `osVersion`, `appVersion`, `buildNumber`, task 2.1) plans its own version and build source.
    - Task 1.4 (Logs Explorer saved queries by `requestId`), task 8.1 (live verification) and the scenario "A failed generation joins up".
  - Chain-2 also bundles `failure_reason` (2.4), `/v1/diagnostics` (2.5) and `/healthz` commit (2.6), all of which touch `app.ts`.
- **B10 attach points on the server.** These are the practices a per-grant check could gate, by manifest category:
  - Server logging and pino lines: Connection and log data.
  - Ledger rows plus the planned `failure_reason` and request id: Usage records.
  - `/v1/report` storage: Reports, user-sent, with no grant.
  - The planned `/v1/diagnostics`: Error details, optional, on by default.
  - The lifetime `usage` table (B8): Usage records.
  - Model calls: Request and App material.
  There is no manifest data structure in code yet. The only hits for "manifest version" and "consent version" are in the README.

## Risks and unknowns
- **Other `/v1` clients that break if new headers become required.** I found no other `/v1` caller outside `server/` and `deploy/`.
  - `deploy/smoke.sh:130-137` expects 400 from `/v1/generate` with no device header.
  - `server/src/loadtest/drive.ts:165-167` and `server/src/flowbench/drive.ts:128,187` send only content-type and `x-whim-device`.
  - `server/test/*`: 32 occurrences across 11 files.
  - `src/host/launcher/test/*`: 8 occurrences across 3 files, plus `consent-gate-ui.suite.tsx` request counting.
  - Synthrun and corpus-eval run in-process. Demo flows go through the app with Maestro.
- **Old clients.** Every build already shipped sends neither a version nor a consent header. There is no evidence of any shipped build in code. I did not verify TestFlight or Play state.
- **Live specs are missing.** capabilities.md points to live specs that do not exist (`server-admission-control`, `content-reports`, `server-deployment`). Their requirements live only in the unarchived `public-generation-server` and `store-launch-compliance` deltas.
- **Build number in JS.** Because the build number is injected per release, a JS constant generated from the committed xcconfig would read `1`. I did not verify whether Metro's bundle phase inside Gradle or Xcode could see the injected value, or whether `BuildConfig` is generated for the app module.
- **Probe blind spot.** The connectivity probe hits `/healthz`, outside `/v1`, so it would show "verified" even while every `/v1` call is refused.
- **Detached builds.** A refusal that arrives after the user taps "Leave it running" settles as a failed build with the hint as its reason (service-refusals, "A refusal from compose, clarify, or plan never opens the failure screen").
- I did not verify how ReportSheet or FailureScreen would render an unknown future refusal code beyond `serviceRefusalOf` returning `undefined` for it.
- I did not read `server/src/routes/*` beyond the `admit` call sites, or `usage-store.ts` beyond the two `randomUUID` lines.

## Open questions for the planner
1. A report is sent without consent. Should a report request carry a consent version, and what should the server do with a report from a device that has no grant?
2. Should the minimum-build refusal become a new `ServiceRefusalCode` member (additive), or come from the device-identity verifier's 400/401/403 slot? Its place in the fixed admission order is undecided either way.
3. Where should the app find its store URL? The app has none, the Apple App Store id is not in the repo, and the server's `WHIM_*_STORE_URL` values are optional and site-only.
4. Does moving the request id also move `WHIM_REQUEST_ID_HEADER` and a `handoff/server-diagnostics.md` rewrite, and does developer-observability's `DiagnosticsBatch` keep its own `appVersion`/`buildNumber` or reuse the envelope?
5. For B10's "handled under its own version's practices or refused": with only consent version 1 existing today, what is the server's per-version practice table?
