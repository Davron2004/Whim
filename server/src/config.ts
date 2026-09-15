/**
 * server/src/config.ts — the ONE typed, frozen loader for every server-controlled environment
 * variable (design D8, D16; specs/server-admission-control "Admission limits are
 * environment-configurable", specs/server-deployment "Production configuration refuses
 * dev-only modes"). Nothing else in `server/src/` SHALL read `process.env` for a value this
 * module already loads — callers take a `ServerConfig` instead.
 *
 * `loadServerConfig` is pure: it takes the environment as data (never reads `process.env`
 * itself) and returns a frozen `ServerConfig`, or throws `ServerConfigError` naming the first
 * offending variable. `opts.now` overrides the clock `ServerConfig.now` carries forward for the
 * UTC-day arithmetic admission and the ledger need (spec: "The time source used for UTC-day
 * arithmetic SHALL be injectable") — it does not affect parsing.
 */

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly serverHost: string;
  readonly serverPort: number;
  readonly dataDir: string;
  /** `'stub'` selects the no-spend UI pipeline; anything else (including unset) is the real one. */
  readonly pipeline: 'real' | 'stub';
  readonly devLogSink: boolean;
  readonly devLogFile: string;
  readonly logLevel: string;
  readonly logJson: boolean;
  /** Absent outside production (a stub-mode server can run with no key). */
  readonly openRouterApiKey: string | undefined;
  readonly rewriteModel: string | undefined;
  readonly engineerModel: string | undefined;

  readonly limitGenerationsPerDeviceDay: number;
  readonly limitGenerationsPerDay: number;
  readonly maxConcurrentGenerations: number;
  readonly synthrunConcurrency: number;
  readonly limitClarifyPerDeviceDay: number;
  readonly limitRewritePerDeviceDay: number;
  /** ONE global daily ceiling shared by `/v1/clarify` and `/v1/rewrite` together — the per-device
   *  limits above cannot bound spend on their own, because a client can mint a fresh device id per
   *  request. Counted across both kinds, so the pair can never exceed this many admissions a day. */
  readonly limitUnaryPerDay: number;
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
  /** A non-negative decimal USD amount — the one limit that is NOT a positive integer. */
  readonly minCreditUsd: number;
  readonly creditCacheTtlMs: number;

  readonly policyTimeoutMs: number;
  readonly reportRetentionDays: number;
  readonly ledgerRetentionDays: number;
  readonly drainTimeoutMs: number;

  /** Injectable clock for UTC-day arithmetic (admission, the usage ledger). Defaults to
   *  `Date.now`; override via `loadServerConfig`'s `opts.now`. */
  readonly now: () => number;
}

/** Thrown by `loadServerConfig` naming the exact offending variable — never a batch of unrelated
 *  failures, so a caller (or an operator reading boot output) fixes one thing and re-runs. */
export class ServerConfigError extends Error {
  constructor(
    public readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ServerConfigError(name, `${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

function readNonNegativeDecimal(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ServerConfigError(name, `${name} must be a non-negative decimal USD amount, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

function readFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] === '1';
}

function readString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return env[name] ?? fallback;
}

