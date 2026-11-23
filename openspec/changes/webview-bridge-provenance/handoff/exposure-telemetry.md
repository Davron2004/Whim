# Contract: exposure-telemetry (chain-6, writes → group 5 device runs, reviewer)

Interface only. Sources: `contract/src/index.ts` (`DiagnosticRecord`), `src/host/logging/diagnostic.ts`
(projection), `src/host/logging/diagnostics.ts` (dedupe), `src/host/launcher/runtime-channel.ts#onExposure`.

## 1. The record exactly as uploaded

One `info`-level record per distinct result, inside the usual `POST /v1/diagnostics` batch
(`{ osVersion, records }`; device id only in `x-whim-device`):

```json
{ "at": 1790000000000, "level": "info", "channel": "whim", "message": "bridge-exposure",
  "exposure": "navigated:android+canary", "webview": "chrome-131", "count": 4 }
```

- Exactly these seven keys. No token, URL, app id, `surface`, `canaryReachedNative`, mini-app data.
- `exposure` grammar: `refused` | `timed-out` | `navigated:<none|android|ios|android+ios>[+canary]`
  (`exposureCode(record)`, chain-3). `webview`: `/^(?:chrome-\d{1,4}|webkit)$/`.
- `count`: occurrences since the previous flush (as every record).

```ts
// src/host/logging/diagnostic.ts
export const BRIDGE_EXPOSURE_MESSAGE = 'bridge-exposure';
export function bridgeExposureDiagnostic(at: number, exposure: string, webview: string | null): DiagnosticRecord | null;
// null when webview is null (the page's 'unknown') or either value is off its grammar → not uploaded
export const DIAGNOSTIC_FIELDS: readonly [..., 'stack', 'exposure', 'webview'];
```

- `toDiagnostic`: a record that is `info` + channel `whim` + message `bridge-exposure` projects to the
  four base fields plus `exposure`/`webview` (each only when in grammar) and nothing else; every other
  record drops `exposure`/`webview`.
- `isDiagnosticRecord` (fatal slot): `exposure`/`webview` valid only on that record, both in grammar.
- Server (`DiagnosticRecord`, `.strict()` + refine): `exposure`/`webview` are optional, grammar-checked,
  and must travel together on `level: 'info'`, `message: 'bridge-exposure'`; otherwise `400 invalid_request`.
  Each accepted record is one pino line (`scope: device`) at info, with `exposure`, `webview`, `count`.

## 2. Where it is queued

```ts
// runtime-channel.ts — every runtime WebView's hooks.exposure
export function onExposure(record: ExposureRecord, surface: RuntimeSurface): void;
// log.info('whim', 'bridge-exposure', { exposure, webview: webview ?? 'unknown', canaryReachedNative, surface })
// then: bridgeExposureDiagnostic(Date.now(), exposureCode(record), record.webview) → log.diagnostics.enqueueDiagnostic
```

The `info` log record itself is never uploaded (the seam's transport takes `error` only).

## 3. Dedupe key (per app session, `DiagnosticsTransport`)

- Bridge-exposure record (any record carrying `exposure`): `['exposure', message, exposure, webview]`.
- Every other record: `[channel, message, errorClass, where]` (unchanged).
- A changed result (other code, other engine, or a canary arriving after the report → `+canary`) is
  its own record; repeats bump `count`. Shares the 50-distinct session cap with error records.

## 4. Gate

`diagnosticsTarget(kv, appInfo)` (`src/host/launcher/diagnostics-target.ts`), unchanged: terms accepted,
current AI-data grant, "Send error details" on. Asked at enqueue and before each POST; a result recorded
while the answer is no is discarded, never queued. `AI_CONSENT_VERSION` stays 2; `diffManifests` empty.

## 5. Copy changed (`src/host/launcher/copy.ts`; mirrored verbatim in `deploy/site/{,fr/}privacy.html`)

| key | old | new |
|---|---|---|
| `consentSentErrors` en | Error details when something goes wrong. They’re technical only, not what you typed or saved. | Error details and automatic app safety checks. Technical only, never what you typed or saved. |
| `consentSentErrors` fr | Des détails d’erreur quand quelque chose ne va pas. Ils sont uniquement techniques, jamais ce que vous avez tapé ou enregistré. | Des détails d’erreur et des contrôles de sécurité automatiques. Uniquement techniques, jamais ce que vous tapez ou enregistrez. |
| `firstRunSentErrors` en | Error details if something goes wrong. | Error details and app safety checks. |
| `firstRunSentErrors` fr | Des détails d’erreur quand quelque chose ne va pas. | Des détails d’erreur et des contrôles de sécurité. |
| `settingsErrorDetailsHint` en (no fr key) | When something goes wrong, Whim sends technical details so we can fix it. Not what you typed or saved. | Whim sends error details and app safety check results so we can fix problems. Never what you typed or saved. |

Lengths (chars, old → new): 93→93, 127→126, 38→36, 51→50, 102→108.

Manifest v2 `error-details` row description (not compared by `diffManifests`; `released/v2.json` frozen):
old `Technical details when something breaks: versions, error type from a fixed list, code location, screen and request number`
new `Technical details when something breaks (versions, error type from a fixed list, code location, screen and request number), and the results of automatic safety checks of how the phone runs apps`

Privacy pages, `error-details` row: What adds the safety-check results; When adds "and after its
automatic safety checks"; Why adds ", including security problems" (fr equivalents). Last updated
2026-11-22, with a changes-list line in each language.
