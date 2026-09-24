## Why

Three things have to be in the first public build, because a build can't gain them after it's installed:

- **A way to make old builds update (#64).** Without it, v1 installs keep calling today's API shape forever, and the server can never make a breaking change.
- **The consent version on every request (#63, blocker B10).** "We'll ask you first" only holds if the server knows which version of the deal each request was granted under, and refuses to do anything that version didn't cover. Otherwise a server-only change could quietly widen what happens to people's data.
- **One id per request that both sides can see.** It ties a failure on the phone to the server's log lines and its ledger row. It was planned in `developer-observability` (D7). It moves here because it touches the same code: the request headers the phone builds and the server's `/v1` edge.

Terrain: `research.md`.

## What Changes

- **Every `/v1` request carries an envelope** of four headers: `x-whim-platform`, `x-whim-app-version`, `x-whim-build` and `x-whim-consent` (the granted consent version, or `none` for a report sent without a grant). The version and build come from a small native module that reads what's actually installed.
- **Every `/v1` response carries `x-whim-request-id`,** minted by the server before anything else runs. The same id is on every log line for that request, is the ledger row's id, and is readable by the phone on success and failure alike.
- **A minimum supported build per platform** (`WHIM_MIN_BUILD_IOS`, `WHIM_MIN_BUILD_ANDROID`, default `0` = off). Below it, every `/v1` route answers the new refusal code `update_required`. `/healthz` also reports the minimums, so the app can check at launch, before anyone types a prompt.
- **An "Update Whim" screen.** It opens the App Store or Play listing, and "Not now" returns home; installed apps keep working, as they do after declining consent.
- **Server-side consent practices (B10).** A closed table maps each consent version to the data categories it covers. Each server practice declares its category and runs only if the request's version covers it. Today there is one version. #63's v2 adds categories, and `developer-observability`'s diagnostics route will need one of them. A request that reaches an AI route without a grant gets the new refusal code `consent_required`, as a server-side backstop to the phone's own gate.
- **Old builds keep working.** A request with no envelope is treated as a legacy client: build 0, consent version 1. It's served normally while the minimums are `0`. That covers TestFlight build 381237, which runs tomorrow's demo.
- **The server's request log line** gains platform, app version, build and consent version. It never gains the device id.

## Capabilities

### New Capabilities
- `request-envelope`: the four request headers and their legacy default, the request id and where it appears, the per-version consent practice table and the `consent_required` backstop, and the envelope fields on the request log line.
- `app-update-gate`: the per-platform minimum build, the `update_required` refusal, the minimums on `/healthz`, the update screen and its store links, and the operator runbook for raising a minimum.

### Modified Capabilities
None. The refusal vocabulary, the device gate and the consent gate currently live as deltas in the unarchived `public-generation-server` and `store-launch-compliance` changes (#69). This change adds requirements beside them instead of modifying them.

## Impact

- **Contract:** header-name constants, and the two new `ServiceRefusalCode` members `update_required` and `consent_required`. The device imports types only, and a static check keeps its header literals equal to the contract constants.
- **Native:** a `WhimAppInfo` TurboModule on iOS and Android, following the `WhimTone` precedent (codegen from `src/native`). No `package.json` change.
- **Device:** `transport-shared.ts` (`ClientOptions`, `requestHeaders`, `httpErrorFrom`), `generation-client.ts`, `xhr-transport.ts`, `consent-options.ts`, `service-refusal.ts`, `server-probe.ts`, `LauncherRoot.tsx`, `screen-exits.ts`, `copy.ts`, and `release-config.ts` (store links: App Store id `6814891009`, Play id `com.anycognition.whim`).
- **Server:** `app.ts` middleware (request id, envelope, minimum build), a new `consent-practices.ts`, `usage-store.ts` (`admit` takes the id), the pipeline trace, `config.ts`, and the `/healthz` body. No new dependency.
- **Deploy:** two operator values through `deploy.sh`'s `config.env`, `operator.env.example` and `docs/deploy.md`. Flowbench and the load test send a real envelope.
- **`developer-observability`:** loses its request-id tasks (2.1 in part, 2.2, 2.3), its D7 and its request-id requirement. Its diagnostics body drops `platform`, `appVersion` and `buildNumber`, which the envelope now carries. Its chain-2 and chain-4 run after this change.
- **Sequencing:** apply this change first. It is safe to deploy before the demo: with the minimums at `0`, the only visible difference is the new headers.
