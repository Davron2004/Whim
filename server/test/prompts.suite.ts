/**
 * server/test/prompts.suite.ts — chain-2's suite: the model-client adapter's own contract (design
 * D3's "model id is a parameter" scenario, plus the "no live network" guards it depends on), and
 * the four prompt-assembly tripwires from spec "Prompt assembly has one source of truth per input"
 * (task 2.5). Registered into `server/test/acceptance.ts` alongside the other suites (task 7.5).
 *
 * Deterministic throughout: every model call goes through `ScriptedModelClient` or an
 * `OpenRouterClient` wired to a fake `fetch` (never the real network), and the whole file passes
 * with `OPENROUTER_API_KEY` unset — it is never read here.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { check, eq, caught, section } from './harness';
import { OpenRouterClient, OpenRouterNetworkError } from '../src/openrouter';
import type { FetchFn } from '../src/openrouter';
import { openRouterModelClient, type ModelRoster } from '../src/generation/model';
import { ScriptedModelClient, ScriptedModelClientExhaustedError, ScriptedModelClientRoleMismatchError, noNetworkTransport } from './scripted-model';
import type { ScriptedTurn } from './scripted-model';
import { loadSdkReference, loadFewShotExamples, loadPromptInputs, PromptInputError } from '../src/generation/prompts/inputs';
import {
  buildRewriteMessages,
  buildPlanMessages,
  buildGenerateMessages,
  buildRepairMessages,
  type PromptPlan,
} from '../src/generation/prompts';
import { runStaticChecks } from '../../checks/index';
import type { GenerateRequest, Diagnostic } from '@whim/contract';

const repoRoot = path.resolve(process.cwd());

async function drain(iter: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of iter) out.push(String(v));
  return out;
}

// ── §Model client adapter ─────────────────────────────────────────────────────

function makeSseFetch(frames: string[], captureCall?: (call: { url: string; init?: RequestInit }) => void): FetchFn {
  return async (input, init) => {
    captureCall?.({ url: String(input), init });
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

const SUCCESS_FRAMES = [
  'data: {"id":"gen-adapter-1","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n',
  'data: {"id":"gen-adapter-1","choices":[{"delta":{}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
  'data: [DONE]\n\n',
];

async function testModelClientAdapter(): Promise<void> {
  section('Model client adapter (openRouterModelClient) — fake transport, no live network');

  // "The model id is a parameter": the resolved model id appears verbatim in the outgoing request.
  {
    let captured: { url: string; init?: RequestInit } | undefined;
    const openRouter = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, (call) => { captured = call; }));
    const client = openRouterModelClient(openRouter);
    const { deltas } = client.stream({ model: 'test-vendor/engineer-model', messages: [{ role: 'user', content: 'hi' }] });
    await drain(deltas);

    check('adapter: request captured', captured !== undefined);
    const body = JSON.parse((captured?.init?.body as string) ?? '{}') as Record<string, unknown>;
    eq('adapter: model id passthrough is verbatim', body.model, 'test-vendor/engineer-model');
  }

  // The adapter forwards the abort signal (structural pass-through, no re-shaping).
  {
    const controller = new AbortController();
    let captured: { url: string; init?: RequestInit } | undefined;
    const openRouter = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, (call) => { captured = call; }));
    const client = openRouterModelClient(openRouter);
    const { deltas } = client.stream({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] }, controller.signal);
    await drain(deltas);
    check('adapter: abort signal forwarded', captured?.init?.signal === controller.signal);
  }

  // "The gate never reaches the network": noNetworkTransport throws, synchronously, before any real fetch.
  {
    const openRouter = new OpenRouterClient(noNetworkTransport);
    const client = openRouterModelClient(openRouter);
    const { deltas, usage } = client.stream({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] });
    const err = await caught(async () => { await drain(deltas); });
    // The same throw path rejects `usage` (openrouter.ts's own contract) — await it too so it is
    // never left an unhandled rejection.
    const usageErr = await caught(async () => { await usage; });
    check(
      'noNetworkTransport: refuses any request',
      err instanceof OpenRouterNetworkError && err.cause instanceof Error && /refused to fetch/.test(err.cause.message),
    );
    check('noNetworkTransport: usage promise rejects with the same error, not left unhandled', usageErr === err);
  }
}

// ── §ScriptedModelClient protocol ─────────────────────────────────────────────

type RecordedTurn = Pick<ScriptedTurn, 'deltas' | 'usage' | 'id'>;

function readModelFixture(name: string): RecordedTurn {
  const raw = fs.readFileSync(path.join(repoRoot, 'server', 'test', 'fixtures', 'model', name), 'utf8');
  return JSON.parse(raw) as RecordedTurn;
}

async function testScriptedModelClient(): Promise<void> {
  section('ScriptedModelClient — replays recorded turns, asserts role, exhausts loudly');

  const roster: ModelRoster = { rewrite: 'vendor/rewrite-1', engineer: 'vendor/engineer-1' };
  const rewriteFixture = readModelFixture('rewrite-turn.json');
  const engineerFixture = readModelFixture('engineer-turn.json');

  const scripted = new ScriptedModelClient(roster, [
    { role: 'rewrite', ...rewriteFixture },
    { role: 'engineer', ...engineerFixture },
  ]);

  const rewriteResult = scripted.stream({ model: roster.rewrite, messages: [{ role: 'user', content: 'a timer' }] });
  const rewriteDeltas = await drain(rewriteResult.deltas);
  eq('scripted: rewrite turn replays its deltas in order', rewriteDeltas.join(''), rewriteFixture.deltas.join(''));
  eq('scripted: rewrite turn usage matches the fixture', await rewriteResult.usage, rewriteFixture.usage);
  eq('scripted: rewrite turn id matches the fixture', await rewriteResult.id, rewriteFixture.id);

  const engineerResult = scripted.stream({ model: roster.engineer, messages: [{ role: 'user', content: 'go' }] });
  await drain(engineerResult.deltas);
  eq('scripted: requests received are recorded in order', scripted.requests.map((r) => r.role), ['rewrite', 'engineer']);

  const exhausted = await caught(async () => { scripted.stream({ model: roster.engineer, messages: [] }); });
  check('scripted: exhausted script throws ScriptedModelClientExhaustedError', exhausted instanceof ScriptedModelClientExhaustedError);

  const mismatchScript = new ScriptedModelClient(roster, [{ role: 'engineer', deltas: ['x'] }]);
  const mismatch = await caught(async () => { mismatchScript.stream({ model: roster.rewrite, messages: [] }); });
  check('scripted: wrong-role request throws ScriptedModelClientRoleMismatchError', mismatch instanceof ScriptedModelClientRoleMismatchError);

  // A scripted turn can raise the wrapper's own typed error mid-generate (spec "A model failure is
  // an honest failure") — both the deltas iterator and the usage promise carry it.
  const failing = new ScriptedModelClient(roster, [{ role: 'engineer', deltas: ['partial'], error: new Error('boom') }]);
  const { deltas: failDeltas, usage: failUsage } = failing.stream({ model: roster.engineer, messages: [] });
  const deltaErr = await caught(async () => { await drain(failDeltas); });
  check('scripted: a turn error throws from the deltas iterator', deltaErr instanceof Error && deltaErr.message === 'boom');
  const usageErr = await caught(async () => { await failUsage; });
  check('scripted: a turn error rejects the usage promise', usageErr instanceof Error && (usageErr as Error).message === 'boom');
}

// ── §Prompt input loading ─────────────────────────────────────────────────────

async function testPromptInputLoading(): Promise<void> {
  section('Prompt inputs — load from disk, fail loudly when missing');

  const reference = loadSdkReference(repoRoot);
  check('sdk reference: non-empty', reference.trim().length > 0);

  const examples = loadFewShotExamples(repoRoot);
  check('few-shot: non-empty curated list', examples.length > 0);
  check('few-shot: excludes latency-probe.app.tsx', !examples.some((e) => e.name === 'latency-probe.app.tsx'));
  check('few-shot: excludes the adversarial/ subdirectory', !examples.some((e) => e.name.includes('/')));

  const missingRefErr = await caught(async () => { loadSdkReference('/nonexistent-whim-root'); });
  check('sdk reference: missing input fails loudly', missingRefErr instanceof PromptInputError);

  const missingFixturesErr = await caught(async () => { loadFewShotExamples('/nonexistent-whim-root'); });
  check('few-shot: missing fixtures dir fails loudly', missingFixturesErr instanceof PromptInputError);
}

// ── §Message builders — no empty required section ─────────────────────────────

const PLAN: PromptPlan = {
  screens: [{ name: 'Home', purpose: 'the only screen' }],
  initial: 'Home',
  state: ['count'],
  capabilities: [],
  storageKeys: [],
};

const NEW_APP_REQUEST: GenerateRequest = { prompt: 'a tip splitter' };
const EDIT_REQUEST: GenerateRequest = {
  prompt: 'add a dark mode toggle',
  app: { source: 'export default {};', manifest: { capabilities: [] }, schema: {} },
};

function assertNonEmptyMessages(label: string, messages: { role: string; content: string }[]): void {
  check(`${label}: at least one message`, messages.length > 0);
  for (const m of messages) {
    check(`${label}: ${m.role} message is non-empty`, m.content.trim().length > 0);
  }
}

async function testMessageBuilders(): Promise<void> {
  section('Prompt message builders — required sections are never empty');

  const inputs = loadPromptInputs(repoRoot);

  const rewriteMessages = buildRewriteMessages({ request: { prompt: 'a timer' } });
  assertNonEmptyMessages('rewrite', rewriteMessages);
  check('rewrite: user message carries the prompt verbatim', rewriteMessages.some((m) => m.content === 'a timer'));

  const planMessages = buildPlanMessages({ request: NEW_APP_REQUEST, schemaContext: '' });
  assertNonEmptyMessages('plan (new app)', planMessages);

  const planReaskMessages = buildPlanMessages({
    request: EDIT_REQUEST,
    schemaContext: "collection 'notes': new field IDs start above 7",
    priorFailureReason: 'initial screen "Missing" is not declared',
  });
  assertNonEmptyMessages('plan (re-ask, edit)', planReaskMessages);
  check(
    'plan: re-ask carries the prior failure reason',
    planReaskMessages.some((m) => m.content.includes('initial screen "Missing" is not declared')),
  );
  check(
    'plan: schema context reaches the prompt',
    planReaskMessages.some((m) => m.content.includes('new field IDs start above 7')),
  );

  const generateMessages = buildGenerateMessages({ request: NEW_APP_REQUEST, plan: PLAN, schemaContext: '' }, inputs);
  assertNonEmptyMessages('generate', generateMessages);
  check('generate: sdk reference reaches the system message verbatim', generateMessages.some((m) => m.content.includes(inputs.sdkReference)));
  check(
    'generate: every few-shot example reaches the system message',
    inputs.fewShotExamples.every((ex) => generateMessages.some((m) => m.content.includes(ex.source))),
  );

  const diagnostics: Diagnostic[] = [
    { kind: 'raw_timer', severity: 'error', message: 'raw setTimeout', hint: 'use delay/interval instead' },
    { kind: 'unused_capability', severity: 'warning', message: 'cues declared but unused', hint: 'remove it or use it' },
  ];
  const repairMessages = buildRepairMessages(
    { request: EDIT_REQUEST, plan: PLAN, currentSource: 'export default {};', diagnostics, schemaContext: '' },
    inputs,
  );
  assertNonEmptyMessages('repair', repairMessages);
  check('repair: current source reaches the prompt', repairMessages.some((m) => m.content.includes('export default {};')));
  check('repair: diagnostics reach the prompt verbatim (kind)', repairMessages.some((m) => m.content.includes('raw_timer')));
  check('repair: diagnostics reach the prompt verbatim (hint)', repairMessages.some((m) => m.content.includes('use delay/interval instead')));
}

// ── §Tripwire 1: every vc-sdk runtime value export is documented ─────────────

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function exportedVariableNames(stmt: ts.VariableStatement): string[] {
  return stmt.declarationList.declarations.filter((decl) => ts.isIdentifier(decl.name)).map((decl) => (decl.name as ts.Identifier).text);
}

function exportedNamedExportNames(stmt: ts.ExportDeclaration): string[] {
  if (stmt.isTypeOnly || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return [];
  return stmt.exportClause.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text);
}

/** Runtime VALUE export names of one top-level statement, or `[]` if it exports no value (a type,
 *  an interface, or nothing). */
