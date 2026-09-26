import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiError, Clarification, ClarifyLimit, ClarifyResponse, GenerationEvent, RewriteResponse } from '@whim/contract';
import { benchEnvelopeHeaders } from '../bench-envelope';
import { buildReport, type CaseOutcome, type CaseReport, type EvalCase, type EvalSet, type FlowBenchmarkReport, type GenerateReport, type PhaseReport, type StageTiming } from './report';

export { formatMarkdownReport } from './report';

const DEFAULT_TIMEOUT_MS = 900_000;

/** The one phase a run can stop after: a clarify rate check never pays for a build. */
export type StopAfter = 'clarify';

export interface FlowbenchArgs {
  url: string;
  evalSet: string;
  cases?: string[];
  parallel: number;
  retries: number;
  /** How many times each case runs (`--repeat`, default 1), each run from a fresh device. */
  repeat: number;
  /** `--stop-after clarify` ends every run once clarify has answered. */
  stopAfter?: StopAfter;
  saveSources?: string;
  jsonPath?: string;
}

/** What one run needs beyond its case, shared by every run of a benchmark. */
interface RunOptions {
  retries: number;
  saveSources?: string;
  stopAfter?: StopAfter;
  timeoutMs: number;
}

interface RawResponse {
  status: number;
  body: string;
  durationMs: number;
}

interface ObservedEvent {
  event: GenerationEvent;
  atMs: number;
}

interface GenerateAttempt {
  response: RawResponse;
  events: ObservedEvent[];
  firstEventMs?: number;
  terminal?: Extract<GenerationEvent, { type: 'result' | 'failure' }>;
  source?: string;
  streamError?: string;
}

function positiveInt(name: string, raw: string | undefined, allowZero = false): number {
  if (raw === undefined) throw new Error(`--${name} is required`);
  const value = Number(raw);
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`--${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function valueForFlag(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  const known = new Set(['url', 'eval-set', 'cases', 'parallel', 'retries', 'repeat', 'stop-after', 'save-sources', 'json']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith('--')) throw new Error(`unexpected argument: ${flag ?? ''}`);
    const name = flag.slice(2);
    if (!known.has(name)) throw new Error(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

export function parseArgs(argv: readonly string[]): FlowbenchArgs {
  const values = valueForFlag(argv);
  const url = values.get('url');
  if (!url) throw new Error('--url <http url> is required');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return invalidUrl(url, error);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('--url must use http or https');
  const evalSet = values.get('eval-set');
  if (!evalSet) throw new Error('--eval-set <dir> is required');
  const cases = values.get('cases')?.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  if (values.has('cases') && (!cases || cases.length === 0)) throw new Error('--cases must contain at least one case id');
  const repeat = positiveInt('repeat', values.get('repeat') ?? '1');
  const stopAfter = stopAfterValue(values.get('stop-after'));
  const saveSources = values.get('save-sources');
  if (saveSources !== undefined && repeat > 1) throw new Error('--save-sources keeps one source per case, so it cannot be combined with --repeat above 1');
  if (saveSources !== undefined && stopAfter !== undefined) throw new Error('--save-sources has nothing to save with --stop-after clarify: no run builds an app');
  return {
    url: url.replace(/\/$/, ''),
    evalSet,
    cases,
    parallel: positiveInt('parallel', values.get('parallel') ?? '1'),
    retries: positiveInt('retries', values.get('retries') ?? '0', true),
    repeat,
    ...(stopAfter === undefined ? {} : { stopAfter }),
    saveSources,
    jsonPath: values.get('json'),
  };
}

function stopAfterValue(raw: string | undefined): StopAfter | undefined {
  if (raw === undefined) return undefined;
  if (raw !== 'clarify') throw new Error(`--stop-after must be "clarify", got ${JSON.stringify(raw)}`);
  return raw;
}

function invalidUrl(url: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`--url is invalid (${url}): ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    return undefined;
  }
}

