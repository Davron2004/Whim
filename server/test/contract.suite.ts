/**
 * Contract tests: mandatory-hint
 * Diagnostic, install-state-free WireAppRecord, closed-union rejection, one Usage shape, request
 * shapes, and the per-package dependency budget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ApiError,
  ClientEnvelope,
  Diagnostic,
  DiagnosticsBatch,
  DeviceIdError,
  GenerateRequest,
  GenerationEvent,
  RewriteRequest,
  ServiceRefusalCode,
  Usage,
  WireAppRecord,
} from '@whim/contract';
import { check, eq, section } from './harness';

const tinyRecord = {
  name: 'demo',
  source: 'export default {}',
  bundle: '(()=>{})()',
  manifest: { capabilities: [] },
  schema: {},
};

/** A device error record carrying every field the spec's allowlist names
 *  (device-diagnostics "Only an allowlisted projection of an error record leaves the device"). */
const FULL_DIAGNOSTIC = {
  at: 1_790_000_000_000,
  level: 'error',
  channel: 'whim:launcher',
  message: 'generation failed',
  screen: 'Home',
  errorClass: 'TypeError',
  where: 'runtime',
  stage: 'generate',
  reason: 'network',
  kind: 'transport',
  status: 502,
  errorCode: 'server_busy',
  domain: 'generation',
  readyState: 4,
  observedRepairAttempts: 2,
  requestId: '0b7e3f5c-9c1a-4d2e-8f00-1a2b3c4d5e6f',
  route: '/v1/generate',
  count: 3,
  stack: 'at render (index.bundle:1:2)\nat commit (index.bundle:3:4)',
} as const;

