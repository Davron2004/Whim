## 1. Contract and server envelope

- [x] 1.1 In `@whim/contract`, export the five header-name constants (`x-whim-platform`, `x-whim-app-version`, `x-whim-build`, `x-whim-consent`, `x-whim-request-id`), a zod schema for the parsed envelope, and the two new `ServiceRefusalCode` members `update_required` and `consent_required`, with hints in the server's refusal table. Contract tests: a malformed build and an unknown platform are rejected.
- [x] 1.2 Add request-id middleware for `/v1/*` in `createApp`, mounted before the device gate. It mints a UUID, sets `x-whim-request-id` on every `/v1` response (device-gate refusals, refusals and SSE opens included), and binds a child logger carrying `requestId` into the Hono context; routes log through it. Tests: a `400` from the device gate, a `429` refusal and a streamed generate all carry the header, with matching log lines.
- [x] 1.3 Make `usageStore.admit` take the request id instead of minting one, and carry it through the pipeline trace so `emitCompletion`'s `terminal failure` line has `requestId`. Test that the header, the ledger row id and the terminal line agree for one failed generation.
- [x] 1.4 Add envelope middleware after the device gate: parse the four headers; with none present, set the legacy envelope (build `0`, consent `1`); with some or malformed ones, refuse `400` with an `ApiError`. Add `requestId`, `platform`, `appVersion`, `build` and `consent` to the request log line, never the device id. Tests for each case, and one asserting the device id is absent from the line.
- [x] 1.5 Add `server/src/consent-practices.ts`: the closed category set, the append-only `PRACTICES` table with version `1`, and `permits()`, which reads an unknown higher version as the highest known. Clarify, rewrite and generate require `request-material` and refuse `consent_required` (`403`) for `none`, before any model work; report requires nothing. Add a static check that every route calling a model or storing data declares a category, red-checked with a planted route.
- [x] 1.6 Make `server/src/flowbench/drive.ts` and `server/src/loadtest/drive.ts` send a real envelope, so their traffic looks like the app's in the logs.

## 2. Minimum-build gate on the server

- [x] 2.1 Add `WHIM_MIN_BUILD_IOS` and `WHIM_MIN_BUILD_ANDROID` to `loadServerConfig` (non-negative integers, default `0`) and carry them to production like the other operator values: `deploy.sh`'s `config.env` key list, `WHIM_VALUE_KEYS`, `deploy/operator.env.example`, and whatever the deploy-config suite's accepted-contract rule requires. Profiles don't carry them.
- [x] 2.2 Add minimum-build middleware for `/v1/*` after the envelope check: refuse `update_required` (`426`) when the request's build is below its platform's minimum; a legacy client counts as build `0`. Tests: below on one platform, above on the other, both minimums `0`, and a legacy client against a non-zero minimum.
- [x] 2.3 Add `minBuild: {ios, android}` to the `/healthz` body and update `deploy/smoke.sh`'s expected health body to match (other fields unchanged).
- [x] 2.4 Add the runbook section to `docs/deploy.md`: check the build the stores currently serve, set the value, deploy, confirm on `/healthz`, and the rollback.

## 3. Native app info

- [x] 3.1 Add a `WhimAppInfo` TurboModule, following `WhimTone`: a spec in `src/native/NativeWhimAppInfo.ts` exposing constants `{version, build}`, an Android Kotlin module reading `PackageInfo` (`versionName`, `longVersionCode`) registered with the existing package, and an iOS Objective-C++ module reading `CFBundleShortVersionString` and `CFBundleVersion`, added to `project.pbxproj` the same way `WhimToneModule.mm` is. `package.json` must not change.
- [x] 3.2 Add a pure `app-info.ts` wrapper, importable from Node suites, that turns the module's constants into `{platform, version, build}` and fails loudly on a missing or non-integer build. Node test with injected constants.
- [x] 3.3 Build the Android release APK and run it on the emulator: log the constants through the seam and confirm they match `versionName`/`versionCode` from the build. Record the result in `progress.md`. iOS is verified in 6.2.

## 4. The envelope on the phone

- [x] 4.1 Extend `ClientOptions` with the envelope (`platform`, `appVersion`, `build`, `consent`). `consentedClientOptions` fills `consent` from the current grant's version, and the report's options send the grant's version when one exists and `none` otherwise. `requestHeaders` emits all four. Tests: gated options always carry the granted version; a report without a grant carries `none`; no request outside `/v1` gets the envelope.
- [x] 4.2 Read `x-whim-request-id` on all four paths (`httpErrorFrom`, the unary success returns, the fetch stream open, XHR `HEADERS_RECEIVED`) and expose it as an optional `requestId` on each call's result and on `ClientError`. Tests on both transports, success and failure.
- [x] 4.3 Add `update_required` and `consent_required` to `REFUSAL_RULES` with copy in `copy.ts`. `update_required` routes to the update screen (chain 5); `consent_required` sends the user to the consent screen. Add the static check that the phone's five header literals equal the contract constants, red-checked by changing one.

## 5. The update screen

- [x] 5.1 Add the App Store and Play identifiers and links to `release-config.ts` (App Store id `6814891009`, package `com.anycognition.whim`): the `itms-apps://` and `market://` links and their `https://` fallbacks.
- [x] 5.2 Add the `update-required` screen kind to `LauncherRoot`'s `Screen` union and `SCREEN_EXITS`. The screen shows short copy, "Update Whim" (opens the store link and falls back to `https://` if that fails) and "Not now" (home). Route `update_required` refusals from clarify, rewrite, generate (including detached builds) and report there, without losing the typed prompt.
- [x] 5.3 Make the launch-time connectivity check read `minBuild` from `/healthz` and show the update screen when the installed build is below its platform's minimum, replacing home or compose as soon as the check reads it (a request sent earlier is refused `update_required` and lands there too). Amended after review: gating input on a network probe would stall every launch on a slow network.
- [x] 5.4 UI tests: a refusal opens the screen; "Not now" returns home with installed apps openable; the next AI action shows it again; the fallback link is used when the store link fails.

## 6. Live verification (attended)

- [ ] 6.1 Deploy with both minimums at `0`. Confirm TestFlight build 381237 still clarifies and generates, and its request lines carry the legacy envelope and a request id. Record in `progress.md`.
- [ ] 6.2 On a new iOS build and a new Android build, confirm each request line carries the real platform, version and build. Then raise one platform's minimum above its build, deploy, and confirm the update screen shows at launch and on a clarify refusal and that "Update Whim" opens the right listing. Lower it back and confirm. Record in `progress.md`.
