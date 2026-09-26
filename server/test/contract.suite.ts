/**
 * Contract tests: mandatory-hint
 * Diagnostic, install-state-free WireAppRecord, closed-union rejection, one Usage shape, request
 * shapes, and the per-package dependency budget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as contract from '@whim/contract';
import {
  ApiError,
  CLARIFICATION_OTHER_MAX_CHARS,
  COMPAT_NOTICE_MAX_CHARS,
  Clarification,
  ClarifyResponse,
  ClientEnvelope,
  Compat,
  CompatFallback,
  Diagnostic,
  DiagnosticsBatch,
  DeviceIdError,
  GenerateRequest,
  GenerationEvent,
  ReportResponse,
  RewriteRequest,
  RewriteResponse,
  ServiceRefusalCode,
  Usage,
  WireAppRecord,
  WireEnvelope,
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

/** One valid instance of every `GenerationEvent` arm. */
const ONE_OF_EACH_EVENT: readonly GenerationEvent[] = [
  { type: 'stage', stage: 'plan', status: 'start' },
  { type: 'token', text: 'x' },
  { type: 'thinking', chars: 1 },
  { type: 'diagnostic', diagnostic: { kind: 'type-error', hint: 'declare a type' } },
  { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
  { type: 'queued', position: 3 },
  { type: 'restart' },
  { type: 'result', app: tinyRecord },
  { type: 'failure', reason: 'nope', attempts: 1, diagnostics: [] },
];

/** The two device→server diagnostics bodies refuse a field outside their allowlist rather than
 *  drop it (device-diagnostics "Only an allowlisted projection of an error record leaves the
 *  device"): request bodies the server reads, never a message a client decodes. */
const REFUSING_SCHEMAS: ReadonlySet<string> = new Set(['DiagnosticRecord', 'DiagnosticsBatch']);

interface ZodNode {
  _zod: { def: Record<string, unknown> & { type: string } };
}

function isZodNode(value: unknown): value is ZodNode {
  return typeof value === 'object' && value !== null && '_zod' in value;
}

/** Every object schema reachable from `root` that does not strip unknown keys (a `.strict()` or
 *  `.passthrough()`/`.loose()` catchall), by the path that reaches it. */
function nonStrippingObjects(root: ZodNode, rootName: string): string[] {
  const found: string[] = [];
  const seen = new Set<ZodNode>();
  const visit = (node: unknown, at: string): void => {
    if (!isZodNode(node) || seen.has(node)) return;
    seen.add(node);
    const def = node._zod.def;
    const children: [string, unknown][] = [];
    if (def.type === 'object') {
      if (def.catchall !== undefined) found.push(at);
      for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) children.push([`${at}.${key}`, child]);
    }
    for (const key of ['element', 'innerType', 'keyType', 'valueType', 'in', 'out', 'left', 'right']) {
      if (key in def) children.push([at, def[key]]);
    }
    if (Array.isArray(def.options)) def.options.forEach((option, i) => children.push([`${at}|${i}`, option]));
    for (const [childPath, child] of children) visit(child, childPath);
  };
  visit(root, rootName);
  return found;
}

/** beta-1 design D16 and its `generation-contract` scenarios: the protocol level, the compat
 *  envelope and its frozen vocabulary, the tolerant reader, and the new wire shapes. */
