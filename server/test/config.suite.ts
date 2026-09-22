/**
 * server/src/config.ts acceptance (public-generation-server chain-1). Scenarios from
 * specs/server-admission-control "Admission limits are environment-configurable with
 * public-beta defaults" and specs/server-deployment "Production configuration refuses
 * dev-only modes".
 */
import { loadServerConfig, ServerConfigError, type ServerConfig } from '../src/config';
import { check, eq, section } from './harness';

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

function throwsNaming(fn: () => unknown, variable: string): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof ServerConfigError && err.variable === variable;
  }
}

/** Every `readPositiveInt`/`readNonNegativeDecimal`-parsed key `loadServerConfig` reads, and the
 *  `ServerConfig` field it lands on — one row per key, so a case that fails names exactly which
 *  key stopped parsing correctly instead of one of ~25 inlined literal checks. */
interface ParseCase {
  key: string;
  field: keyof ServerConfig;
  validValue: string;
  parsed: number;
}

const PARSE_CASES: ParseCase[] = [
  { key: 'WHIM_SERVER_PORT', field: 'serverPort', validValue: '9999', parsed: 9999 },
  { key: 'WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY', field: 'limitGenerationsPerDeviceDay', validValue: '7', parsed: 7 },
  { key: 'WHIM_LIMIT_GENERATIONS_PER_DAY', field: 'limitGenerationsPerDay', validValue: '500', parsed: 500 },
  { key: 'WHIM_MAX_CONCURRENT_GENERATIONS', field: 'maxConcurrentGenerations', validValue: '9', parsed: 9 },
  { key: 'WHIM_SYNTHRUN_CONCURRENCY', field: 'synthrunConcurrency', validValue: '4', parsed: 4 },
  { key: 'WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY', field: 'limitClarifyPerDeviceDay', validValue: '99', parsed: 99 },
  { key: 'WHIM_LIMIT_REWRITE_PER_DEVICE_DAY', field: 'limitRewritePerDeviceDay', validValue: '98', parsed: 98 },
  { key: 'WHIM_LIMIT_UNARY_PER_DAY', field: 'limitUnaryPerDay', validValue: '50', parsed: 50 },
  { key: 'WHIM_MAX_CONCURRENT_UNARY', field: 'maxConcurrentUnary', validValue: '20', parsed: 20 },
  { key: 'WHIM_LIMIT_PROBE_CONCURRENCY', field: 'maxConcurrentProbes', validValue: '5', parsed: 5 },
  { key: 'WHIM_LIMIT_REPORTS_PER_DEVICE_DAY', field: 'limitReportsPerDeviceDay', validValue: '11', parsed: 11 },
  { key: 'WHIM_LIMIT_REPORTS_PER_DAY', field: 'limitReportsPerDay', validValue: '301', parsed: 301 },
  { key: 'WHIM_MAX_BODY_BYTES_UNARY', field: 'maxBodyBytesUnary', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_MAX_BODY_BYTES_GENERATE', field: 'maxBodyBytesGenerate', validValue: '2000000', parsed: 2_000_000 },
  { key: 'WHIM_MAX_BODY_BYTES_REPORT', field: 'maxBodyBytesReport', validValue: '600000', parsed: 600_000 },
  { key: 'WHIM_MAX_PROMPT_BYTES', field: 'maxPromptBytes', validValue: '20000', parsed: 20_000 },
  { key: 'WHIM_MAX_REPORT_SOURCE_BYTES', field: 'maxReportSourceBytes', validValue: '300000', parsed: 300_000 },
  { key: 'WHIM_UNARY_MODEL_TIMEOUT_MS', field: 'unaryModelTimeoutMs', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_GENERATION_MAX_MS', field: 'generationMaxMs', validValue: '700000', parsed: 700_000 },
  { key: 'WHIM_CREDIT_CACHE_TTL_MS', field: 'creditCacheTtlMs', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_POLICY_TIMEOUT_MS', field: 'policyTimeoutMs', validValue: '11000', parsed: 11_000 },
  { key: 'WHIM_REPORT_RETENTION_DAYS', field: 'reportRetentionDays', validValue: '91', parsed: 91 },
  { key: 'WHIM_LEDGER_RETENTION_DAYS', field: 'ledgerRetentionDays', validValue: '92', parsed: 92 },
  { key: 'WHIM_DRAIN_TIMEOUT_MS', field: 'drainTimeoutMs', validValue: '900000', parsed: 900_000 },
];

export function runConfigTests(): void {
  section('Admission limits are environment-configurable with public-beta defaults');

  const defaults = loadServerConfig(baseEnv());

  // The defaults that bound how much a device (or the fleet) can spend, plus the drain relation —
  // asserted together so a change to any of them is one diff to review, not a scattered set of
  // literal checks most of which duplicate a cross-check that lives elsewhere (body caps against
  // Caddy in deploy-config.suite.ts, retention against the privacy page in web-site.suite.ts,
  // host/port via the prod-build boot).
  eq('defaults: the spend-bounding limits', {
    limitGenerationsPerDeviceDay: defaults.limitGenerationsPerDeviceDay,
    limitGenerationsPerDay: defaults.limitGenerationsPerDay,
    minCreditUsd: defaults.minCreditUsd,
    generationMaxMs: defaults.generationMaxMs,
  }, {
    limitGenerationsPerDeviceDay: 15,
    limitGenerationsPerDay: 400,
    minCreditUsd: 0.5,
    generationMaxMs: 600_000,
  });
  eq('defaults: drain timeout is generation max + 30s', defaults.drainTimeoutMs, defaults.generationMaxMs + 30_000);

  section('Every environment-sourced numeric key: garbage fails naming it, a valid value reaches its field');

  for (const c of PARSE_CASES) {
    check(
      `${c.key}: garbage fails startup naming the variable`,
      throwsNaming(() => loadServerConfig(baseEnv({ [c.key]: 'not-a-number' })), c.key),
    );
    const withValue = loadServerConfig(baseEnv({ [c.key]: c.validValue }));
    eq(`${c.key}: a valid non-default value reaches ServerConfig.${String(c.field)}`, withValue[c.field], c.parsed);
  }
  // One representative case for the OTHER positive-int rule (zero, not just non-numeric garbage).
  check(
    'a zero value fails the positive-integer check',
    throwsNaming(
      () => loadServerConfig(baseEnv({ WHIM_MAX_CONCURRENT_GENERATIONS: '0' })),
      'WHIM_MAX_CONCURRENT_GENERATIONS',
    ),
  );
  // WHIM_MIN_CREDIT_USD is the one exception to "positive integer": a non-negative decimal.
  check(
    'WHIM_MIN_CREDIT_USD garbage fails startup naming the variable',
    throwsNaming(() => loadServerConfig(baseEnv({ WHIM_MIN_CREDIT_USD: 'not-a-number' })), 'WHIM_MIN_CREDIT_USD'),
  );
  check(
    'WHIM_MIN_CREDIT_USD accepts a non-negative decimal, not just an integer',
    loadServerConfig(baseEnv({ WHIM_MIN_CREDIT_USD: '0.25' })).minCreditUsd === 0.25,
  );
  check(
    'WHIM_MIN_CREDIT_USD accepts zero',
    loadServerConfig(baseEnv({ WHIM_MIN_CREDIT_USD: '0' })).minCreditUsd === 0,
  );
  check(
    'WHIM_MIN_CREDIT_USD rejects a negative amount',
    throwsNaming(() => loadServerConfig(baseEnv({ WHIM_MIN_CREDIT_USD: '-1' })), 'WHIM_MIN_CREDIT_USD'),
  );

  section('Production configuration refuses dev-only modes');

  const prodEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
    baseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: 'sk-test',
      WHIM_REWRITE_MODEL: 'model/rewrite',
      WHIM_ENGINEER_MODEL: 'model/engineer',
      ...overrides,
    });

  check('a fully-configured production environment loads', loadServerConfig(prodEnv()).nodeEnv === 'production');
  check(
    'the dev log sink cannot reach production',
    throwsNaming(() => loadServerConfig(prodEnv({ WHIM_DEV_LOG_SINK: '1' })), 'WHIM_DEV_LOG_SINK'),
  );
  check(
    'the stub cannot reach production',
    throwsNaming(() => loadServerConfig(prodEnv({ WHIM_PIPELINE: 'stub' })), 'WHIM_PIPELINE'),
  );
  check(
    'a missing OpenRouter key is named at boot',
    throwsNaming(
      () => loadServerConfig(prodEnv({ OPENROUTER_API_KEY: undefined })),
      'OPENROUTER_API_KEY',
    ),
  );
  check(
    'a missing rewrite roster model is named at boot',
    throwsNaming(
      () => loadServerConfig(prodEnv({ WHIM_REWRITE_MODEL: undefined })),
      'WHIM_REWRITE_MODEL',
    ),
  );
  check(
    'a missing engineer roster model is named at boot',
    throwsNaming(
      () => loadServerConfig(prodEnv({ WHIM_ENGINEER_MODEL: undefined })),
      'WHIM_ENGINEER_MODEL',
    ),
  );
  check(
    'an invalid limit still fails startup by name in production',
    throwsNaming(
      () => loadServerConfig(prodEnv({ WHIM_LIMIT_GENERATIONS_PER_DAY: 'lots' })),
      'WHIM_LIMIT_GENERATIONS_PER_DAY',
    ),
  );
  check(
    'outside production the dev log sink and stub pipeline are both fine',
    loadServerConfig(baseEnv({ WHIM_DEV_LOG_SINK: '1', WHIM_PIPELINE: 'stub' })).pipeline === 'stub',
  );
  check(
    'outside production a missing OpenRouter key does not fail startup',
    loadServerConfig(baseEnv()).openRouterApiKey === undefined,
  );
}