function apiErrorFrom(text: string, status: number): ApiError {
  const parsed = asRecord(parseJson(text));
  const error = parsed?.error;
  const hint = parsed?.hint;
  return {
    error: typeof error === 'string' && error.length > 0 ? error : `http_${status}`,
    hint: typeof hint === 'string' && hint.length > 0 ? hint : `HTTP ${status}`,
  };
}

function isPolicyUnavailable(response: RawResponse): boolean {
  return response.status === 503 && apiErrorFrom(response.body, response.status).error === 'policy_unavailable';
}

async function post(url: string, body: unknown, deviceId: string, timeoutMs: number): Promise<RawResponse> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': deviceId, ...benchEnvelopeHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: await response.text(), durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    const hint = error instanceof Error ? error.message : String(error);
    return { status: 0, body: JSON.stringify({ error: 'network_error', hint }), durationMs: Math.round(performance.now() - started) };
  }
}

async function postWithRetries(url: string, body: unknown, deviceId: string, retriesAllowed: number, timeoutMs: number): Promise<RawResponse & { retries: number }> {
  const started = performance.now();
  let retries = 0;
  for (;;) {
    const response = await post(url, body, deviceId, timeoutMs);
    if (!isPolicyUnavailable(response) || retries >= retriesAllowed) {
      return { ...response, durationMs: Math.round(performance.now() - started), retries };
    }
    retries += 1;
  }
}

function parseClarify(text: string): ClarifyResponse | undefined {
  const parsed = asRecord(parseJson(text));
  if (!Array.isArray(parsed?.questions)) return undefined;
  const questions = parsed.questions.filter((question): question is Record<string, unknown> => asRecord(question) !== undefined);
  if (questions.length !== parsed.questions.length) return undefined;
  const valid = questions.every((question) => typeof question.id === 'string' && typeof question.question === 'string' && Array.isArray(question.options) && question.options.length > 0 && question.options.every((option) => typeof option === 'string'));
  if (!valid || questions.length > 3) return undefined;
  const limit = parseLimit(parsed.limit);
  return limit === undefined ? { questions: questions as ClarifyResponse['questions'] } : { questions: [], limit };
}

function parseLimit(value: unknown): ClarifyLimit | undefined {
  const limit = asRecord(value);
  if (typeof limit?.reason !== 'string' || typeof limit.alternative !== 'string') return undefined;
  return { reason: limit.reason, alternative: limit.alternative };
}

function parseRewrite(text: string): RewriteResponse | undefined {
  const parsed = asRecord(parseJson(text));
  if (typeof parsed?.rewrittenPrompt !== 'string') return undefined;
  return { rewrittenPrompt: parsed.rewrittenPrompt };
}

function feedFrames(buffer: string, chunk: string): { frames: string[]; buffer: string } {
  const parts = (buffer + chunk).split(/\r?\n\r?\n/);
  return { frames: parts.slice(0, -1), buffer: parts.at(-1) ?? '' };
}

