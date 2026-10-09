# wire-and-config (chain-1)

Wire shapes and config live in `contract/src/index.ts` and `server/src/config.ts`. Nothing here
is a diary — read the modules for comments/rationale.

## Contract additions (`@whim/contract`)

```ts
export const ReportReason = z.enum(['offensive', 'harmful', 'broken', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

export const ReportRequest = z.object({
  reason: ReportReason,
  note: z.string().max(1000).optional(),
  appName: z.string().max(200).optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const ReportResponse = z.object({ reportId: z.string().min(1) });
export type ReportResponse = z.infer<typeof ReportResponse>;

export const ServiceRefusalCode = z.enum([
  'payload_too_large', 'daily_limit', 'device_busy', 'server_busy',
  'content_policy', 'policy_unavailable', 'budget_exhausted',
]);
export type ServiceRefusalCode = z.infer<typeof ServiceRefusalCode>;
```

`ApiError` is unchanged (`{ error: string; hint: string }`, `hint` non-empty). Every refusal body
validates as `ApiError` with `error` a `ServiceRefusalCode` member.

## `server/src/config.ts`

```ts
export interface ServerConfig {
  readonly nodeEnv: string;
  readonly serverHost: string;
  readonly serverPort: number;
  readonly dataDir: string;
  readonly pipeline: 'real' | 'stub';
  readonly devLogSink: boolean;
  readonly devLogFile: string;
  readonly logLevel: string;
  readonly logJson: boolean;
  readonly openRouterApiKey: string | undefined;
  readonly rewriteModel: string | undefined;
  readonly engineerModel: string | undefined;

  readonly limitGenerationsPerDeviceDay: number;
  readonly limitGenerationsPerDay: number;
  readonly maxConcurrentGenerations: number;
  readonly synthrunConcurrency: number;
  readonly limitClarifyPerDeviceDay: number;
  readonly limitRewritePerDeviceDay: number;
  readonly maxConcurrentUnary: number;
  readonly limitReportsPerDeviceDay: number;
  readonly limitReportsPerDay: number;
  readonly maxBodyBytesUnary: number;
  readonly maxBodyBytesGenerate: number;
  readonly maxBodyBytesReport: number;
  readonly maxPromptBytes: number;
  readonly maxReportSourceBytes: number;
  readonly unaryModelTimeoutMs: number;
  readonly generationMaxMs: number;
  readonly minCreditUsd: number;       // non-negative decimal, default 0.50 — NOT a positive int
  readonly creditCacheTtlMs: number;   // default 60000

  readonly policyTimeoutMs: number;        // default 10000
  readonly reportRetentionDays: number;    // default 90
  readonly ledgerRetentionDays: number;    // default 90
  readonly drainTimeoutMs: number;         // default generationMaxMs + 30000

  readonly now: () => number;  // injectable clock for UTC-day arithmetic; defaults to Date.now
}

export class ServerConfigError extends Error {
  constructor(public readonly variable: string, message: string);
}

export function loadServerConfig(
  env: NodeJS.ProcessEnv,
  opts?: { now?: () => number },
): ServerConfig; // pure; throws ServerConfigError naming the FIRST invalid variable; returns Object.freeze(...)
```

Every other variable in specs/server-admission-control's table (`WHIM_LIMIT_*`,
`WHIM_MAX_*`, `WHIM_SYNTHRUN_CONCURRENCY`, `WHIM_UNARY_MODEL_TIMEOUT_MS`,
`WHIM_GENERATION_MAX_MS`) validates as a positive integer and defaults per that table.
`WHIM_SERVER_HOST` defaults `'0.0.0.0'`, `WHIM_SERVER_PORT` defaults `8787`, `WHIM_DATA_DIR`
defaults `'server/.data'`, `WHIM_DEV_LOG_FILE` defaults `'server/.logs/device.jsonl'`,
`WHIM_LOG_LEVEL` defaults `'info'`. `WHIM_PIPELINE`/`WHIM_DEV_LOG_SINK`/`WHIM_LOG_JSON` read as
`'stub'`/`'1'` flags exactly like the existing `main.ts`/`logger.ts` reads they will replace.

**Production refusals** (`nodeEnv === 'production'`, on top of universal numeric validation):
`WHIM_DEV_LOG_SINK` enabled, `WHIM_PIPELINE=stub`, or a missing `OPENROUTER_API_KEY` /
`WHIM_REWRITE_MODEL` / `WHIM_ENGINEER_MODEL` each throw `ServerConfigError` naming that variable.
Outside production none of the three are required.

## Suite-module ownership map (`server/test/acceptance.ts`, edited only by chain-1)

| Module | Owning chain |
|---|---|
| `contract.suite.ts` | pre-existing (chain-0/this chain extends it) |
| `config.suite.ts` | chain-1 (this chain) |
| `ledger.suite.ts`, `resolver.suite.ts` | chain-2 |
| `admission.suite.ts` | chain-3 |
| `policy.suite.ts` | chain-4 |
| `reports.suite.ts`, `admin.suite.ts` | chain-5 |
| `routes-unary.suite.ts` | chain-9 |
| `routes-generate.suite.ts`, `disconnect.suite.ts` | chain-10 |
| `prod-build.suite.ts` | chain-11 |
| `deploy-config.suite.ts` | chain-12 |

Each scaffolded module exports `async function run<Name>Tests(): Promise<void>` (already
imported and awaited, in this order, in `acceptance.ts`) with only a `section(...)` call — the
owning chain edits ONLY its own file, never `acceptance.ts`.
