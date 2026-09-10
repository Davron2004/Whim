/**
 * Contract tests (SPEC.md §1, §2): every GenerationEvent variant round-trips, mandatory-hint
 * Diagnostic, install-state-free WireAppRecord, closed-union rejection, one Usage shape, request
 * shapes, and the per-package dependency budget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ApiError,
  AppContext,
  ClarifyRequest,
  Diagnostic,
  DeviceIdError,
  GenerateRequest,
  GenerationEvent,
  RewriteRequest,
  RewriteResponse,
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

export function runContractTests(): void {
  section('Contract round-trips (SPEC §1)');

  // §1.1 — every GenerationEvent variant round-trips. Typing the samples as GenerationEvent also
  // proves at compile time that each literal is a valid event.
  const samples: Array<{ label: string; value: GenerationEvent }> = [
    { label: 'stage plan/start', value: { type: 'stage', stage: 'plan', status: 'start' } },
    {
      label: 'stage generate/done +attempt',
      value: { type: 'stage', stage: 'generate', status: 'done', attempt: 2 },
    },
    { label: 'stage check/start', value: { type: 'stage', stage: 'check', status: 'start' } },
    { label: 'stage run/done', value: { type: 'stage', stage: 'run', status: 'done' } },
    { label: 'stage repair/start', value: { type: 'stage', stage: 'repair', status: 'start' } },
    { label: 'token', value: { type: 'token', text: 'hello' } },
    { label: 'thinking', value: { type: 'thinking', chars: 42 } },
    {
      label: 'diagnostic',
      value: {
        type: 'diagnostic',
        diagnostic: { kind: 'TYPE_ERROR', symbol: 'foo', line: 4, hint: 'add a return type' },
      },
    },
    {
      label: 'usage',
      value: { type: 'usage', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
    },
    { label: 'result', value: { type: 'result', app: tinyRecord } },
    {
      label: 'failure',
      value: {
        type: 'failure',
        reason: 'could not produce a buildable app',
        attempts: 3,
        diagnostics: [{ kind: 'BUILD', hint: 'try a simpler layout' }],
      },
    },
  ];
  for (const { label, value } of samples) {
    const parsed = GenerationEvent.parse(structuredClone(value));
    eq(`round-trip ${label}`, parsed, value);
  }

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
  check(
    'Diagnostic accepts stub BUILD_FAILURE kind',
    Diagnostic.safeParse({ kind: 'BUILD_FAILURE', hint: 'try again' }).success,
  );
  check(
    'Diagnostic accepts optional severity + message',
    Diagnostic.safeParse({
      kind: 'parse_error',
      severity: 'error',
      message: 'Could not parse source.',
      hint: 'Return one valid TypeScript module.',
    }).success,
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
  check(
    'Usage accepts integers',
    Usage.safeParse({ promptTokens: 1, completionTokens: 2, totalTokens: 3 }).success,
  );

  // §1.6 — request shapes.
  check('GenerateRequest requires prompt', !GenerateRequest.safeParse({}).success);
  check('GenerateRequest app is optional', GenerateRequest.safeParse({ prompt: 'p' }).success);
  check(
    'GenerateRequest app.source is optional (legacy install with no tracked source)',
    GenerateRequest.safeParse({ prompt: 'p', app: { manifest: {}, schema: {} } }).success,
  );
  check(
    'GenerateRequest app with full source ok',
    GenerateRequest.safeParse({ prompt: 'p', app: { source: 's', manifest: {}, schema: {} } })
      .success,
  );
  const withAppliedSchema = GenerateRequest.safeParse({
    prompt: 'p',
    app: { source: 's', manifest: {}, schema: {}, appliedSchema: { name: { type: 'text' } } },
  });
  check('GenerateRequest app.appliedSchema is accepted', withAppliedSchema.success);
  check(
    'GenerateRequest app.appliedSchema round-trips',
    withAppliedSchema.success &&
      JSON.stringify(withAppliedSchema.data.app?.appliedSchema) ===
        JSON.stringify({ name: { type: 'text' } }),
  );
  check(
    'GenerateRequest app.appliedSchema is optional (absent baseline is empty)',
    GenerateRequest.safeParse({ prompt: 'p', app: { source: 's', manifest: {}, schema: {} } })
      .success,
  );
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
  check('RewriteResponse shape', RewriteResponse.safeParse({ rewrittenPrompt: 'r' }).success);

  // AppContext — the shared display-name-only edit context, and its use in ClarifyRequest.
  check('AppContext accepts a bare name', AppContext.safeParse({ name: 'Tip Splitter' }).success);
  check('AppContext requires a name', !AppContext.safeParse({ collections: [] }).success);
  const described = AppContext.safeParse({
    name: 'Habit Tracker',
    collections: [{ name: 'Completions', fields: ['Date'] }],
    description: 'Tracks daily habit completions with a streak count.',
  });
  check('AppContext accepts a description', described.success);
  check(
    'AppContext round-trips name, collections, and description',
    described.success &&
      described.data.name === 'Habit Tracker' &&
      described.data.collections?.[0]?.name === 'Completions' &&
      described.data.description === 'Tracks daily habit completions with a streak count.',
  );
  check('AppContext description is optional', AppContext.safeParse({ name: 'Tip Splitter' }).data?.description === undefined);

  check('ClarifyRequest accepts a bare prompt (a new app)', ClarifyRequest.safeParse({ prompt: 'a water tracker' }).success);
  check(
    'ClarifyRequest app is optional and, absent, stays absent',
    ClarifyRequest.safeParse({ prompt: 'p' }).data?.app === undefined,
  );
  const clarifyWithApp = ClarifyRequest.safeParse({
    prompt: 'add a fruit tea section',
    app: { name: 'Tea Menu', description: 'A menu app listing teas by category.' },
  });
  check('ClarifyRequest accepts an app context (an edit)', clarifyWithApp.success);
  check(
    'ClarifyRequest app context round-trips',
    clarifyWithApp.success &&
      clarifyWithApp.data.app?.name === 'Tea Menu' &&
      clarifyWithApp.data.app.description === 'A menu app listing teas by category.',
  );

  // ApiError — the shape every non-SSE /v1/* error body validates against.
  check(
    'ApiError accepts error + non-empty hint',
    ApiError.safeParse({ error: 'model_failure', hint: 'retry the rewrite' }).success,
  );
  check('ApiError rejects empty hint', !ApiError.safeParse({ error: 'x', hint: '' }).success);
  check('ApiError rejects missing hint', !ApiError.safeParse({ error: 'x' }).success);
  const deviceIdErrorValue = { error: 'missing_device_id', hint: 'send x-whim-device' };
  check('ApiError accepts a DeviceIdError value', ApiError.safeParse(deviceIdErrorValue).success);
  check(
    'DeviceIdError still rejects an unrecognized error value',
    !DeviceIdError.safeParse({ error: 'model_failure', hint: 'retry the rewrite' }).success,
  );

  // GenerationEvent stage stays closed at plan|generate|check|run|repair — no `rewrite` member.
  check(
    'GenerationEvent rejects a rewrite stage',
    !GenerationEvent.safeParse({ type: 'stage', stage: 'rewrite', status: 'start' }).success,
  );

  // Contract-level stream invariant helper (exactly one terminal, last).
  const stream: GenerationEvent[] = [
    { type: 'stage', stage: 'plan', status: 'start' },
    { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    { type: 'result', app: tinyRecord },
  ];
  const terminals = stream.filter((e) => e.type === 'result' || e.type === 'failure');
  check('exactly one terminal event', terminals.length === 1);
  check('terminal event is last', stream.at(-1)?.type === 'result');

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
  eq('server runtime deps are exactly the allowed set', serverDeps, [
    '@hono/node-server',
    '@whim/contract',
    'hono',
    'pino',
  ]);
  check('server has no React-adjacent dep', !serverDeps.some(isReactAdjacent));

  // The pretty printer is a HUMAN convenience, not part of the service: the server must run with
  // structured JSON where it is absent (spec "The service runs without the pretty printer"), so it
  // may never appear under `dependencies`.
  const serverPkg = JSON.parse(readFileSync(path.join(root, 'server/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  check('pino-pretty is not a server runtime dependency', !('pino-pretty' in (serverPkg.dependencies ?? {})));
  check('pino-pretty is a server dev dependency', 'pino-pretty' in (serverPkg.devDependencies ?? {}));
}