function eventFromFrame(frame: string): GenerationEvent | undefined {
  const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
  if (!data) return undefined;
  const parsed = asRecord(parseJson(data));
  if (typeof parsed?.type !== 'string') return undefined;
  return parsed as unknown as GenerationEvent;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- stream parsing has one branch for each wire event and transport state
async function generateAttempt(url: string, body: unknown, deviceId: string, overallStarted: number, timeoutMs: number): Promise<GenerateAttempt> {
  const responseStarted = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': deviceId, ...benchEnvelopeHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const hint = error instanceof Error ? error.message : String(error);
    return {
      response: { status: 0, body: JSON.stringify({ error: 'network_error', hint }), durationMs: Math.round(performance.now() - responseStarted) },
      events: [],
    };
  }
  if (response.status !== 200) {
    return {
      response: { status: response.status, body: await response.text(), durationMs: Math.round(performance.now() - responseStarted) },
      events: [],
    };
  }
  const events: ObservedEvent[] = [];
  const reader = response.body?.getReader();
  if (reader === undefined) return { response: { status: response.status, body: '', durationMs: Math.round(performance.now() - responseStarted) }, events };
  const decoder = new TextDecoder();
  let buffer = '';
  let firstEventMs: number | undefined;
  let terminal: GenerateAttempt['terminal'];
  let source: string | undefined;
  let streamError: string | undefined;
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) break;
      const fed = feedFrames(buffer, decoder.decode(read.value, { stream: true }));
      buffer = fed.buffer;
      for (const frame of fed.frames) {
        const event = eventFromFrame(frame);
        if (event === undefined) continue;
        const atMs = Math.max(0, Math.round(performance.now() - overallStarted));
        firstEventMs ??= atMs;
        events.push({ event, atMs });
        if (event.type === 'result' || event.type === 'failure') {
          terminal = event;
          if (event.type === 'result') source = event.app.source;
        }
      }
      if (terminal !== undefined) break;
    }
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error);
  }
  return {
    response: { status: response.status, body: '', durationMs: Math.round(performance.now() - responseStarted) },
    events,
    firstEventMs,
    terminal,
    source,
    streamError,
  };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- the two stage statuses each update distinct timing state
