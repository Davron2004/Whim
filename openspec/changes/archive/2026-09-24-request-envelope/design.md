## Context

`research.md` maps the terrain. Summary:

- **Device headers.** Every `/v1` call builds its headers in one place, `requestHeaders(opts)` in `transport-shared.ts`. It sends only `content-type` and `x-whim-device`. There are four calls: clarify, rewrite and report over fetch, and generate over fetch or XHR.
- **Response headers.** They're read only on the error path (`httpErrorFrom`, for `Retry-After`). Success paths throw them away.
- **Version and build.** JS can't read the app's version or build today, and there's no device-info dependency. The build number is injected at release time (minutes since 2026-01-01, decision #66), so a committed constant would say `1`. The one native-module precedent is `WhimTone`, a TurboModule generated from `src/native`.
- **Consent.** The grant is `{version, grantedAt}` against `AI_CONSENT_VERSION = 1`. `consentedClientOptions` is the only way to build options for a consent-gated call. A report is sent without a grant.
- **Server.** Order today: request logger, then `/healthz`, then the `/v1/*` device gate, then routes. Admission runs inside the routes, in a fixed order. `ServiceRefusalCode` is a closed set of seven. There is no request id; `usageStore.admit` mints its own UUID.
- **Update prompt.** The app knows no store URL. Nothing handles a refusal as a full screen. `AppLinkMissingScreen` is the full-screen precedent.

## Goals / Non-Goals

**Goals:**
- The owner can make every build below a number stop using the server and show "Update Whim", per platform, with one config change and a deploy.
- The server never runs a practice that the consent version a request was granted under didn't cover.
- One id links a request's phone-side failure, server log lines and ledger row.
- Builds already installed, including the demo phone's TestFlight build 381237, keep working with no change until the owner raises a minimum.

