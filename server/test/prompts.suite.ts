/**
 * server/test/prompts.suite.ts — chain-2's suite: the model-client adapter's own contract (design
 * D3's "model id is a parameter" scenario, plus the "no live network" guards it depends on), and
 * the four prompt-assembly tripwires from spec "Prompt assembly has one source of truth per input"
 * (task 2.5). Registered into `server/test/acceptance.ts` alongside the other suites (task 7.5).
 *
 * It also owns the edit turn (spec "The edit turn sees the app it is changing", "The storage-surface
 * instruction and the drift check read one scanner", "Generation allocates burned field IDs above
 * the accumulated floor"): the builders directly, and — because "one scanner, two consumers" is a
 * property of the wiring, not of either end — one real `GenerationMachine` run whose fake check
 * stage records the `CheckContext` it was handed, asserted against the prompts the same run built.
 *
 * Deterministic throughout: every model call goes through `ScriptedModelClient` or an
 * `OpenRouterClient` wired to a fake `fetch` (never the real network), and the whole file passes
 * with `OPENROUTER_API_KEY` unset — it is never read here.
 *
 * chain-4 (public-generation-server) adds the content-policy rating-rule tripwires at the bottom
 * (spec content-policy "The 13+ content policy has one written source"): a missing document
 * section fails loudly, every system message that authors shipped source (rewrite, generate,
 * repair) carries the rating rule verbatim while the plan turn does not, and no copy of either
 * document section exists elsewhere in source.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { check, eq, caught, section } from './harness';
import { captureLogs } from './log-capture';
import { OpenRouterClient } from '../src/openrouter';
import type { FetchFn } from '../src/openrouter';
import { defaultModelRoster, openRouterModelClient, type ModelDelta, type ModelRoster } from '../src/generation/model';
import { ScriptedModelClient } from './scripted-model';
import type { CapturedRequest } from './scripted-model';
import { loadSdkReference, loadFewShotExamples, loadPromptInputs, loadContentPolicyDocument, PromptInputError } from '../src/generation/prompts/inputs';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import {
  buildRewriteMessages,
  buildClarifyMessages,
  buildPlanMessages,
  buildGenerateMessages,
  buildRepairMessages,
  CURRENT_SOURCE_HEADING,
  SOURCE_INCLUDED_CLAIM,
  STORAGE_LOCATIONS_HEADING,
  IDENTITY_CONTINUITY,
  type PromptPlan,
} from '../src/generation/prompts';
import { GenerationMachine, type CheckContext, type CheckStage } from '../src/generation/machine';
import { parseJsonBlock } from '../src/generation/json-block';
import { runStaticChecks } from '../../checks/index';
import { FIELD_TYPES } from '../../src/host/storage-engine/contract';
import type { GenerateRequest, Diagnostic, GenerationEvent } from '@whim/contract';

const repoRoot = path.resolve(process.cwd());

/** Drains a `ModelDelta` stream into its text, in arrival order — reasoning deltas included, since
 *  every call site here either doesn't care about the content (draining to unblock `usage`) or
 *  compares against a text-only fixture (no test in this file scripts a reasoning delta). */