export function loadServerConfig(env: NodeJS.ProcessEnv, opts?: { now?: () => number }): ServerConfig {
  const nodeEnv = readString(env, 'NODE_ENV', 'development');
  const pipeline: ServerConfig['pipeline'] = env.WHIM_PIPELINE === 'stub' ? 'stub' : 'real';
  const devLogSink = readFlag(env, 'WHIM_DEV_LOG_SINK');
  const openRouterApiKey = env.OPENROUTER_API_KEY;
  const rewriteModel = env.WHIM_REWRITE_MODEL;
  const engineerModel = env.WHIM_ENGINEER_MODEL;

  const generationMaxMs = readPositiveInt(env, 'WHIM_GENERATION_MAX_MS', 600_000);

  const config: ServerConfig = {
    nodeEnv,
    serverHost: readString(env, 'WHIM_SERVER_HOST', '0.0.0.0'),
    serverPort: readPositiveInt(env, 'WHIM_SERVER_PORT', 8787),
    dataDir: readString(env, 'WHIM_DATA_DIR', 'server/.data'),
    pipeline,
    devLogSink,
    devLogFile: readString(env, 'WHIM_DEV_LOG_FILE', 'server/.logs/device.jsonl'),
    logLevel: readString(env, 'WHIM_LOG_LEVEL', 'info'),
    logJson: readFlag(env, 'WHIM_LOG_JSON'),
    openRouterApiKey,
    rewriteModel,
    engineerModel,

    limitGenerationsPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY', 15),
    limitGenerationsPerDay: readPositiveInt(env, 'WHIM_LIMIT_GENERATIONS_PER_DAY', 400),
    maxConcurrentGenerations: readPositiveInt(env, 'WHIM_MAX_CONCURRENT_GENERATIONS', 3),
    synthrunConcurrency: readPositiveInt(env, 'WHIM_SYNTHRUN_CONCURRENCY', 2),
    limitClarifyPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY', 60),
    limitRewritePerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_REWRITE_PER_DEVICE_DAY', 60),
    limitUnaryPerDay: readPositiveInt(env, 'WHIM_LIMIT_UNARY_PER_DAY', 2000),
    maxConcurrentUnary: readPositiveInt(env, 'WHIM_MAX_CONCURRENT_UNARY', 16),
    limitReportsPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_REPORTS_PER_DEVICE_DAY', 10),
    limitReportsPerDay: readPositiveInt(env, 'WHIM_LIMIT_REPORTS_PER_DAY', 300),
    maxBodyBytesUnary: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_UNARY', 65_536),
    maxBodyBytesGenerate: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_GENERATE', 1_048_576),
    maxBodyBytesReport: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_REPORT', 524_288),
    maxPromptBytes: readPositiveInt(env, 'WHIM_MAX_PROMPT_BYTES', 16_384),
    maxReportSourceBytes: readPositiveInt(env, 'WHIM_MAX_REPORT_SOURCE_BYTES', 262_144),
    unaryModelTimeoutMs: readPositiveInt(env, 'WHIM_UNARY_MODEL_TIMEOUT_MS', 60_000),
    generationMaxMs,
    minCreditUsd: readNonNegativeDecimal(env, 'WHIM_MIN_CREDIT_USD', 0.5),
    creditCacheTtlMs: readPositiveInt(env, 'WHIM_CREDIT_CACHE_TTL_MS', 60_000),

    policyTimeoutMs: readPositiveInt(env, 'WHIM_POLICY_TIMEOUT_MS', 10_000),
    reportRetentionDays: readPositiveInt(env, 'WHIM_REPORT_RETENTION_DAYS', 90),
    ledgerRetentionDays: readPositiveInt(env, 'WHIM_LEDGER_RETENTION_DAYS', 90),
    drainTimeoutMs: readPositiveInt(env, 'WHIM_DRAIN_TIMEOUT_MS', generationMaxMs + 30_000),

    now: opts?.now ?? Date.now,
  };

  if (nodeEnv === 'production') {
    if (config.devLogSink) {
      throw new ServerConfigError('WHIM_DEV_LOG_SINK', 'WHIM_DEV_LOG_SINK cannot be enabled in production.');
    }
    if (config.pipeline === 'stub') {
      throw new ServerConfigError('WHIM_PIPELINE', 'WHIM_PIPELINE=stub cannot run in production.');
    }
    if (!config.openRouterApiKey) {
      throw new ServerConfigError('OPENROUTER_API_KEY', 'OPENROUTER_API_KEY is required in production.');
    }
    if (!config.rewriteModel) {
      throw new ServerConfigError('WHIM_REWRITE_MODEL', 'WHIM_REWRITE_MODEL is required in production.');
    }
    if (!config.engineerModel) {
      throw new ServerConfigError('WHIM_ENGINEER_MODEL', 'WHIM_ENGINEER_MODEL is required in production.');
    }
  }

  return Object.freeze(config);
}
