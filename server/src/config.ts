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
 *
 * Every keep-period is capped by the current disclosure manifest (legal-surface-v2 D9,
 * specs/device-records "A configured keep-period never exceeds its published maximum"): a value
 * above its category's published maximum refuses to load, naming the variable and the maximum.
 * `server/config-check.mjs` runs this same parse for `deploy/deploy.sh`.
 */
import { MANIFESTS, keepLimit, latestVersion, type CategoryId } from '../../contract/src/disclosure-manifest';
import type { ProviderQuantization, ProviderRouting, ProviderSort } from './openrouter';

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly serverHost: string;
  readonly serverPort: number;
  readonly dataDir: string;
  /** `'stub'` selects the no-spend UI pipeline; anything else (including unset) is the real one. */
  readonly pipeline: 'real' | 'stub';
  /** `WHIM_STUB_DELAY_MS`: how long the stub pipeline waits before each event it emits (default
   *  200), so a device test can make a stub build slow enough to line others up behind it.
   *  Stub-only: set without `WHIM_PIPELINE=stub`, which production refuses, it refuses to load. */
  readonly stubDelayMs: number;
  readonly devLogSink: boolean;
  readonly devLogFile: string;
  readonly logLevel: string;
  readonly logJson: boolean;
  /** Absent outside production (a stub-mode server can run with no key). */
  readonly openRouterApiKey: string | undefined;
  readonly rewriteModel: string | undefined;
  readonly engineerModel: string | undefined;
  /** `WHIM_PROVIDER_SORT` (design D3) — unset means no `provider.sort` on any request. */
  readonly providerSort: ProviderSort | undefined;
  /** `WHIM_PROVIDER_QUANTIZATIONS` (beta-1 D12) — the quantizations OpenRouter may route to; unset
   *  means no `provider.quantizations` on any request. */
  readonly providerQuantizations: readonly ProviderQuantization[] | undefined;
  readonly limitGenerationsPerDeviceDay: number;
  readonly limitGenerationsPerDay: number;
  readonly maxConcurrentGenerations: number;
  /** `WHIM_QUEUE_MAX` (beta-1 D8): how many generations may wait in line for a slot. `0` means no
   *  line: a generation that finds every slot busy is refused `server_busy` at once. */
  readonly queueMax: number;
  /** `WHIM_QUEUE_MAX_WAIT_MS` (beta-1 D8): how long a generation may wait in line before its stream
   *  ends in a `failure`. */
  readonly queueMaxWaitMs: number;
  readonly synthrunConcurrency: number;
  readonly limitClarifyPerDeviceDay: number;
  readonly limitRewritePerDeviceDay: number;
  /** ONE global daily ceiling shared by `/v1/clarify` and `/v1/rewrite` together — the per-device
   *  limits above cannot bound spend on their own, because a client can mint a fresh device id per
   *  request. Counted across both kinds, so the pair can never exceed this many admissions a day. */
  readonly limitUnaryPerDay: number;
  readonly maxConcurrentUnary: number;
  /** The `/healthz/sse` probe pool — anonymous, tiny, and never the unary pool. */
  readonly maxConcurrentProbes: number;
  readonly limitReportsPerDeviceDay: number;
  readonly limitReportsPerDay: number;
  /** `POST /v1/diagnostics`: records one device may send per UTC day, and records every device
   *  together may send per UTC day (developer-observability D4). */
  readonly limitDiagnosticsPerDeviceDay: number;
  readonly limitDiagnosticsPerDay: number;
  readonly maxBodyBytesUnary: number;
  readonly maxBodyBytesGenerate: number;
  readonly maxBodyBytesReport: number;
  readonly maxPromptBytes: number;
  readonly maxReportSourceBytes: number;
  /** `POST /beta/signup` (beta-waitlist D3): the body cap, the signups one client address may make
   *  in a sliding hour, and the signups everyone together may make per UTC day. */
  readonly maxBodyBytesBeta: number;
  readonly betaLimitPerClientHour: number;
  readonly betaLimitPerDay: number;
  /** `WHIM_WEB_ORIGIN`: the pages site's origin, which the signup route redirects to (`https://`
   *  + `WHIM_WEB_HOST` on the VM). Required in production; a local default elsewhere. */
  readonly webOrigin: string;
  readonly unaryModelTimeoutMs: number;
  readonly generationMaxMs: number;
  /** A non-negative decimal USD amount — the one limit that is NOT a positive integer. */
  readonly minCreditUsd: number;
  readonly creditCacheTtlMs: number;

  readonly policyTimeoutMs: number;
  readonly reportRetentionDays: number;
  readonly ledgerRetentionDays: number;
  /** `WHIM_USAGE_IDLE_DAYS`: a lifetime usage row not credited for more than this many days is
   *  purged (specs/device-records). */
  readonly usageIdleDays: number;
  readonly drainTimeoutMs: number;

  /** The lowest build each platform may use `/v1` with (`WHIM_MIN_BUILD_IOS`/`_ANDROID`,
   *  app-update-gate). `0`, the default, turns the gate off for that platform. */
  readonly minBuildIos: number;
  readonly minBuildAndroid: number;

  /** `WHIM_COMMIT`: the full git SHA the image was built from, baked in by `deploy/Dockerfile`'s
   *  build arg (developer-observability D13), or `"unknown"` for any other build. */
  readonly commit: string;

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

function readNonNegativeInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0) {
    throw new ServerConfigError(name, `${name} must be a non-negative integer, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

/** Each keep-period variable and the manifest category whose published maximum caps it. Server log
 *  retention is not here because the server sets none: Docker's size-rotated log files hold it. */
const KEEP_PERIOD_CATEGORIES = {
  WHIM_REPORT_RETENTION_DAYS: 'reports',
  WHIM_LEDGER_RETENTION_DAYS: 'usage-records',
  WHIM_USAGE_IDLE_DAYS: 'usage-records',
} as const satisfies Readonly<Record<string, CategoryId>>;

type KeepPeriodVariable = keyof typeof KEEP_PERIOD_CATEGORIES;

/** Every environment variable that sets a keep-period. */
export const KEEP_PERIOD_VARIABLES = Object.keys(KEEP_PERIOD_CATEGORIES) as readonly KeepPeriodVariable[];

/** A positive number of days, no more than the current manifest publishes for the variable's
 *  category. A category the manifest does not keep has a maximum of 0, so any value refuses. */
function readKeepPeriod(env: NodeJS.ProcessEnv, name: KeepPeriodVariable, fallback: number): number {
  const days = readPositiveInt(env, name, fallback);
  const category = KEEP_PERIOD_CATEGORIES[name];
  const version = latestVersion();
  const maximum = keepLimit(MANIFESTS[version], category)?.days ?? 0;
  if (days > maximum) {
    const source = env[name] === undefined ? ' (its default)' : '';
    throw new ServerConfigError(
      name,
      `${name} is ${days} days${source}, above the ${maximum}-day maximum disclosure manifest version ${version} publishes for ${category}.`,
    );
  }
  return days;
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

/** `0` or a build number in the envelope's own range (`x-whim-build`: up to 15 digits, no leading
 *  zero). Stricter than `Number()`, which would read an empty value as `0` and turn the gate off
 *  without a word. */
const BUILD_NUMBER = /^(0|[1-9]\d{0,14})$/;

function readMinimumBuild(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  if (raw === undefined) return 0;
  if (!BUILD_NUMBER.test(raw)) {
    throw new ServerConfigError(name, `${name} must be 0 or a positive integer build number, got ${JSON.stringify(raw)}.`);
  }
  return Number(raw);
}

/** A full git commit SHA, as Cloud Build's `$COMMIT_SHA` gives it. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** Unset, or the Dockerfile's own default, is `"unknown"`: an image the release pipeline didn't
 *  build. Anything else must be a full SHA, so `/healthz` never names a commit it can't prove. */
function readCommit(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw === 'unknown') return 'unknown';
  if (!COMMIT_SHA.test(raw)) {
    throw new ServerConfigError(name, `${name} must be a full 40-character lowercase git commit SHA or "unknown", got ${JSON.stringify(raw)}.`);
  }
  return raw;
}

/** `WHIM_STUB_DELAY_MS`, 200 when unset. Only the stub pipeline reads it, so it refuses to load
 *  without `WHIM_PIPELINE=stub`, which production refuses in turn. */
function readStubDelay(env: NodeJS.ProcessEnv, pipeline: ServerConfig['pipeline']): number {
  if (env.WHIM_STUB_DELAY_MS !== undefined && pipeline !== 'stub') {
    throw new ServerConfigError('WHIM_STUB_DELAY_MS', 'WHIM_STUB_DELAY_MS only applies with WHIM_PIPELINE=stub.');
  }
  return readNonNegativeInt(env, 'WHIM_STUB_DELAY_MS', 200);
}

function readFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] === '1';
}

function readString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return env[name] ?? fallback;
}

/** An origin and nothing more (no path, no trailing slash), over https — or http outside
 *  production, for a local pages preview. */
function readWebOrigin(env: NodeJS.ProcessEnv, name: string, production: boolean): string {
  const raw = env[name];
  if (raw === undefined || raw === '') return 'http://localhost:8080';
  const url = URL.canParse(raw) ? new URL(raw) : undefined;
  const schemeAllowed = url?.protocol === 'https:' || (!production && url?.protocol === 'http:');
  if (!schemeAllowed || url?.origin !== raw) {
    throw new ServerConfigError(name, `${name} must be an origin such as https://example.com, with no path, got ${JSON.stringify(raw)}.`);
  }
  return raw;
}