async function drain(iter: AsyncIterable<ModelDelta>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of iter) out.push(delta.text);
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

  // A full ModelRequest through the adapter: every field `openRouterModelClient` claims to map
  // (design D3's "thin pass-through") must actually reach the outgoing body, and the abort signal
  // must reach the transport by identity — not just the one field (model id) a narrower test would
  // catch a dropped `maxTokens` or `reasoning` from missing entirely.
  {
    const controller = new AbortController();
    let captured: { url: string; init?: RequestInit } | undefined;
    const openRouter = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, (call) => { captured = call; }));
    const client = openRouterModelClient(openRouter);
    const { deltas } = client.stream(
      {
        model: 'test-vendor/engineer-model',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 4096,
        reasoning: 'on',
        role: 'generate',
      },
      controller.signal,
    );
    await drain(deltas);

    check('adapter: request captured', captured !== undefined);
    const body = JSON.parse((captured?.init?.body as string) ?? '{}') as Record<string, unknown>;
    eq('adapter: model id passthrough is verbatim', body.model, 'test-vendor/engineer-model');
    eq('adapter: maxTokens reaches the wire as max_tokens', body.max_tokens, 4096);
    eq('adapter: reasoning:\'on\' reaches the wire as {enabled:true}', body.reasoning, { enabled: true });
    check('adapter: abort signal forwarded by identity', captured?.init?.signal === controller.signal);
    check('adapter: the role label never reaches the wire body', !('role' in body));
  }

  // The negative of the reasoning case: `default` (the rewrite/clarify shape) never asks for it.
  {
    let captured: { url: string; init?: RequestInit } | undefined;
    const openRouter = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, (call) => { captured = call; }));
    const client = openRouterModelClient(openRouter);
    const { deltas } = client.stream({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }], reasoning: 'default', role: 'rewrite' });
    await drain(deltas);
    const body = JSON.parse((captured?.init?.body as string) ?? '{}') as Record<string, unknown>;
    check('adapter: reasoning:\'default\' never asks the provider for it', !('reasoning' in body));
    check('adapter: maxTokens unset is never sent', !('max_tokens' in body));
  }
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

  // ── rewrite: the app an edit is changing (spec "A rewrite for an edit carries the app it is
  // changing"). `app` present ⇒ this describes a CHANGE to an existing app; absent ⇒ a new app.
  const editRewriteMessages = buildRewriteMessages({
    request: {
      prompt: 'add a streak count',
      app: { name: 'Habit Tracker', collections: [{ name: 'Completions', fields: ['Date', 'Note'] }] },
    },
  });
  assertNonEmptyMessages('rewrite (edit)', editRewriteMessages);
  const editRewriteUser = editRewriteMessages.find((m) => m.role === 'user')?.content ?? '';
  check('rewrite (edit): the prompt still reaches the user message', editRewriteUser.includes('add a streak count'));
  check('rewrite (edit): the app’s current name reaches the prompt', editRewriteUser.includes('Habit Tracker'));
  check(
    'rewrite (edit): the concepts it already keeps reach the prompt',
    editRewriteUser.includes('Completions') && editRewriteUser.includes('Date, Note'),
  );
  const newAppRewriteUser = rewriteMessages.find((m) => m.role === 'user')?.content ?? '';
  check(
    'rewrite (new app): no continuity language at all — the user message is the prompt and nothing else',
    newAppRewriteUser === 'a timer',
  );
  const storeNothingRewriteUser =
    buildRewriteMessages({ request: { prompt: 'make it blue', app: { name: 'Tip Splitter' } } }).find(
      (m) => m.role === 'user',
    )?.content ?? '';
  check(
    'rewrite (edit, no collections): names the app but renders no dangling "keeps track of" heading',
    storeNothingRewriteUser.includes('Tip Splitter') && !storeNothingRewriteUser.includes('keeps track of'),
  );

  // ── clarify: an edit carries the app it is changing, and never asks what the app already is
  // (spec-parallel to the rewrite edit case above — same AppContext, same "this is settled" facts).
  const clarifyNewApp = buildClarifyMessages({ request: { prompt: 'a water tracker' } });
  assertNonEmptyMessages('clarify (new app)', clarifyNewApp);
  const clarifyNewAppUser = clarifyNewApp.find((m) => m.role === 'user')?.content ?? '';
  check(
    'clarify (new app): the user message is the bare prompt, no continuity language',
    clarifyNewAppUser === 'a water tracker',
  );

  const clarifyEdit = buildClarifyMessages({
    request: {
      prompt: 'add a fruit tea section',
      app: {
        name: 'Tea Menu',
        collections: [{ name: 'Teas', fields: ['Name', 'Category'] }],
        description: 'A menu app that lists teas by category.',
      },
    },
  });
  assertNonEmptyMessages('clarify (edit)', clarifyEdit);
  const clarifyEditUser = clarifyEdit.find((m) => m.role === 'user')?.content ?? '';
  check('clarify (edit): the prompt still reaches the user message', clarifyEditUser.includes('add a fruit tea section'));
  check('clarify (edit): the app name reaches the prompt', clarifyEditUser.includes('Tea Menu'));
  check('clarify (edit): what it already keeps reaches the prompt', clarifyEditUser.includes('Teas') && clarifyEditUser.includes('Name, Category'));
  check('clarify (edit): the description reaches the prompt', clarifyEditUser.includes('A menu app that lists teas by category.'));

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

// ── §The edit turn — what an edit prompt does and does not claim ─────────────

