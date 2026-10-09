# client-refusals-and-report-transport (chain-2)

All below live under `src/host/launcher/`, none imports React Native.

## `contract-mirror.ts` — temporary, until `public-generation-server` chain-1 lands

`public-generation-server`'s `ServiceRefusalCode`/`ReportReason`/`ReportRequest`/`ReportResponse`
are **not yet in `contract/src/index.ts`** on this branch. This module mirrors them byte-for-byte
from `openspec/changes/public-generation-server/specs/generation-contract/spec.md`, as real zod
values (safe here only because this module is never imported as a VALUE from RN-reachable code —
see its own doc comment). **Downstream chains: import these four names type-only from
`./contract-mirror`, not from `@whim/contract`, until that change lands; the dispatcher will
reconcile the switch at merge.**

## `transport-shared.ts` additions

```ts
export class GenerationClientError extends Error {
  readonly kind: 'network' | 'device_id' | 'http' | 'stream_parse';
  readonly status?: number;
  readonly hint?: string;
  readonly code?: string;              // ApiError.error, only when the body structurally validates as ApiError
  readonly retryAfterSeconds?: number; // positive integer only; absent for missing/zero/negative/non-integer
}

export type ConsentedClientOptions = ClientOptions & { readonly [brand]: true }; // brand is an unexported unique symbol
export function consentedClientOptions(status: ConsentStatus, baseUrl: string, deviceId: string): ConsentedClientOptions | null;
// null unless status.kind === 'granted'. The ONLY constructor — nothing else can produce one.
```

`httpErrorFrom` fills `code`/`retryAfterSeconds` identically on the fetch and XHR paths (XHR via
`xhr-transport.ts#finishHttpError`'s fake-`Response` adapter, which forwards
`headers.get(name)` to `xhr.getResponseHeader(name)`). `retryAfterSecondsOf` reads
`response.headers?.get('Retry-After')` — optional-chained, so a Response-shaped test double with
no `headers` at all reads as "missing", never throws.

## `generation-client.ts` changes

- `clarifyPrompt`, `rewritePrompt`, `generateApp` now take `opts: ConsentedClientOptions` (was
  `ClientOptions`). Re-exports `consentedClientOptions`/`ConsentedClientOptions` alongside the
  existing `GenerationClientError`/`ClientOptions` re-export.
- New: `sendReport(opts: ClientOptions, body: ReportRequest, signal?): Promise<ReportResponse>` —
  **takes plain `ClientOptions`, the deliberate consent exception (design D3).** `POST /v1/report`
  with `requestHeaders`; `202` body validated structurally (non-empty `reportId`); non-2xx throws
  through `httpErrorFrom` (so a report refusal carries `code`/`retryAfterSeconds` like any other);
  a thrown fetch failure raises `kind:'network'`.

**LauncherRoot.tsx bridge (temporary, chain-3 replaces it — task 3.4):** its `clientOptions` memo
is now typed `ConsentedClientOptions | null` via an `as ConsentedClientOptions` cast on the same
`{ baseUrl, deviceId }` object it always built; NO consent gating exists yet. Chain-3 must replace
the memo body with `consentedClientOptions(consentStatus(kv), effectiveServerUrl(kv), deviceId)`
and can then drop the cast.

## `service-refusal.ts`

```ts
export interface RefusalRule { readonly landing: 'text' | 'sender'; readonly tone: 'danger' | 'neutral'; }
export const REFUSAL_RULES: { readonly [K in ServiceRefusalCode]: RefusalRule }; // all 7 codes, see design D8 table

export interface ServiceRefusal {
  readonly code: ServiceRefusalCode;
  readonly hint: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}
export function serviceRefusalOf(err: unknown): ServiceRefusal | undefined;
// true only for a GenerationClientError{kind:'http'} whose .code is an OWN key of REFUSAL_RULES
// and whose .hint is non-empty. Never matches on status or hint text.

export function retryAtOf(refusal: ServiceRefusal, receivedAt: number): number | undefined;
// receivedAt + retryAfterSeconds*1000, or undefined with no window.
export function retryLine(retryAt: number, now: number, formatTime: (date: Date) => string): string;
// "in about N seconds" (<1min) | "in about N minutes" (<1hr) | "after <time>" (same local day) |
// "tomorrow after <time>" (later) | "in about N hours" (Intl missing entirely, checked via
// `typeof Intl === 'undefined'`). formatTime is caller-injected (an Intl.DateTimeFormat time
// formatter in production); this function is otherwise pure.
```

`ServiceRefusalCode` is imported type-only from `./contract-mirror`.

## `report-payload.ts`

```ts
export interface ReportDraft {
  readonly reason: ReportReason | null;
  readonly note: string;               // as typed; buildReportRequest trims/cuts it
  readonly appName: string;
  readonly prompt?: string;
  readonly promptIncluded: boolean;    // switch state, default true
  readonly source?: string;
  readonly sourceIncluded: boolean;    // switch state, default true
}

export function buildReportRequest(draft: ReportDraft): ReportRequest | null;
// null iff draft.reason === null. note: trimmed, omitted if empty, cut to 1000. appName: cut to
// 200 (always present). prompt/source: omitted when switched off OR absent (same outcome either way).

export interface ReportPreviewRow { readonly field: 'reason'|'note'|'appName'|'prompt'|'source'; readonly value: string; }
export function reportPreview(request: ReportRequest): readonly ReportPreviewRow[];
// one row per key the REQUEST carries (not the draft) — a row's value is byte-identical to the
// posted body's same-named field, by construction (both read the same ReportRequest).

export interface ReportLogFields {
  readonly reason: ReportReason;
  readonly promptBytes?: number;  // UTF-8 byte length, present only when request.prompt is
  readonly sourceBytes?: number;  // UTF-8 byte length, present only when request.source is
  readonly outcome: string;       // caller-supplied: a status class or a ServiceRefusalCode
}
export function reportLogFields(request: ReportRequest, outcome: string): ReportLogFields;
// NEVER carries note/prompt/source/appName text — sizes only.

export function reportDraftFor(entry: InstalledApp, access: StoreAccess): Promise<ReportDraft>;
// appName = entry.name; prompt/source = access.activeDescription/activeSource(entry); both
// switches start true, reason starts null.
```

## `src/host/logging/redact.ts`

`SENSITIVE_FIELD_NAMES` gained a report-note-text family: `note`, `reportnote`, `report_note`,
`notetext` — a field named `note` in any log call's structured fields now redacts.
