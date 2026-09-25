/**
 * server/src/config.ts acceptance (public-generation-server chain-1). Scenarios from
 * specs/server-admission-control "Admission limits are environment-configurable with
 * public-beta defaults" and specs/server-deployment "Production configuration refuses
 * dev-only modes".
 */
import { MANIFESTS, keepLimit, latestVersion, type CategoryId } from '../../contract/src/disclosure-manifest';
import { loadServerConfig, ServerConfigError, type ServerConfig } from '../src/config';
import { DEFAULT_MAX_QUEUED_GENERATIONS } from '../src/admission/slots';
import {
  defaultModelRoster,
  modelRosterFromEnv,
  ModelRosterEnvError,
  ModelRosterReasoningError,
} from '../src/generation/model';
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

/** The `ServerConfigError` `fn` throws, or `undefined` when it loads. */
function configError(fn: () => unknown): ServerConfigError | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (err instanceof ServerConfigError) return err;
    throw err;
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
  { key: 'WHIM_QUEUE_MAX', field: 'queueMax', validValue: '12', parsed: 12 },
  { key: 'WHIM_QUEUE_MAX_WAIT_MS', field: 'queueMaxWaitMs', validValue: '90000', parsed: 90_000 },
  { key: 'WHIM_SYNTHRUN_CONCURRENCY', field: 'synthrunConcurrency', validValue: '4', parsed: 4 },
  { key: 'WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY', field: 'limitClarifyPerDeviceDay', validValue: '99', parsed: 99 },
  { key: 'WHIM_LIMIT_REWRITE_PER_DEVICE_DAY', field: 'limitRewritePerDeviceDay', validValue: '98', parsed: 98 },
  { key: 'WHIM_LIMIT_UNARY_PER_DAY', field: 'limitUnaryPerDay', validValue: '50', parsed: 50 },
  { key: 'WHIM_MAX_CONCURRENT_UNARY', field: 'maxConcurrentUnary', validValue: '20', parsed: 20 },
  { key: 'WHIM_LIMIT_PROBE_CONCURRENCY', field: 'maxConcurrentProbes', validValue: '5', parsed: 5 },
  { key: 'WHIM_LIMIT_REPORTS_PER_DEVICE_DAY', field: 'limitReportsPerDeviceDay', validValue: '11', parsed: 11 },
  { key: 'WHIM_LIMIT_REPORTS_PER_DAY', field: 'limitReportsPerDay', validValue: '301', parsed: 301 },
  { key: 'WHIM_LIMIT_DIAGNOSTICS_PER_DEVICE_DAY', field: 'limitDiagnosticsPerDeviceDay', validValue: '201', parsed: 201 },
  { key: 'WHIM_LIMIT_DIAGNOSTICS_PER_DAY', field: 'limitDiagnosticsPerDay', validValue: '20001', parsed: 20_001 },
  { key: 'WHIM_MAX_BODY_BYTES_UNARY', field: 'maxBodyBytesUnary', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_MAX_BODY_BYTES_GENERATE', field: 'maxBodyBytesGenerate', validValue: '2000000', parsed: 2_000_000 },
  { key: 'WHIM_MAX_BODY_BYTES_REPORT', field: 'maxBodyBytesReport', validValue: '600000', parsed: 600_000 },
  { key: 'WHIM_MAX_PROMPT_BYTES', field: 'maxPromptBytes', validValue: '20000', parsed: 20_000 },
  { key: 'WHIM_MAX_REPORT_SOURCE_BYTES', field: 'maxReportSourceBytes', validValue: '300000', parsed: 300_000 },
  { key: 'WHIM_MAX_BODY_BYTES_BETA', field: 'maxBodyBytesBeta', validValue: '8192', parsed: 8192 },
  { key: 'WHIM_BETA_LIMIT_PER_CLIENT_HOUR', field: 'betaLimitPerClientHour', validValue: '25', parsed: 25 },
  { key: 'WHIM_BETA_LIMIT_PER_DAY', field: 'betaLimitPerDay', validValue: '5000', parsed: 5000 },
  { key: 'WHIM_UNARY_MODEL_TIMEOUT_MS', field: 'unaryModelTimeoutMs', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_GENERATION_MAX_MS', field: 'generationMaxMs', validValue: '700000', parsed: 700_000 },
  { key: 'WHIM_CREDIT_CACHE_TTL_MS', field: 'creditCacheTtlMs', validValue: '70000', parsed: 70_000 },
  { key: 'WHIM_POLICY_TIMEOUT_MS', field: 'policyTimeoutMs', validValue: '11000', parsed: 11_000 },
  { key: 'WHIM_REPORT_RETENTION_DAYS', field: 'reportRetentionDays', validValue: '91', parsed: 91 },
  { key: 'WHIM_LEDGER_RETENTION_DAYS', field: 'ledgerRetentionDays', validValue: '92', parsed: 92 },
  { key: 'WHIM_USAGE_IDLE_DAYS', field: 'usageIdleDays', validValue: '93', parsed: 93 },
  { key: 'WHIM_DRAIN_TIMEOUT_MS', field: 'drainTimeoutMs', validValue: '900000', parsed: 900_000 },
  { key: 'WHIM_MIN_BUILD_IOS', field: 'minBuildIos', validValue: '381500', parsed: 381_500 },
  { key: 'WHIM_MIN_BUILD_ANDROID', field: 'minBuildAndroid', validValue: '382000', parsed: 382_000 },
];

function runProviderQuantizationTests(): void {
  section('WHIM_PROVIDER_QUANTIZATIONS (beta-1 D12): a trimmed comma list of OpenRouter quantizations');

  for (const [what, raw] of [['unset', undefined], ['empty', ''], ['only commas and spaces', ' , ,']] as const) {
    check(`${what}: no quantization preference`, loadServerConfig(baseEnv({ WHIM_PROVIDER_QUANTIZATIONS: raw })).providerQuantizations === undefined);
  }
  eq(
    'entries are trimmed, empty ones dropped, and the order kept',
    loadServerConfig(baseEnv({ WHIM_PROVIDER_QUANTIZATIONS: ' fp8, bf16 ,,fp16' })).providerQuantizations,
    ['fp8', 'bf16', 'fp16'],
  );
  for (const raw of ['fp8,int3', 'FP8', 'fp8 bf16']) {
    check(`${JSON.stringify(raw)} fails startup naming the variable`, throwsNaming(() => loadServerConfig(baseEnv({ WHIM_PROVIDER_QUANTIZATIONS: raw })), 'WHIM_PROVIDER_QUANTIZATIONS'));
  }
}

function runGenerationLineTests(defaults: ServerConfig): void {
  section('The generation line (beta-1 D8): WHIM_QUEUE_MAX and WHIM_QUEUE_MAX_WAIT_MS');

  eq('defaults: a line of 50 and a longest wait of 180 s', [defaults.queueMax, defaults.queueMaxWaitMs], [50, 180_000]);
  eq('the slot controller\'s own default line length is the configured one', DEFAULT_MAX_QUEUED_GENERATIONS, defaults.queueMax);
  eq('WHIM_QUEUE_MAX=0, the rollback lever, loads as no line', loadServerConfig(baseEnv({ WHIM_QUEUE_MAX: '0' })).queueMax, 0);
  // An empty value must not read as 0: a blank line in a values file would silently turn the line off.
  for (const [what, raw] of [['a negative value', '-1'], ['a fraction', '2.5'], ['an empty value', ''], ['spaces', '  ']] as const) {
    check(`WHIM_QUEUE_MAX: ${what} (${JSON.stringify(raw)}) fails startup naming the variable`, throwsNaming(() => loadServerConfig(baseEnv({ WHIM_QUEUE_MAX: raw })), 'WHIM_QUEUE_MAX'));
  }
  check('WHIM_QUEUE_MAX_WAIT_MS=0 fails startup naming the variable', throwsNaming(() => loadServerConfig(baseEnv({ WHIM_QUEUE_MAX_WAIT_MS: '0' })), 'WHIM_QUEUE_MAX_WAIT_MS'));
}

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
  // The beta signup's brakes (beta-waitlist D3): what an anonymous web form may cost the server.
  eq('defaults: the beta signup body cap and limits', {
    maxBodyBytesBeta: defaults.maxBodyBytesBeta,
    betaLimitPerClientHour: defaults.betaLimitPerClientHour,
    betaLimitPerDay: defaults.betaLimitPerDay,
  }, {
    maxBodyBytesBeta: 4096,
    betaLimitPerClientHour: 10,
    betaLimitPerDay: 2000,
  });

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

  section('Minimum supported builds (app-update-gate): default 0, anything but a build number fails by name');

  eq('unset: both minimums are 0 (the gate is off)', [defaults.minBuildIos, defaults.minBuildAndroid], [0, 0]);
  const oneRaised = loadServerConfig(baseEnv({ WHIM_MIN_BUILD_IOS: '0', WHIM_MIN_BUILD_ANDROID: '382000' }));
  eq('an explicit 0 is accepted, and each variable reaches only its own platform', [oneRaised.minBuildIos, oneRaised.minBuildAndroid], [0, 382_000]);
  // Each of these would read as a number (often 0, which silently turns the gate off) under a
  // plain `Number()` parse, so each must fail instead.
  for (const [what, raw] of [
    ['a negative value', '-1'],
    ['a fraction', '381500.5'],
    ['an empty value', ''],
    ['an exponent', '1e5'],
    ['a hex value', '0x10'],
    ['surrounding spaces', ' 382000'],
    ['a leading zero', '0382000'],
    ['more digits than any build number', '1234567890123456'],
  ] as const) {
    for (const key of ['WHIM_MIN_BUILD_IOS', 'WHIM_MIN_BUILD_ANDROID']) {
      check(`${key}: ${what} (${JSON.stringify(raw)}) fails startup naming the variable`, throwsNaming(() => loadServerConfig(baseEnv({ [key]: raw })), key));
    }
  }

  section('WHIM_COMMIT (developer-observability D13): a full SHA or "unknown", nothing else');

  eq('unset: the commit is "unknown"', defaults.commit, 'unknown');
  eq('the Dockerfile default "unknown" stays "unknown"', loadServerConfig(baseEnv({ WHIM_COMMIT: 'unknown' })).commit, 'unknown');
  const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  eq('a full lowercase SHA is reported as given', loadServerConfig(baseEnv({ WHIM_COMMIT: sha })).commit, sha);
  for (const [what, raw] of [
    ['an abbreviated SHA', sha.slice(0, 7)],
    ['an uppercase SHA', sha.toUpperCase()],
    ['a branch name', 'main'],
    ['an empty value', ''],
  ] as const) {
    check(`WHIM_COMMIT: ${what} (${JSON.stringify(raw)}) fails startup naming the variable`, throwsNaming(() => loadServerConfig(baseEnv({ WHIM_COMMIT: raw })), 'WHIM_COMMIT'));
  }

  section('A configured keep-period never exceeds its published maximum (specs/device-records)');

  // The pairings the disclosure contract states: report retention ≤ reports, ledger retention and
  // the usage idle period ≤ usage-records. Each maximum is read from the current manifest.
  const current = MANIFESTS[latestVersion()];
  const keepPeriods: ReadonlyArray<readonly [string, keyof ServerConfig, CategoryId]> = [
    ['WHIM_REPORT_RETENTION_DAYS', 'reportRetentionDays', 'reports'],
    ['WHIM_LEDGER_RETENTION_DAYS', 'ledgerRetentionDays', 'usage-records'],
    ['WHIM_USAGE_IDLE_DAYS', 'usageIdleDays', 'usage-records'],
  ];
  for (const [key, field, category] of keepPeriods) {
    const maximum = keepLimit(current, category)?.days ?? 0;
    eq(`${key}: exactly the ${category} maximum (${maximum} days) loads`, loadServerConfig(baseEnv({ [key]: String(maximum) }))[field], maximum);
    const refusal = configError(() => loadServerConfig(baseEnv({ [key]: String(maximum + 1) })));
    check(
      `${key}: one day over the maximum fails startup, naming the variable and the maximum`,
      refusal?.variable === key && new RegExp(String.raw`\b${maximum}\b`).test(refusal.message),
      refusal?.message ?? 'no refusal',
    );
  }
  {
    // The spec's own scenarios.
    const reportsMaximum = keepLimit(current, 'reports')?.days ?? 0;
    const refusal = configError(() => loadServerConfig(baseEnv({ WHIM_REPORT_RETENTION_DAYS: '400' })));
    check(
      `WHIM_REPORT_RETENTION_DAYS=400 over the ${reportsMaximum}-day reports maximum refuses to start, naming both`,
      reportsMaximum < 400 && refusal?.variable === 'WHIM_REPORT_RETENTION_DAYS' && new RegExp(String.raw`\b${reportsMaximum}\b`).test(refusal.message),
      refusal?.message ?? 'no refusal',
    );
    eq('WHIM_LEDGER_RETENTION_DAYS=90, under the usage-records maximum, starts', loadServerConfig(baseEnv({ WHIM_LEDGER_RETENTION_DAYS: '90' })).ledgerRetentionDays, 90);
  }

  section('Production configuration refuses dev-only modes');

  const prodEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
    baseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: 'sk-test',
      WHIM_REWRITE_MODEL: 'model/rewrite',
      WHIM_ENGINEER_MODEL: 'model/engineer',
      WHIM_WEB_ORIGIN: 'https://pages.example.test',
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
    'a missing pages origin is named at boot: the beta signup would redirect nowhere',
    throwsNaming(() => loadServerConfig(prodEnv({ WHIM_WEB_ORIGIN: undefined })), 'WHIM_WEB_ORIGIN'),
  );
  check(
    'production refuses a plain-http pages origin',
    throwsNaming(() => loadServerConfig(prodEnv({ WHIM_WEB_ORIGIN: 'http://pages.example.test' })), 'WHIM_WEB_ORIGIN'),
  );
  check(
    'outside production the dev log sink and stub pipeline are both fine',
    loadServerConfig(baseEnv({ WHIM_DEV_LOG_SINK: '1', WHIM_PIPELINE: 'stub' })).pipeline === 'stub',
  );
  check(
    'outside production a missing OpenRouter key does not fail startup',
    loadServerConfig(baseEnv()).openRouterApiKey === undefined,
  );

  section('WHIM_WEB_ORIGIN (beta-waitlist D1): where the signup redirects');

  eq('it reaches ServerConfig.webOrigin as given', loadServerConfig(prodEnv()).webOrigin, 'https://pages.example.test');
  eq('outside production, unset reads as a local pages preview', defaults.webOrigin, 'http://localhost:8080');
  for (const [what, raw] of [
    ['a trailing slash', 'https://pages.example.test/'],
    ['a path', 'https://pages.example.test/beta'],
    ['a query', 'https://pages.example.test?x=1'],
    ['no scheme', 'pages.example.test'],
    ['another scheme', 'ftp://pages.example.test'],
  ] as const) {
    check(`${what} (${JSON.stringify(raw)}) fails startup naming the variable`, throwsNaming(() => loadServerConfig(baseEnv({ WHIM_WEB_ORIGIN: raw })), 'WHIM_WEB_ORIGIN'));
  }

  section('WHIM_PROVIDER_SORT (design D3)');

  check('unset: no provider preference', loadServerConfig(baseEnv()).providerSort === undefined);
  for (const sort of ['price', 'throughput', 'latency'] as const) {
    eq(`"${sort}" reaches ServerConfig.providerSort`, loadServerConfig(baseEnv({ WHIM_PROVIDER_SORT: sort })).providerSort, sort);
  }
  check(
    'an unrecognized value fails startup naming the variable',
    throwsNaming(() => loadServerConfig(baseEnv({ WHIM_PROVIDER_SORT: 'cheapest' })), 'WHIM_PROVIDER_SORT'),
  );

  runProviderQuantizationTests();
  runGenerationLineTests(defaults);

  section('modelRosterFromEnv (design D2) — the roster of per-role models and reasoning settings');

  // The two-variable case behaves exactly as `defaultModelRoster` describes it: clarify/summary
  // fall back to rewrite, plan/engineer/repair fall back to engineer, and repair inherits the
  // engineer's effective reasoning setting.
  {
    const roster = modelRosterFromEnv({ WHIM_REWRITE_MODEL: 'vendor/rewrite-1', WHIM_ENGINEER_MODEL: 'vendor/engineer-1' });
    eq('two-variable roster matches the default-roster helper', roster, defaultModelRoster('vendor/rewrite-1', 'vendor/engineer-1'));
  }

  {
    const roster = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_ENGINEER_REASONING: 'low',
    });
    eq('repair model defaults to the engineer model', roster.repair.model, roster.engineer.model);
    eq('repair reasoning defaults to the engineer effective reasoning', roster.repair.reasoning, 'low');
  }
  {
    const roster = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_ENGINEER_REASONING: 'on',
      WHIM_REPAIR_MODEL: '',
      WHIM_REPAIR_REASONING: '',
    });
    eq('empty repair model and reasoning values count as unset', roster.repair, roster.engineer);
  }
  {
    const roster = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_ENGINEER_REASONING: 'on',
      WHIM_REPAIR_MODEL: 'vendor/repair-only',
      WHIM_REPAIR_REASONING: 'off',
    });
    eq('repair overrides affect only the repair roster entry', roster.repair, { model: 'vendor/repair-only', reasoning: 'off' });
    eq('repair overrides leave engineer roster entry untouched', roster.engineer, { model: 'vendor/engineer-1', reasoning: 'on' });
  }

  // A missing required variable is still named, exactly as before.
  {
    const err = (() => {
      try {
        modelRosterFromEnv({});
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    check('both required vars missing: throws ModelRosterEnvError', err instanceof ModelRosterEnvError);
    eq(
      'both required vars missing: names both',
      err instanceof ModelRosterEnvError ? [...err.missing].sort((a, b) => a.localeCompare(b)) : [],
      ['WHIM_ENGINEER_MODEL', 'WHIM_REWRITE_MODEL'],
    );
  }

  // An override routes ONLY its own role — every other role stays on the default it would have had.
  {
    const withClarifyOverride = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_CLARIFY_MODEL: 'vendor/clarify-only',
    });
    eq('clarify override reaches only the clarify role', withClarifyOverride.clarify.model, 'vendor/clarify-only');
    eq('rewrite is untouched by the clarify override', withClarifyOverride.rewrite.model, 'vendor/rewrite-1');
    eq('summary is untouched by the clarify override', withClarifyOverride.summary.model, 'vendor/rewrite-1');
    eq('plan is untouched by the clarify override', withClarifyOverride.plan.model, 'vendor/engineer-1');
  }
  {
    const withSummaryOverride = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_SUMMARY_MODEL: 'vendor/summary-only',
    });
    eq('summary override reaches only the summary role', withSummaryOverride.summary.model, 'vendor/summary-only');
    eq('clarify is untouched by the summary override', withSummaryOverride.clarify.model, 'vendor/rewrite-1');
  }
  {
    const withPlanOverride = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_PLAN_MODEL: 'vendor/plan-only',
    });
    eq('plan override reaches only the plan role', withPlanOverride.plan.model, 'vendor/plan-only');
    eq('engineer is untouched by the plan override', withPlanOverride.engineer.model, 'vendor/engineer-1');
  }

  // An empty override counts as unset — falls back exactly as if the variable were absent.
  {
    const withEmptyOverride = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_CLARIFY_MODEL: '',
    });
    eq('an empty override falls back to the family model, same as unset', withEmptyOverride.clarify.model, 'vendor/rewrite-1');
  }

  // Each role's reasoning setting is independently overridable, defaulting per design D2's table.
  {
    const withReasoningOverride = modelRosterFromEnv({
      WHIM_REWRITE_MODEL: 'vendor/rewrite-1',
      WHIM_ENGINEER_MODEL: 'vendor/engineer-1',
      WHIM_CLARIFY_REASONING: 'low',
    });
    eq('a role reasoning override reaches only its own role', withReasoningOverride.clarify.reasoning, 'low');
    eq('rewrite keeps its own default (off), untouched by the clarify override', withReasoningOverride.rewrite.reasoning, 'off');
    eq('plan keeps its own default (on)', withReasoningOverride.plan.reasoning, 'on');
  }

  // A value outside the closed set fails configuration loading, naming the variable.
  {
    const err = (() => {
      try {
        modelRosterFromEnv({ WHIM_REWRITE_MODEL: 'vendor/rewrite-1', WHIM_ENGINEER_MODEL: 'vendor/engineer-1', WHIM_PLAN_REASONING: 'fast' });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    check('an invalid reasoning value throws ModelRosterReasoningError', err instanceof ModelRosterReasoningError);
    if (err instanceof ModelRosterReasoningError) {
      eq('it names the exact variable', err.variable, 'WHIM_PLAN_REASONING');
      for (const allowed of ['off', 'on', 'low', 'medium', 'high', 'default']) {
        check(`the message names the allowed value "${allowed}"`, err.message.includes(allowed));
      }
    }
  }
  {
    const err = (() => {
      try {
        modelRosterFromEnv({ WHIM_REWRITE_MODEL: 'vendor/rewrite-1', WHIM_ENGINEER_MODEL: 'vendor/engineer-1', WHIM_REPAIR_REASONING: 'fast' });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    check('invalid repair reasoning throws ModelRosterReasoningError', err instanceof ModelRosterReasoningError);
    if (err instanceof ModelRosterReasoningError) {
      eq('invalid repair reasoning names its variable', err.variable, 'WHIM_REPAIR_REASONING');
      check('invalid repair reasoning lists allowed settings', ['off', 'on', 'low', 'medium', 'high', 'default'].every((value) => err.message.includes(value)));
    }
  }
}