function runDiagnosticsBatchTests(): void {
  section('Diagnostics batch (developer-observability D2)');
  const batch = (records: readonly unknown[], extra: Record<string, unknown> = {}): unknown => ({ osVersion: '17.5', records, ...extra });
  const accepts = (value: unknown): boolean => DiagnosticsBatch.safeParse(value).success;

  check('a record with every allowlisted field parses', accepts(batch([FULL_DIAGNOSTIC])));
  check('a record with only at, level, channel and message parses', accepts(batch([{ at: 1, level: 'warn', channel: 'whim', message: 'm' }])));
  for (const field of ['detail', 'url', 'appId', 'deviceId', 'prompt']) {
    check(`a record carrying an unknown key (${field}) is rejected`, !accepts(batch([{ ...FULL_DIAGNOSTIC, [field]: 'x' }])));
  }
  for (const field of ['platform', 'appVersion', 'build', 'deviceId']) {
    check(`the body rejects an unknown key beside osVersion (${field})`, !accepts(batch([FULL_DIAGNOSTIC], { [field]: 'x' })));
  }

  const long = (n: number): string => 'x'.repeat(n);
  check('a 128-character message parses', accepts(batch([{ ...FULL_DIAGNOSTIC, message: long(128) }])));
  check('a 129-character message is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, message: long(129) }])));
  check('a 129-character allowlisted field is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, errorClass: long(129) }])));
  check('a 129-character channel is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, channel: long(129) }])));
  check('a 129-character osVersion is rejected', !accepts({ osVersion: long(129), records: [FULL_DIAGNOSTIC] }));
  check('a 4096-character stack parses', accepts(batch([{ ...FULL_DIAGNOSTIC, stack: long(4096) }])));
  check('a 4097-character stack is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, stack: long(4097) }])));

  check('a route that is a full URL is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, route: 'https://api.example/v1/generate' }])));
  check('a route carrying a query is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, route: '/v1/generate?x=1' }])));
  check('an unknown level is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, level: 'fatal' }])));
  check('a nested object in an allowlisted field is rejected', !accepts(batch([{ ...FULL_DIAGNOSTIC, reason: { detail: 'x' } }])));

  check('a batch of 50 records parses', accepts(batch(Array.from({ length: 50 }, () => FULL_DIAGNOSTIC))));
  check('a batch of 51 records is rejected', !accepts(batch(Array.from({ length: 51 }, () => FULL_DIAGNOSTIC))));
  check('an empty batch is rejected', !accepts(batch([])));
}

export function runContractTests(): void {
  section('Contract round-trips (SPEC §1)');

  // §1.4 — closed union rejects unknown type.
  check('unknown event type rejected', !GenerationEvent.safeParse({ type: 'bogus' }).success);

  // `thinking`: chars is a positive integer — the reasoning TEXT never crosses the wire, only a
  // length, so there is nothing for a "zero-length reasoning delta" to mean.
  check('thinking accepts a positive integer chars', GenerationEvent.safeParse({ type: 'thinking', chars: 1 }).success);
  check('thinking rejects chars: 0', !GenerationEvent.safeParse({ type: 'thinking', chars: 0 }).success);
  check('thinking rejects a non-integer chars', !GenerationEvent.safeParse({ type: 'thinking', chars: 1.5 }).success);
  check('thinking rejects a negative chars', !GenerationEvent.safeParse({ type: 'thinking', chars: -1 }).success);
  check('thinking requires chars', !GenerationEvent.safeParse({ type: 'thinking' }).success);

  // §1.2 — mandatory non-empty hint; open kind.
  check('Diagnostic rejects empty hint', !Diagnostic.safeParse({ kind: 'X', hint: '' }).success);
  check('Diagnostic rejects missing hint', !Diagnostic.safeParse({ kind: 'X' }).success);
  check(
    'Diagnostic accepts non-empty hint + arbitrary open kind',
    Diagnostic.safeParse({ kind: 'some-future-kind', hint: 'do x' }).success,
  );

  // §1.3 — WireAppRecord is install-state-free: extra install fields do not survive validation.
  const polluted = { ...tinyRecord, id: 'app-1', installedAt: 123, position: 0 };
  const rec = WireAppRecord.parse(polluted);
  check('WireAppRecord drops id', !('id' in rec));
  check('WireAppRecord drops installedAt', !('installedAt' in rec));
  check('WireAppRecord drops position', !('position' in rec));
  check(
    'result event validates with only generation outputs',
    GenerationEvent.safeParse({ type: 'result', app: tinyRecord }).success,
  );

  // §1.5 — Usage requires integers (one shape; identity is asserted in the modules that reuse it).
  check(
    'Usage rejects non-integer',
    !Usage.safeParse({ promptTokens: 1.5, completionTokens: 2, totalTokens: 3 }).success,
  );

  // §1.6 — request shapes.
  check('GenerateRequest requires prompt', !GenerateRequest.safeParse({}).success);
  check('RewriteRequest shape', RewriteRequest.safeParse({ prompt: 'p' }).success);
  // A prompt-only rewrite is a NEW-app rewrite: `app` absent is the whole signal.
  check(
    'RewriteRequest app is optional (a prompt-only request is a new-app rewrite)',
    RewriteRequest.safeParse({ prompt: 'p' }).success &&
      RewriteRequest.safeParse({ prompt: 'p' }).data?.app === undefined,
  );
  const rePrompt = RewriteRequest.safeParse({
    prompt: 'add a streak count',
    app: {
      name: 'Habit Tracker',
      collections: [{ name: 'Completions', fields: ['Date', 'Note'] }],
    },
  });
  check('RewriteRequest accepts an app context of display names', rePrompt.success);
  check(
    'RewriteRequest app context round-trips its display names',
    rePrompt.success &&
      rePrompt.data.app?.name === 'Habit Tracker' &&
      rePrompt.data.app.collections?.[0]?.name === 'Completions' &&
      rePrompt.data.app.collections[0].fields.join(',') === 'Date,Note',
  );
  check(
    'RewriteRequest app.collections is optional (an app that stores nothing)',
    RewriteRequest.safeParse({ prompt: 'p', app: { name: 'Tip Splitter' } }).success,
  );
  check(
    'RewriteRequest app.name is required inside the context',
    !RewriteRequest.safeParse({ prompt: 'p', app: { collections: [] } }).success,
  );
  check(
    'RewriteRequest app.collections entries carry both a name and its fields',
    !RewriteRequest.safeParse({ prompt: 'p', app: { name: 'A', collections: [{ name: 'C' }] } })
      .success,
  );
  // Names only: a client that sends source/bundle/ids/records inside `app` gets them stripped —
  // the parsed value a server forwards to the model can never carry them.
  const overReaching = RewriteRequest.safeParse({
    prompt: 'add a streak count',
    app: {
      name: 'Habit Tracker',
      source: 'export default defineApp({})',
      bundle: '(()=>{})()',
      appliedSchema: { c1: { f1: 'text' } },
      records: [{ id: 1 }],
      appId: 'habit-tracker',
      collections: [{ name: 'Completions', fields: ['Date'], id: 'c1' }],
    },
  });
  check('RewriteRequest tolerates an over-reaching app object', overReaching.success);
  const parsedApp = (overReaching.success ? overReaching.data.app : {}) as Record<string, unknown>;
  const parsedCollection = ((parsedApp.collections as Record<string, unknown>[] | undefined)?.[0] ??
    {}) as Record<string, unknown>;
  check(
    'RewriteRequest app carries no source/bundle/applied schema/records/device identity',
    ['source', 'bundle', 'appliedSchema', 'records', 'appId'].every((key) => !(key in parsedApp)),
  );
  check(
    'RewriteRequest app.collections carry no burned ids',
    !('id' in parsedCollection) && parsedCollection.name === 'Completions',
  );

  // ApiError — the shape every non-SSE /v1/* error body validates against.
  check('ApiError rejects empty hint', !ApiError.safeParse({ error: 'x', hint: '' }).success);
  check('ApiError rejects missing hint', !ApiError.safeParse({ error: 'x' }).success);
  check(
    'DeviceIdError still rejects an unrecognized error value',
    !DeviceIdError.safeParse({ error: 'model_failure', hint: 'retry the rewrite' }).success,
  );

  // GenerationEvent stage stays closed at plan|generate|check|run|repair — no `rewrite` member.
  check(
    'GenerationEvent rejects a rewrite stage',
    !GenerationEvent.safeParse({ type: 'stage', stage: 'rewrite', status: 'start' }).success,
  );

  // Service refusal codes are a closed vocabulary (generation-contract).
  section('Service refusal codes are a closed vocabulary');
  check(
    'ServiceRefusalCode rejects a code outside the closed set',
    !ServiceRefusalCode.safeParse('rate_limited').success,
  );
  check(
    'ApiError stays untouched: an arbitrary open error string still validates',
    ApiError.safeParse({ error: 'invalid_request', hint: 'fix the request and try again' }).success,
  );

  // The client envelope: raw header text in, typed envelope out, each field failing on its own.
  section('Client envelope (request-envelope D1)');
  const envelopeHeaders = { platform: 'ios', appVersion: '1.0.0', build: '381500', consent: '1' };
  const parsedEnvelope = ClientEnvelope.safeParse(envelopeHeaders);
  eq(
    'a complete envelope parses to typed values',
    parsedEnvelope.success ? parsedEnvelope.data : parsedEnvelope.error.issues,
    { platform: 'ios', appVersion: '1.0.0', build: 381500, consent: 1 },
  );
  const noGrant = ClientEnvelope.safeParse({ ...envelopeHeaders, platform: 'android', consent: 'none' });
  eq('consent none parses as the literal none', noGrant.success ? noGrant.data.consent : undefined, 'none');
  check('an unknown platform is rejected', !ClientEnvelope.safeParse({ ...envelopeHeaders, platform: 'windows' }).success);
  for (const build of ['abc', '0', '-5', '12.5', '1e5', '0381500', '', '1234567890123456']) {
    check(`a malformed build (${JSON.stringify(build)}) is rejected`, !ClientEnvelope.safeParse({ ...envelopeHeaders, build }).success);
  }
  for (const consent of ['0', 'yes', '']) {
    check(`a malformed consent (${JSON.stringify(consent)}) is rejected`, !ClientEnvelope.safeParse({ ...envelopeHeaders, consent }).success);
  }
  check('an empty app version is rejected', !ClientEnvelope.safeParse({ ...envelopeHeaders, appVersion: '' }).success);
  check('a pre-release app version still parses', ClientEnvelope.safeParse({ ...envelopeHeaders, appVersion: '1.1.0-beta.2' }).success);

  runDiagnosticsBatchTests();

  // §2 — dependency budget (read package.json at test time; cwd is repo root under `npm run`).
  section('Dependency budget (SPEC §2)');
  const root = process.cwd();
  const readDeps = (rel: string): string[] => {
    const pkg = JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
  };
  const isReactAdjacent = (dep: string): boolean => /^react($|[-/])|^@react/.test(dep);

  const contractDeps = readDeps('contract/package.json');
  eq('contract runtime deps are exactly [zod]', contractDeps, ['zod']);
  check('contract has no React-adjacent dep', !contractDeps.some(isReactAdjacent));

  const serverDeps = readDeps('server/package.json');
  check('server has no React-adjacent dep', !serverDeps.some(isReactAdjacent));

  // The synthetic-run toolchain runs in production, so the server pins it to exactly the version the
  // root lockfile resolves: one copy of each, and the server never drifts from what CI tested.
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };
  const serverLockDeps = lock.packages.server?.dependencies ?? {};
  for (const dep of ['esbuild', 'playwright', 'typescript']) {
    const resolved = lock.packages[`node_modules/${dep}`]?.version;
    check(`${dep} is resolved at the lockfile root`, typeof resolved === 'string');
    eq(`server pins ${dep} to the lockfile-resolved version exactly`, serverLockDeps[dep], resolved);
  }

  // The pretty printer is a HUMAN convenience, not part of the service: the server must run with
  // structured JSON where it is absent (spec "The service runs without the pretty printer"), so it
  // may never appear under `dependencies`.
  const serverPkg = JSON.parse(readFileSync(path.join(root, 'server/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  check('pino-pretty is not a server runtime dependency', !('pino-pretty' in (serverPkg.dependencies ?? {})));
}