/** A previous version that reads one kv key and one record collection through the real `vc-sdk`
 *  binding the scanner resolves — the source of truth for both continuity assertions below. */
const PREVIOUS_SOURCE = [
  "import { defineApp, storage } from 'vc-sdk';",
  "const history = storage.kv.get('habitCompletionHistory');",
  "const done = storage.records.list('Completions');",
  "export default defineApp({ name: 'Habits', initial: 'Home', screens: {} });",
].join('\n');

/** Accumulated union with a single collection whose highest burned ordinal is 7 (spec scenario
 *  "The floor reaches the model"). Shaped as the storage engine's `AppliedSchema`, since that is
 *  what `burnedIdFloor` reads. */
const APPLIED_SCHEMA = {
  collections: [
    {
      id: 'c1',
      active: [
        { id: 'f1', type: 'text' },
        { id: 'f7', type: 'number' },
      ],
      retired: [],
    },
  ],
};

const EDIT_WITH_SOURCE: GenerateRequest = {
  prompt: 'add a streak counter',
  app: {
    source: PREVIOUS_SOURCE,
    manifest: { capabilities: ['storage'] },
    schema: {},
    appliedSchema: APPLIED_SCHEMA,
  },
};

const EDIT_WITHOUT_SOURCE: GenerateRequest = {
  prompt: 'add a streak counter',
  app: { manifest: { capabilities: ['storage'] }, schema: {}, appliedSchema: APPLIED_SCHEMA },
};

const SURFACE_LIST = ['- kv key "habitCompletionHistory"', '- record collection "Completions"'].join('\n');

function userContent(messages: { role: string; content: string }[]): string {
  return messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
}

async function testEditTurnPrompt(): Promise<void> {
  section('The edit turn — current source, identity continuity, storage locations');

  const inputs = loadPromptInputs(repoRoot);

  // Presence/absence of the three section markers across every case — never the full sentence
  // around them, so a reword of the instruction text doesn't fail this test.
  const withSource = userContent(
    buildGenerateMessages(
      { request: EDIT_WITH_SOURCE, plan: PLAN, schemaContext: '', storageSurface: SURFACE_LIST },
      inputs,
    ),
  );
  check('generate (edit): the current-source block holds the source verbatim', withSource.includes(`${CURRENT_SOURCE_HEADING}\n${PREVIOUS_SOURCE}`));
  check('generate (edit): the prompt claims the source is included — and it is', withSource.includes(SOURCE_INCLUDED_CLAIM));
  check('generate (edit): identity continuity is carried', withSource.includes(IDENTITY_CONTINUITY));
  check('generate (edit): both storage locations are named', withSource.includes('habitCompletionHistory') && withSource.includes('Completions'));
  check('generate (edit): the storage-locations section is rendered', withSource.includes(STORAGE_LOCATIONS_HEADING));

  // Source absent (or failed pre-flight): the honest-regeneration path, unchanged — and no claim
  // that source is included, because it is not.
  const withoutSource = userContent(
    buildGenerateMessages({ request: EDIT_WITHOUT_SOURCE, plan: PLAN, schemaContext: '' }, inputs),
  );
  check('generate (edit, no source): no current-source block', !withoutSource.includes(CURRENT_SOURCE_HEADING));
  check('generate (edit, no source): no claim that source is included', !withoutSource.includes(SOURCE_INCLUDED_CLAIM));
  check('generate (edit, no source): the honest-regeneration instruction survives', withoutSource.includes('Regenerate it honestly from the manifest and schema'));
  check('generate (edit, no source): no storage-locations section', !withoutSource.includes(STORAGE_LOCATIONS_HEADING));
  check('generate (edit, no source): identity continuity still applies', withoutSource.includes(IDENTITY_CONTINUITY));

  // A new app is unconstrained: none of the three continuity markers.
  const newApp = userContent(buildGenerateMessages({ request: NEW_APP_REQUEST, plan: PLAN, schemaContext: '' }, inputs));
  check('generate (new app): no current-source block', !newApp.includes(CURRENT_SOURCE_HEADING));
  check('generate (new app): no storage-locations section', !newApp.includes(STORAGE_LOCATIONS_HEADING));
  check('generate (new app): no identity-continuity section', !newApp.includes(IDENTITY_CONTINUITY));

  // The plan turn does not render the source (design D2) — so it must not claim to.
  const planUser = userContent(buildPlanMessages({ request: EDIT_WITH_SOURCE, schemaContext: '', storageSurface: SURFACE_LIST }));
  check('plan (edit): no current-source block', !planUser.includes(CURRENT_SOURCE_HEADING));
  check('plan (edit): does not claim the source is included', !planUser.includes(SOURCE_INCLUDED_CLAIM));
  check('plan (edit): still names the storage locations', planUser.includes('habitCompletionHistory'));
}