function exportedValueNames(stmt: ts.Statement): string[] {
  if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) return exportedVariableNames(stmt);
  if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt) && stmt.name) return [stmt.name.text];
  if (ts.isExportDeclaration(stmt)) return exportedNamedExportNames(stmt);
  return [];
}

/** Runtime VALUE export names of `src/sdk/index.tsx` (the `vc-sdk` barrel) — syntactic only (no
 *  type-checker), mirroring `checks/internal/parse.ts`'s syntax-only discipline. Skips every
 *  type-only export (`export type ...`, `export interface`, per-specifier `export { type X }`). */
function vcSdkValueExportNames(): string[] {
  const sdkPath = path.join(repoRoot, 'src', 'sdk', 'index.tsx');
  const source = fs.readFileSync(sdkPath, 'utf8');
  const sourceFile = ts.createSourceFile(sdkPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sourceFile.statements.flatMap(exportedValueNames);
}

async function testExportsDocumented(): Promise<void> {
  section('Tripwire: every vc-sdk runtime value export is documented in docs/sdk-reference.md');

  const reference = loadSdkReference(repoRoot);
  const exportNames = vcSdkValueExportNames();
  check('vc-sdk barrel: at least one value export found (sanity)', exportNames.length > 5);

  for (const name of exportNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const documented = new RegExp(`\\b${escaped}\\b`).test(reference);
    check(`vc-sdk export "${name}" is documented in docs/sdk-reference.md`, documented, `missing export "${name}"`);
  }
}

// ── §Tripwire 2: every curated few-shot fixture is honest ────────────────────

async function testFewShotFixturesAreHonest(): Promise<void> {
  section('Tripwire: every curated few-shot fixture yields a zero-diagnostic CheckReport');

  const examples = loadFewShotExamples(repoRoot);
  for (const example of examples) {
    const report = runStaticChecks(example.source, { filename: example.name });
    check(
      `few-shot fixture "${example.name}" is zero-diagnostic`,
      report.ok === true && report.diagnostics.length === 0,
      report.diagnostics.length > 0 ? JSON.stringify(report.diagnostics) : undefined,
    );
  }
}

// ── §Tripwire 3 (covered above) + §Tripwire 4: no model id literal ───────────

const MODEL_ID_LIKE = /^[a-z0-9][a-z0-9._-]{1,63}\/[a-z0-9][a-z0-9._:-]{1,63}$/i;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFilesUnder(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

function stringLiteralsIn(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const literals: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return literals;
}

async function testNoModelIdLiteral(): Promise<void> {
  section('Tripwire: no model id appears as a literal in server/src/generation/');

  const generationDir = path.join(repoRoot, 'server', 'src', 'generation');
  const files = tsFilesUnder(generationDir);
  check('model-id tripwire: scanned at least one file (sanity)', files.length > 0);

  for (const file of files) {
    const offenders = stringLiteralsIn(file).filter((s) => MODEL_ID_LIKE.test(s));
    check(
      `no model-id-shaped literal in ${path.relative(repoRoot, file)}`,
      offenders.length === 0,
      offenders.length > 0 ? offenders.join(', ') : undefined,
    );
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runPromptsTests(): Promise<void> {
  await testModelClientAdapter();
  await testScriptedModelClient();
  await testPromptInputLoading();
  await testMessageBuilders();
  await testExportsDocumented();
  await testFewShotFixturesAreHonest();
  await testNoModelIdLiteral();
}