**Non-Goals:**
- Proving the envelope is honest. A client that lies about its version or consent only affects itself. Proving a request comes from a genuine install is device attestation (#65), which will ride in the same envelope later.
- The v2 consent text and categories. #63 writes them; this change only provides the table they go into.
- Sending device-side diagnostics. That stays in `developer-observability`.

## Decisions

### D1. Four plain headers, not one structured header
`x-whim-platform` (`ios` | `android`), `x-whim-app-version` (e.g. `1.0.0`), `x-whim-build` (a positive integer) and `x-whim-consent` (a positive integer, or `none`). Plain headers are trivial to parse, validate with zod and test, and each one fails on its own.

Alternative: one `x-whim-client: platform=ios; build=…` header. Rejected: it needs a custom parser, and one malformed field would sink all four.

### D2. The version comes from the installed app, through a native module
A `WhimAppInfo` TurboModule exposes constants read at startup: `CFBundleShortVersionString` / `CFBundleVersion` on iOS, and `PackageInfo.versionName` / `versionCode` on Android. It follows `WhimTone` exactly: a spec in `src/native`, codegen through the existing `codegenConfig`, a Kotlin module and an Objective-C++ module. `package.json` doesn't change.

Alternative: generate a JS constant at bundle time. Rejected: the build number is injected by Gradle and fastlane after the xcconfig is read, and a constant can drift from the binary it ships in. The native module reads what is actually installed.

### D3. A missing envelope means a legacy client
A request with none of the four headers is treated as `{platform: unknown, build: 0, consent: 1}`. With both minimums at `0` (the default), a legacy client is served exactly as today. Raising a minimum above `0` refuses legacy clients too, which is intended: they are the oldest builds of all. A request with only some of the headers, or with a malformed one, is refused `400` with an `ApiError`, because only a buggy client sends that.

This is what keeps the demo safe. Deploying this change changes nothing for build 381237.

### D4. The minimum-build gate is `/v1/*` middleware, right after device identity
It runs before any route's admission, so it covers every `/v1` route by path prefix, the same way the device gate does, including report. It refuses with `update_required`, HTTP `426`, and a one-sentence hint. The minimums are `WHIM_MIN_BUILD_IOS` and `WHIM_MIN_BUILD_ANDROID`, read by `loadServerConfig` (default `0`) and carried to production in `config.env` like the other operator values. `/healthz` reports `{minBuild: {ios, android}}`, so the app can check without making a `/v1` call.

Alternative: put the gate in each route's admission order. Rejected: every new route would have to remember it, and the device gate already set the per-prefix precedent.

Alternative: a single minimum for both platforms. Rejected: build numbers share a scheme, but a bug usually belongs to one platform.

### D5. The update screen blocks AI features, not the app
When a `/v1` call is refused `update_required`, or the launch-time `/healthz` check finds the installed build below its platform's minimum, the launcher shows `update-required`. It has two buttons:
- **Update Whim** opens the store: `itms-apps://apps.apple.com/app/id6814891009` on iOS, `market://details?id=com.anycognition.whim` on Android, with the `https://` listing URL as the fallback when the store link can't open.
- **Not now** returns home. Installed apps keep running, because they run on the phone. The next AI action shows the screen again.

The store links live in `release-config.ts`, next to the other release URLs. The screen joins `ScreenKind` and `SCREEN_EXITS` (decision #67).

Alternative: a hard block that covers the whole app. Rejected: it would hold people's own apps hostage to a server-side decision, which cuts against Whim's promise that saved apps are theirs and work on the phone.

### D6. The request id is minted at the edge (moved from `developer-observability` D7)
Middleware mounted for `/v1/*` before the device gate mints a UUID. It sets `x-whim-request-id` on every `/v1` response, including refusals from the device gate, the minimum-build gate and admission, and including SSE opens. It binds a pino child logger carrying `requestId` into the Hono context.
- **Ledger.** `usageStore.admit` takes the id instead of minting one.
- **Pipeline.** The trace carries it, so the terminal line has it.
- **Phone.** `ClientError` and the successful result types gain an optional `requestId`, read on all four paths:
  - `httpErrorFrom`
  - the unary success returns
  - the fetch stream open
  - XHR `HEADERS_RECEIVED`

  What the phone does with it (attaching it to diagnostics) stays in `developer-observability` task 4.4.

### D7. Consent practices are a closed table on the server (#63 B10)
`server/src/consent-practices.ts` holds:
- **Categories.** A closed set matching #63's manifest: `request-material`, `usage-records`, `connection-logs`, `reports`, plus later `error-details` and anything v2 adds.
- **Versions.** `PRACTICES: Record<version, ReadonlySet<category>>`, append-only, with version `1` today.
- **The check.** `permits(consentVersion, category)`.

Rules:
- A version above the highest the server knows is read as the highest it knows. Categories only accumulate, so that never grants more than the phone agreed to.
- clarify, rewrite and generate require `request-material`. A request whose consent is `none` is refused `consent_required`, HTTP `403`. The phone never sends one, since its own gate stops it first, so this is a backstop against a buggy or modified client.
- Report requires no grant, because it's a user act on a screen that says what goes (ai-data-consent's report exception).
- Server logging and the ledger are `connection-logs` and `usage-records`, both in v1.
- The planned diagnostics route requires `error-details`, which enters with #63's v2.
- A static check fails if a route that sends data to a model or stores it doesn't declare its category.

Alternative: trust the phone's gate alone. Rejected: that's exactly the gap B10 names. A server-only change must not be able to widen the deal.

### D8. Header names live in the contract, and the phone copies literals
`@whim/contract` exports each header name as a constant. The phone can't import values from the contract (zod never enters Metro), so it keeps its own literals, and a static check fails when they differ. This follows `developer-observability`'s planned check for the request-id header, which it replaces.

### D9. The request line gains the envelope, not the device
`{method, path, status, durationMs}` becomes `{method, path, status, durationMs, requestId, platform, appVersion, build, consent}`. Nothing here is request content, and the device id stays out.

## Risks / Trade-offs

- **Old clients show a generic error on `update_required`.** Build 381237 doesn't know the code. → Only two installs have it, and the first public build knows it. Raise a minimum only once that build is out.
- **A minimum raised by mistake locks everyone out of AI features.** → The value is per platform and defaults to `0`. The runbook says to check the current store build first, and rolling back is a config change plus a redeploy. `/healthz` shows the live value.
- **The iOS project file edit.** Adding the `.mm` file changes `project.pbxproj`. → Follow the `WhimToneModule.mm` entries exactly, and build both platforms in the live check.
- **Store link schemes.** `itms-apps://` and `market://` can fail on emulators and simulators. → Fall back to the `https://` listing. Opening a URL needs no query-scheme declaration; only `canOpenURL` would.
- **The consent backstop blocks a real user.** Only when the phone sends `none` to an AI route, which its own gate prevents. → A test asserts that the phone's gated options always carry the granted version.

## Migration Plan

1. Deploy the server with both minimums at `0`. Nothing changes for installed builds: legacy clients are served as before and gain a request id.
2. Ship the first public build, which sends the envelope and knows both new codes.
3. When a breaking server change is needed, set the platform's minimum to the oldest build that supports it, and deploy. The runbook in `docs/deploy.md` covers this.
4. Rollback: set the minimum back to `0` and redeploy. The request id, the envelope and the practice table are additive.

## Open Questions

- Should reports from a build below the minimum still be accepted, so a user stuck on a broken old build can still tell you? This design refuses them for consistency; the update screen is the way out. Revisit if support mail shows people stuck.
