# handoff/server-diagnostics.md — chain-2 (server diagnostics route, ledger failure code); read by chain-4, chain-6, chain-8

## `@whim/contract` (`contract/src/index.ts`)

```ts
export const DIAGNOSTICS_MAX_BODY_BYTES = 32 * 1024;

const DiagnosticString = z.string().max(128);
const DiagnosticValue = z.union([DiagnosticString, z.number().finite()]);

export const DiagnosticRecord = z
  .object({
    at: z.number().finite(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    channel: DiagnosticString,
    message: DiagnosticString,
    screen: DiagnosticValue.optional(),
    errorClass: DiagnosticValue.optional(),
    where: DiagnosticValue.optional(),
    stage: DiagnosticValue.optional(),
    reason: DiagnosticValue.optional(),
    kind: DiagnosticValue.optional(),
    status: DiagnosticValue.optional(),
    errorCode: DiagnosticValue.optional(),
    domain: DiagnosticValue.optional(),
    readyState: DiagnosticValue.optional(),
    observedRepairAttempts: DiagnosticValue.optional(),
    requestId: DiagnosticValue.optional(),
    route: DiagnosticString.regex(/^\/[^?#]*$/).optional(),
    count: DiagnosticValue.optional(),
    stack: z.string().max(4096).optional(),
  })
  .strict();
export type DiagnosticRecord = z.infer<typeof DiagnosticRecord>;

export const DiagnosticsBatch = z
  .object({
    osVersion: DiagnosticString,
    records: z.array(DiagnosticRecord).min(1).max(50),
  })
  .strict();
export type DiagnosticsBatch = z.infer<typeof DiagnosticsBatch>;
```

- The device imports the TYPES only (`import type { DiagnosticsBatch, DiagnosticRecord }`); zod never
  enters Metro. Any cap the device needs as a value it keeps as its own literal.
- `.strict()` at both levels: any other key, on a record or beside `osVersion`/`records`, is a `400`, not
  dropped. The projection (`toDiagnostic`) must emit exactly these keys.
- Caps are characters: 128 for every string, 4096 for `stack`. `route` must start with `/` and carry no
  `?` or `#` (a full URL is refused). An empty batch is refused.
- No device id, platform, app version or build in the body: those travel in `x-whim-device` and the
  request-envelope headers.

## `POST /v1/diagnostics` (`server/src/routes/diagnostics.ts`)

Behind the `/v1` edge (request id, device gate, envelope, minimum-build gate), then in order:

| step | refusal | status | body `error` |
|---|---|---|---|
| consent practice `error-details`, **required** | consent `none`, `1`, or legacy (no envelope) | `403` | `consent_required` |
| raw body > `DIAGNOSTICS_MAX_BODY_BYTES` (32768; exactly 32768 is accepted) | | `413` | `payload_too_large` |
| not JSON, or fails `DiagnosticsBatch` (unknown key, over-long string, > 50 records) | | `400` | `invalid_request` |
| device's records today + this batch > `limitDiagnosticsPerDeviceDay` | | `429` + `Retry-After` | `daily_limit` |
| all records today + this batch > `limitDiagnosticsPerDay` | | `429` + `Retry-After` | `server_busy` |
| accepted | | `204`, empty body | |

- A batch is accepted or refused WHOLE; a refused batch logs no record and does not count against
  either allowance. `Retry-After` is the seconds until the next 00:00 UTC.
- Allowances are counted in records, held in process memory, and reset at UTC midnight (and on restart).
  Config: `WHIM_LIMIT_DIAGNOSTICS_PER_DEVICE_DAY` (default 200), `WHIM_LIMIT_DIAGNOSTICS_PER_DAY`
  (default 20000).
- Earlier `/v1` edge refusals (`400` device/envelope, `426` update_required) apply as on every route.
- Writes nothing to any database or file.

## Device log line (one per accepted record)

Emitted through the root logger's child `{ scope: 'device' }` at the record's own level
(`debug|info|warn|error`), with `msg` = the record's `message`:

```ts
{
  scope: 'device',
  platform, appVersion, build, consent,  // the request envelope (envelopeLogFields)
  osVersion,                             // the batch body
  at, channel,                           // the record
  ...allowlisted fields present on the record (screen, errorClass, …, requestId, route, count, stack),
  msg: record.message,
}
```

- NOT bound to the upload's request id: a record's own `requestId` is the id of the request the error is
  about (the one to query server lines by). The upload itself has its usual `scope: 'request'` line,
  which carries the upload's `requestId`.
- Never the device id.

## Ledger failure code (`server/src/usage-store.ts`)

```ts
// server/src/generation/failure-codes.ts
export const TERMINAL_FAILURE_CODES = ['plan_failed', 'repair_exhausted', 'containment_failed',
  'run_unverified', 'expired', 'credit_exhausted', 'internal_error'] as const;
export type TerminalFailureCode = (typeof TERMINAL_FAILURE_CODES)[number];

export type FailureReason = TerminalFailureCode | ServiceRefusalCode;
SettleParams.failureReason?: FailureReason;              // requests.failure_reason TEXT NULL
LedgerRow.failureReason: FailureReason | null;
UsageSummary.failureReasonCounts: Partial<Record<FailureReason, number>>;
RunTrace.failureCode?: TerminalFailureCode;              // set as the machine yields a failure terminal
```

- `settle` rejects (writes nothing) for a value outside both sets, or a reason beside `delivered`/`ok`.
- Set by: generate `failed`/`expired` (the run's code), `refused` → `content_policy`, `unavailable` →
  `policy_unavailable`, and clarify/rewrite mid-call `402` → `budget_exhausted`. Unary model failures
  (`502`) and admission throws stay null.
- `whim-admin usage` prints `Failure reasons: <code>=<n> …` (or `(none)`); `--json` has
  `failureReasonCounts`. `device export` rows carry `failureReason`.
