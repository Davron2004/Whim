# handoff/envelope.md — chain-1 (server envelope and request id); read by chain-2, chain-4, developer-observability

## Header names (`@whim/contract` constants)

| constant | header | value |
|---|---|---|
| `PLATFORM_HEADER` | `x-whim-platform` | `ios` or `android` |
| `APP_VERSION_HEADER` | `x-whim-app-version` | installed marketing version: a digit, then up to 31 of `[0-9A-Za-z.+-]` (`1.0.0`, `1.1.0-beta.2`) |
| `BUILD_HEADER` | `x-whim-build` | installed build number, positive integer text `^[1-9]\d{0,14}$` |
| `CONSENT_HEADER` | `x-whim-consent` | consent version the request is sent under (same integer text), or `none` |
| `REQUEST_ID_HEADER` | `x-whim-request-id` | RESPONSE header: a UUID, on every `/v1` response |

Only `/v1` requests carry the four request headers.

## Parsed envelope

```ts
// @whim/contract — ClientEnvelope (zod) parses { platform, appVersion, build, consent } header text into:
export type ClientEnvelope = { platform: 'ios' | 'android'; appVersion: string; build: number; consent: number | 'none' };
export type ConsentVersion = ClientEnvelope['consent'];   // ClientPlatform = z.enum(['ios', 'android'])

// server/src/request-edge.ts
export const LEGACY_ENVELOPE: { platform: 'unknown'; appVersion: 'unknown'; build: 0; consent: 1 };
export type RequestEnvelope = ClientEnvelope | typeof LEGACY_ENVELOPE;
export function parseRequestEnvelope(headers: Headers): { ok: true; envelope: RequestEnvelope } | { ok: false; body: ApiError };
```

- None of the four headers → `LEGACY_ENVELOPE`, served exactly as before. Legacy ⇔ `platform === 'unknown'`.
  How `unknown` meets the per-platform minimums is chain-2's call (task 2.2: a legacy client counts as build `0`).
- Some but not all, or any malformed or empty value → `400` `{ error: 'invalid_envelope', hint }`, hint naming
  the header, before any later middleware or route admission.

## `createApp` middleware order

1. `app.use('*', …)` request logger, then `/healthz`, `/healthz/sse` (outside `/v1`: no id, no envelope)
2. `app.use('/v1/*', assignRequestId)`
3. `app.use('/v1/*', <device gate>)` → `400`/`401`/`403` `ApiError`
4. `app.use('/v1/*', readEnvelope)` → `400` `invalid_envelope`
5. **chain-2 mounts the minimum-build gate here**, at the `app.ts` comment
   `// The minimum-build gate (app-update-gate) mounts here: after the envelope, before the routes.` → `426`
6. routes: `app.post('/', consentPractice(…), bodyLimit(…), handler)` → `403` `consent_required`, then admission

The id header is stamped after the chain returns (`c.header` after `await next()`), so a response a later
middleware returns (e.g. the `426`) carries it with no extra code.

## Hono context

```ts
// server/src/request-edge.ts
export interface RequestVariables {
  requestId: string;        // the x-whim-request-id value and the ledger row id
  log: ServerLogger;        // root logger child bound to { requestId }
  deviceId: string;         // from the DeviceVerifier, never the raw header
  envelope: RequestEnvelope;
}
export type V1Env = { Variables: RequestVariables };            // route modules
export type EdgeEnv = { Variables: Partial<RequestVariables> }; // createApp's env and its middleware
```

Read with `c.get('envelope')`, `c.get('requestId')`, `c.get('log')`. A middleware mounted in `createApp` is a
`MiddlewareHandler<EdgeEnv>` and sees them as optional; from step 5 on all four are set. Log through
`c.get('log')` and never add a `requestId` field of your own (it would duplicate the binding).

## Refusals (`server/src/admission/refusals.ts`)

| code | status | builder | hint |
|---|---|---|---|
| `update_required` | `426` | `updateRequiredRefusal()` | "Update Whim to the latest version to keep using its AI features." |
| `consent_required` | `403` | `consentRequiredRefusal()` | "Whim needs your permission to send requests to its AI service." |

Neither carries `Retry-After`. Use: `const r = updateRequiredRefusal(); return c.json(r.body, r.status, r.headers);`

## Consent practices (`server/src/consent-practices.ts`)

```ts
export const PRACTICE_CATEGORIES = ['request-material', 'usage-records', 'connection-logs', 'reports'] as const;
export type PracticeCategory = (typeof PRACTICE_CATEGORIES)[number];
export type PracticeTable = Readonly<Record<number, ReadonlySet<PracticeCategory>>>;
export const PRACTICES: PracticeTable; // { 1: all four categories } — APPEND-ONLY
export function highestConsentVersion(table?: PracticeTable): number;
export function permits(consent: ConsentVersion, category: PracticeCategory, table?: PracticeTable): boolean;
export type GrantRule = 'required' | 'exempt';
export function consentPractice(category: PracticeCategory, grant: GrantRule): MiddlewareHandler<V1Env>;
```

- `none` covers nothing. A version the table lacks reads as the highest known version at or below it.
- clarify, rewrite, generate: `consentPractice('request-material', 'required')`. report: `consentPractice('reports', 'exempt')`.
  usage: none (it only reads).
- Static check (`server/test/request-edge.suite.ts`): a `server/src/routes/*.ts` file that names `ModelClient`,
  `Pipeline` or `ContentPolicy`, or calls a non-`read` method on a `…Store` identifier, must call `consentPractice(`;
  the failure names the file. A new data route (e.g. diagnostics, whose `error-details` category enters with v2)
  must declare one.

## Request log line

`msg: 'request'`, `scope: 'request'`, fields `{ method, path, status, durationMs, requestId, platform, appVersion,
build, consent }`, never the device id. The envelope fields are absent when the request ended before
`readEnvelope`; all edge fields are absent outside `/v1`. The SSE generate route logs the same fields when its
stream settles. Helper: `envelopeLogFields(envelope: RequestEnvelope | undefined)`.

## Where else the request id lives

- Ledger: `UsageStore.admit({ requestId, … })` — the store never mints an id.
- Pipeline: `RunTrace.requestId?: string`; every run line (`run start`, `stage`, `model call failed`, `run expired`,
  `repair triggered`, `summariser failed`, `terminal failure`, `terminal result`) carries `requestId`.
- Model and policy lines (chain-1b): OpenRouter's `model call` and the policy cache's `content policy check` carry it via an optional
  `ModelRequest.logger` / check logger; callers outside a request fall back to the module logger. The per-request cost resolver
  (`usage/resolve.ts#resolveRequestUsage`) emits no line; only the background `cost resolution sweep` logs, with no request id.

## Phone (chain-4 implements)

`requestId?: string` on the client error (`GenerationClientError`) and on each successful result (clarify,
rewrite, report, generate stream open), read from `x-whim-request-id` on success and failure. Optional: a network
failure or a server without the header has none.

## Interim phone rules (chain-4 revises)

`src/host/launcher/service-refusal.ts` `REFUSAL_RULES`: `update_required` and `consent_required` are both
`{ landing: 'sender', tone: 'neutral' }`, and both are in `SENDER_LANDING_CODES`
(`src/host/launcher/test/refusal-landing.suite.ts`). Chain-4 task 4.3 routes them to the update and consent screens.