// ── §Schema context and the one-scan threading, through a real machine run ───

const EDIT_ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-1', 'vendor/engineer-1');
const FAKE_PROMPT_INPUTS: PromptInputs = { sdkReference: 'fake sdk reference', fewShotExamples: [] };

const EDIT_PLAN_JSON = JSON.stringify({
  screens: [{ name: 'Home', purpose: 'the only screen' }],
  initial: 'Home',
  state: [],
  capabilities: ['storage'],
  storageKeys: ['habitCompletionHistory'],
});

async function drainEvents(iter: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

async function testEditTurnThreading(): Promise<void> {
  section('Edit context — one scan per run, fed to both the prompts and the check stage');

  const scripted = new ScriptedModelClient(EDIT_ROSTER, [
    { role: 'plan', deltas: [EDIT_PLAN_JSON] },
    { role: 'engineer', deltas: ['// candidate 1'] },
    { role: 'engineer', deltas: ['// candidate 2'] },
  ]);

  // Every candidate fails its check, so the run is plan → generate → repair → failure: two check
  // calls with nothing else to configure, and build/run provably never reached.
  const seen: CheckContext[] = [];
  const failingCheck: CheckStage = {
    check: (_source, ctx) => {
      seen.push(ctx);
      return {
        diagnostics: [{ kind: 'raw_timer', severity: 'error', message: 'raw setTimeout', hint: 'use delay/interval instead' }],
      };
    },
  };

  const machine = new GenerationMachine({
    model: scripted,
    roster: EDIT_ROSTER,
    promptInputs: FAKE_PROMPT_INPUTS,
    check: failingCheck,
    build: { build: () => { throw new Error('build must not run: every candidate failed its check'); } },
    run: { run: () => { throw new Error('run must not run: every candidate failed its check'); } },
    clock: { now: () => 0 },
    bounds: { repairAttempts: 1 },
  });

  const capture = captureLogs();
  let events: GenerationEvent[];
  try {
    events = await drainEvents(machine.run(EDIT_WITH_SOURCE));
  } finally {
    capture.stop();
  }

  eq('machine: the run ended on its own terms', events.at(-1)?.type, 'failure');
  eq('machine: the check stage saw both candidates', seen.length, 2);
  const baseline = seen[0]?.previousSurface;
  check('machine: the check stage gets the previous source\'s kv key as its drift baseline', baseline?.kvKeys.some((k) => k.name === 'habitCompletionHistory') === true);
  check('machine: the check stage gets the previous source\'s collection too', baseline?.collections.some((c) => c.name === 'Completions') === true);
  check(
    'machine: the source is scanned ONCE per run, not once per candidate',
    baseline !== undefined && seen[1]?.previousSurface === baseline,
  );

  const turns = scripted.requests as CapturedRequest[];
  eq('machine: plan, generate and one repair turn were requested', turns.length, 3);
  const planUser = userContent(turns[0]?.request.messages ?? []);
  const generateUser = userContent(turns[1]?.request.messages ?? []);
  const repairUser = userContent(turns[2]?.request.messages ?? []);

  check('machine: the generate turn carries the pre-flighted source verbatim', generateUser.includes(PREVIOUS_SOURCE));
  // The scenario the whole change rests on: the prompt's list and the checker's baseline are the
  // SAME scan, so the harness cannot teach one set of locations and enforce another.
  const baselineNames = [...(baseline?.kvKeys ?? []), ...(baseline?.collections ?? [])].map((r) => r.name);
  check('machine: sanity — the baseline named something', baselineNames.length === 2);
  check(
    'machine: every location the checker will demand is named in the generate prompt',
    baselineNames.every((name) => generateUser.includes(name)),
  );
  check('machine: the plan turn is fed the same list', baselineNames.every((name) => planUser.includes(name)));

  // §schema context (spec "Generation allocates burned field IDs above the accumulated floor").
  check('machine: the generate prompt states the numeric floor', generateUser.includes('new field IDs start above 7'));
  check('machine: the repair prompt states the numeric floor', repairUser.includes('new field IDs start above 7'));
  check('machine: the floor is stated per collection', generateUser.includes('collection "c1": new field IDs start above 7'));
  check('machine: the prompt asks the model to keep existing IDs (identity continuity is carried)', generateUser.includes(IDENTITY_CONTINUITY));
  check('machine: no avoid-these-IDs instruction survives', !/do not reuse/i.test(generateUser) && !/do not reuse/i.test(repairUser));
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

// ── §Tripwire 1b: the storage schema artifact is documented ──────────────────

/** The reference's storage-schema-artifact section — its heading through to the next heading of the
 *  same or higher level, or `null` when the document has no such section (the failure this tripwire
 *  exists for). Scoped rather than whole-document on purpose: `text` and `bool` also appear as token
 *  names elsewhere in the reference, so only a hit INSIDE this section counts as documentation. */
function schemaArtifactSection(reference: string): string | null {
  const lines = reference.split('\n');
  const start = lines.findIndex((line) => /^#{2,4} .*schema artifact/i.test(line));
  if (start === -1) return null;
  const opener = /^#+/.exec(lines[start]);
  const level = opener ? opener[0].length : 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const heading = /^(#+) /.exec(lines[i]);
    if (heading && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}
async function testSchemaArtifactDocumented(): Promise<void> {
  section('Tripwire: docs/sdk-reference.md documents the storage schema artifact');

  const reference = loadSdkReference(repoRoot);
  const artifactSection = schemaArtifactSection(reference);
  check(
    'sdk reference: a storage schema-artifact section exists',
    artifactSection !== null,
    'no "… schema artifact" heading in docs/sdk-reference.md',
  );
  const body = artifactSection ?? '';

  // The six types come from the engine's own closed set, so adding a seventh without documenting
  // it fails here rather than silently teaching the model an incomplete list.
  for (const type of FIELD_TYPES) {
    check(
      `sdk reference: field type "${type}" is named in the schema-artifact section`,
      new RegExp('[`\'"]' + type + '[`\'"]').test(body),
      `field type "${type}" is undocumented`,
    );
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

// ── §chain-4 tripwires: the content-policy document is the one source ────────

/** A scratch `docs/content-policy.md` under a throwaway cwd, missing whichever section
 *  `omit` names, so `loadContentPolicyDocument` fails loudly instead of touching the real file. */
function scratchContentPolicyCwd(omit: 'Rating rule' | 'Categories'): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-content-policy-'));
  fs.mkdirSync(path.join(cwd, 'docs'));
  const sections = [
    ['Rating rule', 'Build for a general audience aged 13 and up.'],
    ['Categories', '- Graphic violence or gore'],
  ].filter(([heading]) => heading !== omit);
  const doc = sections.map(([heading, body]) => `## ${heading}\n\n${body}`).join('\n\n');
  fs.writeFileSync(path.join(cwd, 'docs', 'content-policy.md'), `# Whim content policy\n\n${doc}\n`, 'utf8');
  return cwd;
}

async function testContentPolicyMissingSectionFailsTheBuild(): Promise<void> {
  section('Tripwire: docs/content-policy.md — a missing section fails loudly, naming it');

  const missingRatingRule = await caught(async () => { loadContentPolicyDocument(scratchContentPolicyCwd('Rating rule')); });
  check(
    'a document with no "Rating rule" section throws PromptInputError naming it',
    missingRatingRule instanceof PromptInputError && /Rating rule/.test(missingRatingRule.message),
  );

  const missingCategories = await caught(async () => { loadContentPolicyDocument(scratchContentPolicyCwd('Categories')); });
  check(
    'a document with no "Categories" section throws PromptInputError naming it',
    missingCategories instanceof PromptInputError && /Categories/.test(missingCategories.message),
  );
}

/** Every turn whose output is authored into shipped app source must carry the rating rule — repair
 *  included, since `REPAIR_INSTRUCTIONS` asks for the FULL corrected source, so a repair is the
 *  last author of what a device runs. The plan turn is deliberately excluded: its JSON is never
 *  delivered, and the rule would only spend tokens there. */
async function testEveryAuthoringPromptCarriesTheRatingRule(): Promise<void> {
  section('Tripwire: the rewrite, generate and repair system messages carry the rating rule verbatim — the plan turn does not');

  const { ratingRule } = loadContentPolicyDocument(repoRoot);
  check('sanity: the real document has a non-empty rating rule', ratingRule.trim().length > 0);

  const inputs = loadPromptInputs(repoRoot);
  const systemOf = (messages: { role: string; content: string }[]): string =>
    messages.find((m) => m.role === 'system')?.content ?? '';

  const covered: { turn: string; system: string }[] = [
    { turn: 'rewrite', system: systemOf(buildRewriteMessages({ request: { prompt: 'a timer' } })) },
    { turn: 'generate', system: systemOf(buildGenerateMessages({ request: NEW_APP_REQUEST, plan: PLAN, schemaContext: '' }, inputs)) },
    {
      turn: 'repair',
      system: systemOf(buildRepairMessages(
        {
          request: EDIT_REQUEST,
          plan: PLAN,
          currentSource: 'export default {};',
          diagnostics: [{ kind: 'raw_timer', severity: 'error', message: 'raw setTimeout', hint: 'use delay/interval instead' }],
          schemaContext: '',
        },
        inputs,
      )),
    },
  ];
  for (const { turn, system } of covered) {
    check(`${turn} system message carries the rating rule verbatim`, system.includes(ratingRule));
  }

  const planSystem = systemOf(buildPlanMessages({ request: NEW_APP_REQUEST, schemaContext: '' }));
  check('plan system message does NOT carry the rating rule (its JSON is never delivered)', !planSystem.includes(ratingRule));
}

async function testContentPolicyNotDuplicatedInSource(): Promise<void> {
  section('Tripwire: no copy of the content-policy document exists in the source tree');

  const { ratingRule, categories } = loadContentPolicyDocument(repoRoot);
  // A short, distinctive slice rather than the whole section: robust to incidental line-wrapping
  // differences while still catching a careless copy-paste.
  const ratingSnippet = ratingRule.slice(0, 40);
  const categoriesSnippet = categories.split('\n').find((line) => line.trim().length > 10) ?? categories.slice(0, 40);

  const scanDirs = [path.join(repoRoot, 'server', 'src'), path.join(repoRoot, 'checks')];
  const files = scanDirs.flatMap((dir) => tsFilesUnder(dir));
  check('duplication tripwire: scanned at least one file (sanity)', files.length > 0);

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const relative = path.relative(repoRoot, file);
    check(`no copy of the rating-rule text in ${relative}`, !text.includes(ratingSnippet));
    check(`no copy of the categories text in ${relative}`, !text.includes(categoriesSnippet));
  }
}

function testJsonBlockParsing(): void {
  section('json-block.ts — parseJsonBlock: tolerant of an unclosed fence');

  const payload = { rewrittenPrompt: 'a tip splitter', plan: [] };

  const closed = parseJsonBlock('```json\n' + JSON.stringify(payload) + '\n```');
  eq('parseJsonBlock: a properly closed fence parses', closed, payload);

  // A reply truncated (context limit, dropped connection) before the closing ``` ever arrives.
  const unclosed = parseJsonBlock('```json\n' + JSON.stringify(payload));
  eq('parseJsonBlock: an UNCLOSED fence still parses', unclosed, payload);

  const bare = parseJsonBlock(JSON.stringify(payload));
  eq('parseJsonBlock: bare JSON (no fence at all) parses', bare, payload);

  check('parseJsonBlock: malformed JSON inside an unclosed fence yields undefined, not a throw', parseJsonBlock('```json\n{ not json') === undefined);
  check('parseJsonBlock: empty input yields undefined', parseJsonBlock('   ') === undefined);
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runPromptsTests(): Promise<void> {
  await testModelClientAdapter();
  await testPromptInputLoading();
  await testMessageBuilders();
  await testEditTurnPrompt();
  await testEditTurnThreading();
  await testExportsDocumented();
  await testSchemaArtifactDocumented();
  await testFewShotFixturesAreHonest();
  await testNoModelIdLiteral();
  await testContentPolicyMissingSectionFailsTheBuild();
  await testEveryAuthoringPromptCarriesTheRatingRule();
  await testContentPolicyNotDuplicatedInSource();
  testJsonBlockParsing();
}