function runForwardCompatibilityTests(): void {
  section('Forward compatibility — the tolerant reader (D16 layer 1)');
  const nonStripping = Object.entries(contract as Record<string, unknown>)
    .filter((entry): entry is [string, ZodNode] => isZodNode(entry[1]) && !REFUSING_SCHEMAS.has(entry[0]))
    .flatMap(([name, schema]) => nonStrippingObjects(schema, name));
  eq('every object schema a client decodes strips unknown fields rather than rejecting them', nonStripping, []);
  eq(
    'the walker finds a planted .strict() and .passthrough(), so the check above is not vacuous',
    [
      ...nonStrippingObjects(ApiError.strict() as unknown as ZodNode, 'strict'),
      ...nonStrippingObjects(GenerationEvent.options[1].passthrough() as unknown as ZodNode, 'loose'),
    ],
    ['strict', 'loose'],
  );

  const extra = { futureField: 'from a later level' };
  const token = GenerationEvent.safeParse({ type: 'token', text: 'x', ...extra });
  eq('a known event with an extra field is used and the field dropped', token.success ? token.data : token.error.issues, { type: 'token', text: 'x' });
  const rewrite = RewriteResponse.safeParse({ rewrittenPrompt: 'r', ...extra });
  eq('a known unary body with an extra field is used and the field dropped', rewrite.success ? rewrite.data : rewrite.error.issues, { rewrittenPrompt: 'r' });
  const error = ApiError.safeParse({ error: 'server_busy', hint: 'h', ...extra });
  eq('an ApiError with an extra field is used and the field dropped', error.success ? error.data : error.error.issues, { error: 'server_busy', hint: 'h' });

  section('Forward compatibility — the compat envelope (D16 layer 3)');
  const compat = { min: 2, fallback: 'skip', notice: 'Update Whim to see the new line.' } as const;
  for (const event of ONE_OF_EACH_EVENT) {
    check(`the "${event.type}" event accepts compat`, GenerationEvent.safeParse({ ...event, compat }).success);
  }
  check('an ApiError accepts compat', ApiError.safeParse({ error: 'eta_unavailable', hint: 'h', compat }).success);
  check('a ClarifyResponse accepts compat', ClarifyResponse.safeParse({ questions: [], compat }).success);
  check('a ReportResponse accepts compat', ReportResponse.safeParse({ reportId: 'r1', compat }).success);
  check('a DeviceIdError is still assignable to ApiError', ApiError.safeParse(DeviceIdError.parse({ error: 'missing_device_id', hint: 'h' })).success);

  for (const fallback of CompatFallback.options) check(`Compat accepts the frozen fallback "${fallback}"`, Compat.safeParse({ min: 2, fallback }).success);
  check('Compat refuses a fallback outside the frozen set', !Compat.safeParse({ min: 2, fallback: 'retry' }).success);
  check('Compat refuses a min below 1', !Compat.safeParse({ min: 0, fallback: 'skip' }).success);
  check('Compat refuses a fractional min', !Compat.safeParse({ min: 1.5, fallback: 'skip' }).success);
  const notice = (length: number): unknown => ({ min: 2, fallback: 'fail', notice: 'n'.repeat(length) });
  check(`Compat accepts a ${COMPAT_NOTICE_MAX_CHARS}-character notice`, Compat.safeParse(notice(COMPAT_NOTICE_MAX_CHARS)).success);
  check(`Compat refuses a ${COMPAT_NOTICE_MAX_CHARS + 1}-character notice`, !Compat.safeParse(notice(COMPAT_NOTICE_MAX_CHARS + 1)).success);

  // `null` is no notice (the oldest installed build reads it so), and never reaches a reader as null.
  const nullNotice = { min: 2, fallback: 'fail', notice: null };
  const readCompat = Compat.safeParse(nullNotice);
  eq('Compat reads a null notice as no notice', readCompat.success ? JSON.stringify(readCompat.data) : readCompat.error.issues, '{"min":2,"fallback":"fail"}');
  const readEnvelope = WireEnvelope.safeParse({ type: 'eta', compat: nullNotice });
  eq('WireEnvelope reads a null notice as no notice', readEnvelope.success ? readEnvelope.data.compat?.notice : readEnvelope.error.issues, undefined);
  const readEvent = GenerationEvent.safeParse({ type: 'token', text: 'x', compat: nullNotice });
  eq('a known event carrying a null notice is used, with no notice', readEvent.success ? readEvent.data.compat?.notice : readEvent.error.issues, undefined);
  for (const unreadable of [{ min: null, fallback: 'skip' }, { min: 2, fallback: null }]) {
    check(`Compat refuses ${JSON.stringify(unreadable)}`, !Compat.safeParse(unreadable).success);
    check(`WireEnvelope refuses ${JSON.stringify(unreadable)}`, !WireEnvelope.safeParse({ type: 'eta', compat: unreadable }).success);
  }

  // `compat: null` is no compat (the oldest installed build reads it so): on the envelope and on
  // every message that accepts compat, it parses to exactly what the message without it parses to.
  type Reader = { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown } } };
  const readAs = (schema: Reader, message: object): unknown => {
    const parsed = schema.safeParse(message);
    return parsed.success ? JSON.stringify(parsed.data) : parsed.error?.issues;
  };
  const withoutCompat: readonly (readonly [string, Reader, object])[] = [
    ['WireEnvelope', WireEnvelope, { type: 'eta' }],
    ...ONE_OF_EACH_EVENT.map((event) => [`the "${event.type}" event`, GenerationEvent, event] as const),
    ['an ApiError', ApiError, { error: 'server_busy', hint: 'h' }],
    ['a ClarifyResponse', ClarifyResponse, { questions: [] }],
    ['a RewriteResponse', RewriteResponse, { rewrittenPrompt: 'r' }],
    ['a ReportResponse', ReportResponse, { reportId: 'r1' }],
  ];
  for (const [name, schema, message] of withoutCompat) {
    const plain = readAs(schema, message);
    check(`setup: ${name} with no compat parses`, typeof plain === 'string');
    eq(`${name} reads compat null as no compat`, readAs(schema, { ...message, compat: null }), plain);
  }

  // Scenario "Unknown event type goes through the envelope": full parsing refuses it, the envelope
  // reads it — its type, its compat, nothing else.
  const future = { type: 'eta', seconds: 30, compat: { min: 2, fallback: 'skip' } };
  check('GenerationEvent.parse refuses an unknown type', !GenerationEvent.safeParse(future).success);
  const envelope = WireEnvelope.safeParse(future);
  eq('WireEnvelope reads an unknown event as its type and compat only', envelope.success ? envelope.data : envelope.error.issues, { type: 'eta', compat: { min: 2, fallback: 'skip' } });
  const odd = WireEnvelope.safeParse({ type: 'eta', compat: { min: 2, fallback: 'retry', notice: 'Try later.' } });
  eq('WireEnvelope still reads a fallback outside the set, so a client can treat it as fail', odd.success ? odd.data.compat : odd.error.issues, { min: 2, fallback: 'retry', notice: 'Try later.' });
  const unknownCode = WireEnvelope.safeParse({ error: 'eta_unavailable', hint: 'h', compat: { min: 2, fallback: 'fail' } });
  eq('WireEnvelope reads an ApiError as its code and compat', unknownCode.success ? unknownCode.data : unknownCode.error.issues, { error: 'eta_unavailable', compat: { min: 2, fallback: 'fail' } });
  check('WireEnvelope refuses an over-long notice', !WireEnvelope.safeParse({ type: 'eta', compat: notice(COMPAT_NOTICE_MAX_CHARS + 1) }).success);

  section('Forward compatibility — queued and restart');
  check('queued with position 3 validates', GenerationEvent.safeParse({ type: 'queued', position: 3 }).success);
  check('restart validates', GenerationEvent.safeParse({ type: 'restart' }).success);
  for (const position of [0, -1, 1.5, undefined]) {
    check(`queued refuses position ${String(position)}`, !GenerationEvent.safeParse({ type: 'queued', position }).success);
  }

  section('Clarify: answer modes and limits');
  const question = { id: 'q', question: 'Which days?', options: ['Mon', 'Tue'] };
  check('a question with select many and a typed option validates', ClarifyResponse.safeParse({ questions: [{ ...question, select: 'many', other: true }] }).success);
  check('a question without an answer mode is refused', !ClarifyResponse.safeParse({ questions: [question] }).success);
  check('a select outside one|many is refused', !ClarifyResponse.safeParse({ questions: [{ ...question, select: 'some', other: false }] }).success);
  const modeled = { ...question, select: 'one', other: false };
  check('zero questions is a valid answer', ClarifyResponse.safeParse({ questions: [] }).success);
  check('four questions are refused', !ClarifyResponse.safeParse({ questions: [modeled, modeled, modeled, modeled] }).success);
  const limit = { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' };
  check('a limit with no questions validates', ClarifyResponse.safeParse({ questions: [], limit }).success);
  check('a limit carrying questions is refused', !ClarifyResponse.safeParse({ questions: [modeled], limit }).success);
  check('a limit with an empty reason is refused', !ClarifyResponse.safeParse({ questions: [], limit: { ...limit, reason: '' } }).success);
  const mentionsClarify = (text: string): boolean => /clarif/i.test(text);
  const arms = GenerationEvent.options.map((arm) => arm.shape.type.value);
  const stages = GenerationEvent.options[0].shape.stage.options;
  check('no event arm and no stage mentions clarification', ![...arms, ...stages].some(mentionsClarify), [...arms, ...stages].join(','));

  section('Clarifications: choices, other and decide');
  const answer = { id: 'q', question: 'Which days?' };
  const accepts = (clarification: unknown): boolean => GenerateRequest.safeParse({ prompt: 'p', clarifications: [clarification] }).success;
  check('picked options validate', accepts({ ...answer, choices: ['Mon', 'Tue'] }));
  check('a typed answer alone validates', accepts({ ...answer, choices: [], other: 'Every other day' }));
  check('picked options with a typed answer validate', accepts({ ...answer, choices: ['Mon'], other: 'and holidays' }));
  check('decide alone validates', accepts({ ...answer, choices: [], decide: true }));
  check('decide with a choice is refused', !accepts({ ...answer, choices: ['Mon'], decide: true }));
  check('decide with a typed answer is refused', !accepts({ ...answer, choices: [], other: 'Mon', decide: true }));
  check('an entry answering nothing is refused', !accepts({ ...answer, choices: [] }));
  check('the old single answer is refused', !accepts({ ...answer, answer: 'Mon' }));
  check('an empty typed answer is refused', !accepts({ ...answer, choices: [], other: '' }));
  check(`a ${CLARIFICATION_OTHER_MAX_CHARS}-character typed answer validates`, accepts({ ...answer, choices: [], other: 'x'.repeat(CLARIFICATION_OTHER_MAX_CHARS) }));
  check(`a ${CLARIFICATION_OTHER_MAX_CHARS + 1}-character typed answer is refused`, !accepts({ ...answer, choices: [], other: 'x'.repeat(CLARIFICATION_OTHER_MAX_CHARS + 1) }));
  check('decide: false with nothing picked answers nothing and is refused', !Clarification.safeParse({ ...answer, choices: [], decide: false }).success);
  check('a rewrite carries the same clarification shape', RewriteRequest.safeParse({ prompt: 'p', clarifications: [{ ...answer, choices: [], decide: true }] }).success);
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
  runForwardCompatibilityTests();

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