const PROVIDER_SORTS: readonly ProviderSort[] = ['price', 'throughput', 'latency'];

/** `WHIM_PROVIDER_SORT` (design D3): unset (or empty) means no provider preference; any other
 *  value fails configuration loading naming the variable and the allowed values. */
function readProviderSort(env: NodeJS.ProcessEnv, name: string): ProviderSort | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!(PROVIDER_SORTS as readonly string[]).includes(raw)) {
    throw new ServerConfigError(name, `${name} must be one of ${PROVIDER_SORTS.join(', ')}, got ${JSON.stringify(raw)}.`);
  }
  return raw as ProviderSort;
}

const PROVIDER_QUANTIZATIONS: readonly ProviderQuantization[] = ['int4', 'int8', 'fp4', 'fp6', 'fp8', 'fp16', 'bf16', 'fp32', 'unknown'];

/** `WHIM_PROVIDER_QUANTIZATIONS` (beta-1 D12): a comma-separated list of OpenRouter quantization
 *  names, entries trimmed and empty ones dropped. Unset or empty means no preference; a name outside
 *  OpenRouter's set fails configuration loading naming the variable and the allowed values. */
function readProviderQuantizations(env: NodeJS.ProcessEnv, name: string): readonly ProviderQuantization[] | undefined {
  const entries = (env[name] ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  if (entries.length === 0) return undefined;
  const unknown = entries.find((entry) => !(PROVIDER_QUANTIZATIONS as readonly string[]).includes(entry));
  if (unknown !== undefined) {
    throw new ServerConfigError(name, `${name} entries must each be one of ${PROVIDER_QUANTIZATIONS.join(', ')}, got ${JSON.stringify(unknown)}.`);
  }
  return Object.freeze(entries as ProviderQuantization[]);
}

/** The provider routing the composition root hands the OpenRouter client (design D3, beta-1 D12). */
export function providerRouting(config: Pick<ServerConfig, 'providerSort' | 'providerQuantizations'>): ProviderRouting {
  return { sort: config.providerSort, quantizations: config.providerQuantizations };
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
    stubDelayMs: readStubDelay(env, pipeline),
    devLogSink,
    devLogFile: readString(env, 'WHIM_DEV_LOG_FILE', 'server/.logs/device.jsonl'),
    logLevel: readString(env, 'WHIM_LOG_LEVEL', 'info'),
    logJson: readFlag(env, 'WHIM_LOG_JSON'),
    openRouterApiKey,
    rewriteModel,
    engineerModel,
    providerSort: readProviderSort(env, 'WHIM_PROVIDER_SORT'),
    providerQuantizations: readProviderQuantizations(env, 'WHIM_PROVIDER_QUANTIZATIONS'),
    limitGenerationsPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY', 15),
    limitGenerationsPerDay: readPositiveInt(env, 'WHIM_LIMIT_GENERATIONS_PER_DAY', 400),
    maxConcurrentGenerations: readPositiveInt(env, 'WHIM_MAX_CONCURRENT_GENERATIONS', 5),
    queueMax: readNonNegativeInt(env, 'WHIM_QUEUE_MAX', 50),
    queueMaxWaitMs: readPositiveInt(env, 'WHIM_QUEUE_MAX_WAIT_MS', 180_000),
    synthrunConcurrency: readPositiveInt(env, 'WHIM_SYNTHRUN_CONCURRENCY', 2),
    limitClarifyPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY', 60),
    limitRewritePerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_REWRITE_PER_DEVICE_DAY', 60),
    limitUnaryPerDay: readPositiveInt(env, 'WHIM_LIMIT_UNARY_PER_DAY', 2000),
    maxConcurrentUnary: readPositiveInt(env, 'WHIM_MAX_CONCURRENT_UNARY', 16),
    maxConcurrentProbes: readPositiveInt(env, 'WHIM_LIMIT_PROBE_CONCURRENCY', 2),
    limitReportsPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_REPORTS_PER_DEVICE_DAY', 10),
    limitReportsPerDay: readPositiveInt(env, 'WHIM_LIMIT_REPORTS_PER_DAY', 300),
    limitDiagnosticsPerDeviceDay: readPositiveInt(env, 'WHIM_LIMIT_DIAGNOSTICS_PER_DEVICE_DAY', 200),
    limitDiagnosticsPerDay: readPositiveInt(env, 'WHIM_LIMIT_DIAGNOSTICS_PER_DAY', 20_000),
    maxBodyBytesUnary: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_UNARY', 65_536),
    maxBodyBytesGenerate: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_GENERATE', 1_048_576),
    maxBodyBytesReport: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_REPORT', 524_288),
    maxPromptBytes: readPositiveInt(env, 'WHIM_MAX_PROMPT_BYTES', 16_384),
    maxReportSourceBytes: readPositiveInt(env, 'WHIM_MAX_REPORT_SOURCE_BYTES', 262_144),
    maxBodyBytesBeta: readPositiveInt(env, 'WHIM_MAX_BODY_BYTES_BETA', 4096),
    betaLimitPerClientHour: readPositiveInt(env, 'WHIM_BETA_LIMIT_PER_CLIENT_HOUR', 10),
    betaLimitPerDay: readPositiveInt(env, 'WHIM_BETA_LIMIT_PER_DAY', 2000),
    webOrigin: readWebOrigin(env, 'WHIM_WEB_ORIGIN', nodeEnv === 'production'),
    unaryModelTimeoutMs: readPositiveInt(env, 'WHIM_UNARY_MODEL_TIMEOUT_MS', 60_000),
    generationMaxMs,
    minCreditUsd: readNonNegativeDecimal(env, 'WHIM_MIN_CREDIT_USD', 0.5),
    creditCacheTtlMs: readPositiveInt(env, 'WHIM_CREDIT_CACHE_TTL_MS', 60_000),

    policyTimeoutMs: readPositiveInt(env, 'WHIM_POLICY_TIMEOUT_MS', 10_000),
    reportRetentionDays: readKeepPeriod(env, 'WHIM_REPORT_RETENTION_DAYS', 90),
    ledgerRetentionDays: readKeepPeriod(env, 'WHIM_LEDGER_RETENTION_DAYS', 90),
    usageIdleDays: readKeepPeriod(env, 'WHIM_USAGE_IDLE_DAYS', 365),
    drainTimeoutMs: readPositiveInt(env, 'WHIM_DRAIN_TIMEOUT_MS', generationMaxMs + 30_000),

    minBuildIos: readMinimumBuild(env, 'WHIM_MIN_BUILD_IOS'),
    minBuildAndroid: readMinimumBuild(env, 'WHIM_MIN_BUILD_ANDROID'),

    commit: readCommit(env, 'WHIM_COMMIT'),

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
    if (!env.WHIM_WEB_ORIGIN) {
      throw new ServerConfigError('WHIM_WEB_ORIGIN', 'WHIM_WEB_ORIGIN is required in production: the beta signup redirects there.');
    }
  }

  return Object.freeze(config);
}
