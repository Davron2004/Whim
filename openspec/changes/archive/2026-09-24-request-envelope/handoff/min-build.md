# handoff/min-build.md — chain-2 (server minimum build); read by chain-5

## `GET /healthz`

Outside `/v1`: no device header, no envelope, no `x-whim-request-id`. `200`, `application/json`.
Body under the default configuration (`deploy/smoke.sh` checks it by structure: `ok`, `service`, and `minBuild` equal to the
configured values; an absent `minBuild` passes with a warning only when both minimums are `0`):

```json
{"ok":true,"service":"whim-server","minBuild":{"ios":0,"android":0}}
```

```ts
type HealthzBody = { ok: true; service: 'whim-server'; minBuild: { ios: number; android: number } };
```

- `minBuild.ios` / `minBuild.android`: non-negative integers (at most 15 digits), the values the server
  enforces right now. `0` means that platform's gate is off.
- A server from before this change answers `{"ok":true,"service":"whim-server"}` with no `minBuild`. The
  load-test server answers `{"ok":true,"service":"whim-server-loadtest"}` with no `minBuild`.

## The refusal

Every `/v1` route by path prefix (generate, rewrite, clarify, report, usage, and any later one). Order:
device gate (`400`/`401`/`403`) → envelope (`400 invalid_envelope`) → **minimum build** → consent
(`403 consent_required`) → admission. A refused request gets no admission, no ledger row, no model call.

- status `426`
- body (`ApiError`; `update_required` is a `ServiceRefusalCode`):
  `{"error":"update_required","hint":"Update Whim to the latest version to keep using its AI features."}`
- headers: `content-type: application/json`, `x-whim-request-id: <uuid>`, no `Retry-After`
- `/v1/generate` refuses with this plain JSON response before any stream opens (no SSE).
- The request log line: `status: 426`, the same `requestId`, and the envelope fields (`platform`, `build`, …).

## The rule

```ts
// server/src/min-build.ts
export interface MinimumBuilds { readonly ios: number; readonly android: number }
export function minimumBuildGate(minimums: MinimumBuilds): MiddlewareHandler<EdgeEnv>;
```

- Enveloped request: refused ⇔ `build < minimum[platform]`. A build equal to the minimum is served.
- Legacy request (none of the four envelope headers; `LEGACY_ENVELOPE`, platform `unknown`, build `0`):
  refused ⇔ `0 < Math.max(ios, android)`. **Refused as soon as either minimum is above `0`.**

## Operator variables

| variable | `ServerConfig` field | default |
|---|---|---|
| `WHIM_MIN_BUILD_IOS` | `minBuildIos` | `0` |
| `WHIM_MIN_BUILD_ANDROID` | `minBuildAndroid` | `0` |

- Accepted: `^(0|[1-9]\d{0,14})$`. Anything else (empty, negative, fraction, exponent, hex, spaces, leading
  zero, 16+ digits) makes `loadServerConfig` throw `ServerConfigError` naming the variable (boot fails).
  `deploy/deploy.sh` refuses the same values before it builds or changes anything.
- Set in `~/.config/whim/deploy.env` (listed in `WHIM_VALUE_KEYS`), written to `/etc/whim/config.env` only
  when non-empty, never set by a capacity profile. Runbook: `docs/deploy.md`, "Minimum supported build".
