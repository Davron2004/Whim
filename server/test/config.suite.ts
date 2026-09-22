/**
 * server/src/config.ts acceptance (public-generation-server chain-1). Scenarios from
 * specs/server-admission-control "Admission limits are environment-configurable with
 * public-beta defaults" and specs/server-deployment "Production configuration refuses
 * dev-only modes".
 */
import { loadServerConfig, ServerConfigError } from '../src/config';
import { check, section } from './harness';

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

export function runConfigTests(): void {
  section('Admission limits are environment-configurable with public-beta defaults');

  const defaults = loadServerConfig(baseEnv());
  check('defaults: generations per device day', defaults.limitGenerationsPerDeviceDay === 15);
  check('defaults: generations per day', defaults.limitGenerationsPerDay === 400);
  check('defaults: max concurrent generations', defaults.maxConcurrentGenerations === 3);
  check('defaults: synthrun concurrency', defaults.synthrunConcurrency === 2);
  check('defaults: clarify per device day', defaults.limitClarifyPerDeviceDay === 60);
  check('defaults: rewrite per device day', defaults.limitRewritePerDeviceDay === 60);
  check('defaults: unary (clarify + rewrite) global per day', defaults.limitUnaryPerDay === 2000);
  check('defaults: max concurrent unary', defaults.maxConcurrentUnary === 16);
  check('defaults: max concurrent healthz probes', defaults.maxConcurrentProbes === 2);
  check('defaults: reports per device day', defaults.limitReportsPerDeviceDay === 10);
  check('defaults: reports per day', defaults.limitReportsPerDay === 300);
  check('defaults: max body bytes unary', defaults.maxBodyBytesUnary === 65_536);
  check('defaults: max body bytes generate', defaults.maxBodyBytesGenerate === 1_048_576);
  check('defaults: max body bytes report', defaults.maxBodyBytesReport === 524_288);
  check('defaults: max prompt bytes', defaults.maxPromptBytes === 16_384);
  check('defaults: max report source bytes', defaults.maxReportSourceBytes === 262_144);
  check('defaults: unary model timeout ms', defaults.unaryModelTimeoutMs === 60_000);
  check('defaults: generation max ms', defaults.generationMaxMs === 600_000);
  check('defaults: min credit usd', defaults.minCreditUsd === 0.5);
  check('defaults: credit cache ttl ms', defaults.creditCacheTtlMs === 60_000);
  check('defaults: policy timeout ms', defaults.policyTimeoutMs === 10_000);
  check('defaults: report retention days', defaults.reportRetentionDays === 90);
  check('defaults: ledger retention days', defaults.ledgerRetentionDays === 90);
  check(
    'defaults: drain timeout ms is generation max + 30s',
    defaults.drainTimeoutMs === defaults.generationMaxMs + 30_000,
  );
  check('defaults: server host', defaults.serverHost === '0.0.0.0');
  check('defaults: server port', defaults.serverPort === 8787);

  check(
    'a bad value fails startup naming the variable',
    throwsNaming(
      () => loadServerConfig(baseEnv({ WHIM_LIMIT_GENERATIONS_PER_DAY: 'lots' })),
      'WHIM_LIMIT_GENERATIONS_PER_DAY',
    ),
  );
  check(
    'WHIM_LIMIT_UNARY_PER_DAY is read from the environment',
    loadServerConfig(baseEnv({ WHIM_LIMIT_UNARY_PER_DAY: '50' })).limitUnaryPerDay === 50,
  );
  check(
    'a non-integer unary ceiling fails startup naming the variable',
    throwsNaming(
      () => loadServerConfig(baseEnv({ WHIM_LIMIT_UNARY_PER_DAY: 'plenty' })),
      'WHIM_LIMIT_UNARY_PER_DAY',
    ),
  );
  check(
    'WHIM_LIMIT_PROBE_CONCURRENCY is read from the environment like every sibling cap',
    loadServerConfig(baseEnv({ WHIM_LIMIT_PROBE_CONCURRENCY: '5' })).maxConcurrentProbes === 5,
  );
  check(
    'a non-integer probe concurrency fails startup naming the variable',
    throwsNaming(
      () => loadServerConfig(baseEnv({ WHIM_LIMIT_PROBE_CONCURRENCY: 'two' })),
      'WHIM_LIMIT_PROBE_CONCURRENCY',
    ),
  );
  check(
    'a zero value fails the positive-integer check',
    throwsNaming(
      () => loadServerConfig(baseEnv({ WHIM_MAX_CONCURRENT_GENERATIONS: '0' })),
      'WHIM_MAX_CONCURRENT_GENERATIONS',
    ),
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
