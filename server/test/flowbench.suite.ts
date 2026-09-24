import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, caught, eq, section } from './harness';
import { formatMarkdownReport, type EvalSet } from '../src/flowbench/report';
import { parseArgs, runFlowBenchmark, writeJsonReport } from '../src/flowbench/drive';
import { parseRequestEnvelope } from '../src/request-edge';

interface SeenRequest {
  path: string;
  device: string | undefined;
  headers: Headers;
  body: Record<string, unknown>;
}

interface FakeServer {
  url: string;
  requests: SeenRequest[];
  close: () => Promise<void>;
}

const QUESTION = { id: 'layout', question: 'How should it look?', options: ['Cards', 'Rows'] };
const SOURCE = "export default defineApp({ name: 'one' });\n";

function manifestFile(root: string, cases: EvalSet['cases']): string {
  const evalSet: EvalSet = { setId: 'flowbench-test', visibility: 'test', cases };
  const dir = path.join(root, 'eval-set');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(evalSet));
  return dir;
}

function response(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

function sse(res: http.ServerResponse, events: readonly Record<string, unknown>[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

async function listenFake(handler: (request: SeenRequest, response: http.ServerResponse) => void | Promise<void>): Promise<FakeServer> {
  const requests: SeenRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed: unknown = {};
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) as unknown : {};
    } catch (error) {
      parsed = { parseError: error instanceof Error ? error.message : String(error) };
    }
    const body = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    const header = req.headers['x-whim-device'];
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    const seen = { path: req.url ?? '', device: typeof header === 'string' ? header : undefined, headers, body };
    requests.push(seen);
    await handler(seen, res);
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake flowbench server did not start within 2s')), 2000);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      clearTimeout(timer);
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('fake server has no TCP address'));
      else resolve(address.port);
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fake flowbench server did not close within 2s')), 2000);
        server.close((error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function testFlowAndReport(): Promise<void> {
  section('flow benchmark drives clarify → rewrite → generate over HTTP and records stage timings');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-flowbench-'));
  const cases = [{ caseId: 'one', appSlug: 'one', prompt: 'make one', assertions: [] }];
  const evalSet = manifestFile(root, cases);
  const fake = await listenFake((request, res) => {
    if (request.path === '/v1/clarify') {
      response(res, 200, { questions: [QUESTION, { id: 'color', question: 'What color?', options: ['Blue', 'Red'] }] });
    } else if (request.path === '/v1/rewrite') {
      response(res, 200, { rewrittenPrompt: 'rewritten make one', plan: [] });
    } else if (request.path === '/v1/generate') {
      sse(res, [
        { type: 'stage', stage: 'plan', status: 'start' },
        { type: 'stage', stage: 'plan', status: 'done' },
        { type: 'stage', stage: 'generate', status: 'start' },
        { type: 'stage', stage: 'generate', status: 'done' },
        { type: 'stage', stage: 'check', status: 'start' },
        { type: 'stage', stage: 'check', status: 'done' },
        { type: 'stage', stage: 'run', status: 'start' },
        { type: 'stage', stage: 'run', status: 'done' },
        { type: 'result', app: { name: 'one', source: SOURCE, bundle: '', manifest: {}, schema: {} } },
      ]);
    } else {
      response(res, 404, { error: 'not_found', hint: 'unknown test route' });
    }
  });
  try {
    const saveDir = path.join(root, 'sources');
    const report = await runFlowBenchmark({ url: fake.url, evalSet, parallel: 1, retries: 0, saveSources: saveDir });
    const item = report.cases[0]!;
    eq('the case delivered a result', item.outcome, { type: 'result' });
    eq('clarify selected both first options', item.clarifications, [
      { id: 'layout', question: 'How should it look?', answer: 'Cards' },
      { id: 'color', question: 'What color?', answer: 'Blue' },
    ]);
    eq('rewrite received the original prompt and answers', fake.requests[1]?.body, { prompt: 'make one', clarifications: item.clarifications });
    eq('generate received the rewritten prompt and same answers', fake.requests[2]?.body, { prompt: 'rewritten make one', clarifications: item.clarifications });
    check('all three requests used one valid UUID-shaped device id', new Set(fake.requests.map((request) => request.device)).size === 1 && /^[0-9a-f-]{36}$/.test(fake.requests[0]?.device ?? ''));
    // Read by the server's own envelope parser: a legacy (header-free) or half envelope fails here.
    const platforms = fake.requests.map((request) => {
      const envelope = parseRequestEnvelope(request.headers);
      return envelope.ok ? envelope.envelope.platform : envelope.body.hint;
    });
    eq('every request carries a complete client envelope the server reads as the app', platforms, ['android', 'android', 'android']);
    check('stage durations are non-negative and ordered', item.phases.generate?.stages.every((stage) => stage.durationMs >= 0) === true && item.phases.generate?.stages.map((stage) => stage.stage).join(',') === 'plan,generate,check,run');
    check('the report records a non-negative tail', (item.phases.generate?.tailMs ?? -1) >= 0);
    eq('the saved source is byte-for-byte', fs.readFileSync(path.join(saveDir, 'one.ts'), 'utf8'), SOURCE);
    check('the Markdown output contains one case row and phase summary', formatMarkdownReport(report).includes('| one |') && formatMarkdownReport(report).includes('| Phase |'));
  } finally {
    await fake.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testFailureRetryAndMissingSource(): Promise<void> {
  section('flow benchmark reports failures, retries policy refusal only when requested, and skips failed sources');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-flowbench-failure-'));
  const evalSet = manifestFile(root, [
    { caseId: 'retry', appSlug: 'retry', prompt: 'retry prompt', assertions: [] },
    { caseId: 'failed', appSlug: 'failed', prompt: 'failed prompt', assertions: [] },
  ]);
  const attempts = new Map<string, number>();
  const fake = await listenFake((request, res) => {
    const prompt = String(request.body.prompt ?? '');
    const key = `${request.path}:${prompt}`;
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (request.path === '/v1/clarify' && ['retry prompt', 'no retry prompt'].includes(prompt) && attempts.get(key) === 1) {
      response(res, 503, { error: 'policy_unavailable', hint: 'try again' });
    } else if (request.path === '/v1/clarify') {
      response(res, 200, { questions: [] });
    } else if (request.path === '/v1/rewrite') {
      response(res, 200, { rewrittenPrompt: prompt });
    } else if (request.path === '/v1/generate' && prompt === 'failed prompt') {
      sse(res, [{ type: 'failure', reason: 'check_failed', attempts: 2, diagnostics: [] }]);
    } else if (request.path === '/v1/generate') {
      sse(res, [{ type: 'result', app: { name: 'retry', source: SOURCE, bundle: '', manifest: {}, schema: {} } }]);
    } else {
      response(res, 404, { error: 'not_found', hint: 'unknown test route' });
    }
  });
  try {
    const saveDir = path.join(root, 'sources');
    const report = await runFlowBenchmark({ url: fake.url, evalSet, parallel: 1, retries: 1, saveSources: saveDir });
    const retryCase = report.cases.find((item) => item.caseId === 'retry')!;
    const failedCase = report.cases.find((item) => item.caseId === 'failed')!;
    eq('the transient clarify refusal used one retry', retryCase.phases.clarify.retries, 1);
    eq('the generate failure keeps its reason and attempt count', failedCase.outcome, { type: 'failure', phase: 'generate', reason: 'check_failed', attempts: 2 });
    check('the failed case has no saved source', !fs.existsSync(path.join(saveDir, 'failed.ts')));
    const noRetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-flowbench-no-retry-'));
    const noRetrySet = manifestFile(noRetryRoot, [{ caseId: 'retry', appSlug: 'retry', prompt: 'no retry prompt', assertions: [] }]);
    try {
      const noRetry = await runFlowBenchmark({ url: fake.url, evalSet: noRetrySet, parallel: 1, retries: 0 });
      eq('without --retries the first policy refusal is reported', noRetry.cases[0]?.phases.clarify, { status: 503, durationMs: noRetry.cases[0]?.phases.clarify.durationMs, retries: 0, error: { error: 'policy_unavailable', hint: 'try again' } });
      eq('without --retries no second clarify request was sent', attempts.get('/v1/clarify:no retry prompt'), 1);
    } finally {
      fs.rmSync(noRetryRoot, { recursive: true, force: true });
    }
  } finally {
    await fake.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testArgumentsAndJson(): Promise<void> {
  section('flow benchmark refuses missing arguments and writes JSON reports');
  const missingUrl = await caught(() => { parseArgs(['--eval-set', path.join(process.cwd(), 'missing-eval-set')]); });
  check('missing URL is an argument error', missingUrl instanceof Error && missingUrl.message.includes('--url'));
  const missingEvalSet = await caught(() => { parseArgs(['--url', 'http://127.0.0.1:1']); });
  check('missing eval set is an argument error', missingEvalSet instanceof Error && missingEvalSet.message.includes('--eval-set'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-flowbench-json-'));
  try {
    const report = { setId: 'set', url: 'http://127.0.0.1', startedAt: '', finishedAt: '', cases: [], summary: { phases: { clarify: { medianMs: 0, maxMs: 0 }, rewrite: { medianMs: 0, maxMs: 0 }, generate: { medianMs: 0, maxMs: 0 } }, results: 0, failures: 0 } };
    const jsonPath = path.join(root, 'report.json');
    writeJsonReport(report, jsonPath);
    check('JSON report is written as valid JSON', JSON.parse(fs.readFileSync(jsonPath, 'utf8')).setId === 'set');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runFlowbenchEntry(args: string[], timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['server/flowbench.mjs', ...args], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`flowbench entry exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function testFlowbenchEntry(): Promise<void> {
  section('flowbench entry maps delivered, failed, and unreadable runs to process exit codes');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-flowbench-entry-'));
  const caseId = 'entry-delivered';
  const evalSet = manifestFile(root, [{ caseId, appSlug: 'entry-delivered', prompt: 'make one', assertions: [] }]);
  const fake = await listenFake((request, res) => {
    if (request.path === '/v1/clarify') response(res, 200, { questions: [] });
    else if (request.path === '/v1/rewrite') response(res, 200, { rewrittenPrompt: 'make one', plan: [] });
    else if (request.path === '/v1/generate') sse(res, [{ type: 'result', app: { name: 'one', source: SOURCE, bundle: '', manifest: {}, schema: {} } }]);
    else response(res, 404, { error: 'not_found', hint: 'unknown test route' });
  });
  try {
    const jsonPath = path.join(root, 'report.json');
    const result = await runFlowbenchEntry(['--url', fake.url, '--eval-set', evalSet, '--json', jsonPath], 30_000);
    eq('the CLI exits zero when every case is delivered', result.exitCode, 0);
    check('the CLI prints the case id in its Markdown table', result.stdout.includes(`| ${caseId} |`));
    eq('the CLI JSON report has no failures', JSON.parse(fs.readFileSync(jsonPath, 'utf8')).summary.failures, 0);

    const failureSet = manifestFile(root, [{ caseId: 'entry-failed', appSlug: 'entry-failed', prompt: 'fail one', assertions: [] }]);
    const failureServer = await listenFake((request, res) => {
      if (request.path === '/v1/clarify') response(res, 200, { questions: [] });
      else if (request.path === '/v1/rewrite') response(res, 200, { rewrittenPrompt: 'fail one' });
      else if (request.path === '/v1/generate') sse(res, [{ type: 'failure', reason: 'check_failed', attempts: 1, diagnostics: [] }]);
      else response(res, 404, { error: 'not_found', hint: 'unknown test route' });
    });
    try {
      const failure = await runFlowbenchEntry(['--url', failureServer.url, '--eval-set', failureSet], 30_000);
      eq('the CLI exits one when generate ends in failure', failure.exitCode, 1);
      check('the CLI report prints the failed outcome', failure.stdout.includes('failure'));

      const noManifest = path.join(root, 'no-manifest');
      fs.mkdirSync(noManifest);
      const requestsBeforeBadSet = failureServer.requests.length;
      const unreadable = await runFlowbenchEntry(['--url', failureServer.url, '--eval-set', noManifest], 30_000);
      eq('the CLI exits two for an eval set without a manifest', unreadable.exitCode, 2);
      check('the CLI names the unreadable manifest', unreadable.stderr.includes('manifest.json'));
      eq('an unreadable eval set sends no server requests', failureServer.requests.length, requestsBeforeBadSet);
    } finally {
      await failureServer.close();
    }
  } finally {
    await fake.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runFlowbenchTests(): Promise<void> {
  await testFlowAndReport();
  await testFailureRetryAndMissingSource();
  await testArgumentsAndJson();
  await testFlowbenchEntry();
}
