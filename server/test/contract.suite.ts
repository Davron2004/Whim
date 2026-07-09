/**
 * Contract tests (SPEC.md §1, §2): every GenerationEvent variant round-trips, mandatory-hint
 * Diagnostic, install-state-free WireAppRecord, closed-union rejection, one Usage shape, request
 * shapes, and the per-package dependency budget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  Diagnostic,
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
    'GenerateRequest app requires full source (no diff)',
    !GenerateRequest.safeParse({ prompt: 'p', app: { manifest: {}, schema: {} } }).success,
  );
  check(
    'GenerateRequest app with full source ok',
    GenerateRequest.safeParse({ prompt: 'p', app: { source: 's', manifest: {}, schema: {} } })
      .success,
  );
  check('RewriteRequest shape', RewriteRequest.safeParse({ prompt: 'p' }).success);
  check('RewriteResponse shape', RewriteResponse.safeParse({ rewrittenPrompt: 'r' }).success);

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
  ]);
  check('server has no React-adjacent dep', !serverDeps.some(isReactAdjacent));
}