function stageTimings(events: readonly ObservedEvent[]): { stages: StageTiming[]; repairs: number; lastDoneMs?: number } {
  const starts = new Map<string, number>();
  const stages: StageTiming[] = [];
  let repairs = 0;
  let lastDoneMs: number | undefined;
  for (const observed of events) {
    if (observed.event.type !== 'stage') continue;
    const attempt = observed.event.attempt;
    const key = `${observed.event.stage}:${attempt ?? 'none'}`;
    if (observed.event.status === 'start') {
      starts.set(key, observed.atMs);
      if (observed.event.stage === 'repair') repairs += 1;
    } else {
      const started = starts.get(key);
      if (started !== undefined) {
        stages.push({ stage: observed.event.stage, ...(attempt === undefined ? {} : { attempt }), durationMs: Math.max(0, observed.atMs - started) });
      }
      lastDoneMs = observed.atMs;
    }
  }
  return { stages, repairs, lastDoneMs };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- retries and terminal variants map directly to the benchmark report
async function generateWithRetries(baseUrl: string, body: unknown, deviceId: string, retriesAllowed: number, timeoutMs: number): Promise<GenerateReport & { source?: string }> {
  const started = performance.now();
  let retries = 0;
  for (;;) {
    const attempt = await generateAttempt(`${baseUrl}/v1/generate`, body, deviceId, started, timeoutMs);
    if (isPolicyUnavailable(attempt.response) && retries < retriesAllowed) {
      retries += 1;
      continue;
    }
    const timings = stageTimings(attempt.events);
    const terminal = attempt.terminal;
    let error: ApiError | undefined;
    if (attempt.response.status !== 200) error = apiErrorFrom(attempt.response.body, attempt.response.status);
    else if (attempt.streamError !== undefined || terminal === undefined) error = { error: 'stream_error', hint: attempt.streamError ?? 'The generation stream ended without a terminal event.' };
    return {
      status: attempt.response.status,
      durationMs: Math.round(performance.now() - started),
      retries,
      ...(attempt.response.status === 200 && attempt.firstEventMs === undefined ? {} : { firstEventMs: attempt.firstEventMs }),
      stages: timings.stages,
      repairs: timings.repairs,
      ...(terminal !== undefined && timings.lastDoneMs !== undefined ? { tailMs: Math.max(0, (attempt.events.at(-1)?.atMs ?? timings.lastDoneMs) - timings.lastDoneMs) } : {}),
      ...(terminal?.type === 'result' ? { terminal: { type: 'result' as const, sourceBytes: Buffer.byteLength(terminal.app.source) }, source: attempt.source } : {}),
      ...(terminal?.type === 'failure' ? { terminal: { type: 'failure' as const, reason: terminal.reason, attempts: terminal.attempts } } : {}),
      ...(error === undefined ? {} : { error }),
    };
  }
}

function notRun(): PhaseReport {
  return { status: 0, durationMs: 0, retries: 0, error: { error: 'not_run', hint: 'The previous phase did not complete.' } };
}

function phaseFailure(phase: 'clarify' | 'rewrite' | 'generate', report: PhaseReport, clarifications: Clarification[], caseInfo: EvalCase, run: number, deviceId: string): CaseReport {
  const outcome: CaseOutcome = { type: 'failure', phase, reason: report.error?.error ?? 'phase_failed', attempts: report.retries + 1 };
  return {
    caseId: caseInfo.caseId,
    run,
    appSlug: caseInfo.appSlug,
    prompt: caseInfo.prompt,
    deviceId,
    clarifications,
    phases: { clarify: phase === 'clarify' ? report : notRun(), ...(phase !== 'clarify' ? { rewrite: phase === 'rewrite' ? report : notRun() } : {}), ...(phase === 'generate' ? { generate: report as GenerateReport } : {}) },
    outcome,
  };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- this function follows the product's three sequential phases
async function runCase(baseUrl: string, caseInfo: EvalCase, run: number, options: RunOptions): Promise<CaseReport> {
  const { retries, saveSources, timeoutMs } = options;
  const deviceId = randomUUID();
  const identity = { caseId: caseInfo.caseId, run, appSlug: caseInfo.appSlug, prompt: caseInfo.prompt, deviceId };
  const clarifyResponse = await postWithRetries(`${baseUrl}/v1/clarify`, { prompt: caseInfo.prompt }, deviceId, retries, timeoutMs);
  const clarifyBody = clarifyResponse.status === 200 ? parseClarify(clarifyResponse.body) : undefined;
  const clarify: PhaseReport = {
    status: clarifyResponse.status,
    durationMs: clarifyResponse.durationMs,
    retries: clarifyResponse.retries,
    ...(clarifyResponse.status !== 200 || clarifyBody === undefined ? { error: clarifyResponse.status === 200 ? { error: 'invalid_response', hint: 'The clarify response did not match the contract.' } : apiErrorFrom(clarifyResponse.body, clarifyResponse.status) } : {}),
  };
  if (clarifyBody === undefined) return phaseFailure('clarify', clarify, [], caseInfo, run, deviceId);
  if (clarifyBody.limit !== undefined) {
    const { reason, alternative } = clarifyBody.limit;
    return { ...identity, clarifications: [], phases: { clarify }, outcome: { type: 'limit', reason, alternative } };
  }
  const clarifications = clarifyBody.questions.map((question) => ({ id: question.id, question: question.question, choices: [question.options[0]!] }));
  if (options.stopAfter === 'clarify') return { ...identity, clarifications, phases: { clarify }, outcome: { type: 'clarified' } };

  const rewriteBody = { prompt: caseInfo.prompt, ...(clarifications.length > 0 ? { clarifications } : {}) };
  const rewriteResponse = await postWithRetries(`${baseUrl}/v1/rewrite`, rewriteBody, deviceId, retries, timeoutMs);
  const rewriteBodyParsed = rewriteResponse.status === 200 ? parseRewrite(rewriteResponse.body) : undefined;
  const rewrite: PhaseReport = {
    status: rewriteResponse.status,
    durationMs: rewriteResponse.durationMs,
    retries: rewriteResponse.retries,
    ...(rewriteResponse.status !== 200 || rewriteBodyParsed === undefined ? { error: rewriteResponse.status === 200 ? { error: 'invalid_response', hint: 'The rewrite response did not match the contract.' } : apiErrorFrom(rewriteResponse.body, rewriteResponse.status) } : {}),
  };
  if (rewriteBodyParsed === undefined) {
    const failed = phaseFailure('rewrite', rewrite, clarifications, caseInfo, run, deviceId);
    return { ...failed, phases: { clarify, rewrite } };
  }

  const generateBody = { prompt: rewriteBodyParsed.rewrittenPrompt, ...(clarifications.length > 0 ? { clarifications } : {}) };
  const generated = await generateWithRetries(baseUrl, generateBody, deviceId, retries, timeoutMs);
  const { source, ...generate } = generated;
  if (generate.terminal?.type === 'result') {
    if (saveSources !== undefined && source !== undefined) {
      fs.mkdirSync(saveSources, { recursive: true });
      fs.writeFileSync(path.join(saveSources, `${caseInfo.caseId}.ts`), source);
    }
    return { ...identity, clarifications, phases: { clarify, rewrite, generate }, outcome: { type: 'result' } };
  }
  const reason = generate.terminal?.type === 'failure' ? generate.terminal.reason : generate.error?.error ?? 'no_terminal_event';
  const attempts = generate.terminal?.type === 'failure' ? generate.terminal.attempts : generate.retries + 1;
  return { ...identity, clarifications, phases: { clarify, rewrite, generate }, outcome: { type: 'failure', phase: 'generate', reason, attempts } };
}

function readManifest(evalSetDir: string): EvalSet {
  const manifestPath = path.join(evalSetDir, 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read eval set manifest ${manifestPath}: ${detail}`);
  }
  const record = asRecord(parsed);
  const cases = record?.cases;
  if (typeof record?.setId !== 'string' || typeof record?.visibility !== 'string' || !Array.isArray(cases)) throw new Error(`eval set manifest ${manifestPath} has an invalid shape`);
  const validCases = cases.filter((item): item is Record<string, unknown> => asRecord(item) !== undefined);
  if (validCases.length !== cases.length || validCases.some((item) => typeof item.caseId !== 'string' || typeof item.appSlug !== 'string' || typeof item.prompt !== 'string' || !Array.isArray(item.assertions))) {
    throw new Error(`eval set manifest ${manifestPath} has an invalid case`);
  }
  return { setId: record.setId, visibility: record.visibility, cases: validCases as unknown as EvalCase[] };
}

function selectedCases(evalSet: EvalSet, wanted: readonly string[] | undefined): EvalCase[] {
  if (wanted === undefined) return [...evalSet.cases];
  const byId = new Map(evalSet.cases.map((item) => [item.caseId, item]));
  const selected = wanted.map((caseId) => byId.get(caseId));
  if (selected.includes(undefined)) throw new Error(`--cases contains an id not present in the eval set`);
  return selected as EvalCase[];
}

/** Every case `repeat` times, its runs together and numbered from 1, shared out to `parallel` workers. */
async function runCases(baseUrl: string, cases: readonly EvalCase[], repeat: number, parallel: number, options: RunOptions): Promise<CaseReport[]> {
  const runs = cases.flatMap((caseInfo) => Array.from({ length: repeat }, (_, index) => ({ caseInfo, run: index + 1 })));
  const output: CaseReport[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const item = runs[index];
      if (item === undefined) return;
      output[index] = await runCase(baseUrl, item.caseInfo, item.run, options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, runs.length)) }, () => worker()));
  return output;
}

export async function runFlowBenchmark(args: FlowbenchArgs, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FlowBenchmarkReport> {
  const evalSet = readManifest(args.evalSet);
  const cases = selectedCases(evalSet, args.cases);
  if (cases.length === 0) throw new Error('the eval set has no cases to run');
  const startedAt = new Date().toISOString();
  const reports = await runCases(args.url, cases, args.repeat, args.parallel, { retries: args.retries, saveSources: args.saveSources, stopAfter: args.stopAfter, timeoutMs });
  return buildReport(evalSet.setId, args.url, startedAt, reports);
}

export function writeJsonReport(report: FlowBenchmarkReport, jsonPath: string): void {
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
}
