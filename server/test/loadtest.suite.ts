/**
 * server/test/loadtest.suite.ts — chain-16's suite (design D26; specs/server-deployment "A load
 * test measures capacity without spending provider credit"). Node-only, no Chromium: it never calls
 * the real `startServer` (which would launch a browser) — the browser-backed integration case (three
 * concurrent generations, the fourth waiting in line, the fifth refused, the leak probe, the `fetch`
 * trap counting zero calls for real) lives in `server/test/e2e.ts` (task 17.5).
 *
 * Covers: `runLoadtestServer`'s key refusal and its override/env/fetch-trap plumbing against an
 * injected `start`; `createReplayModel`'s per-role replies and fixture rotation; a full
 * `GenerationMachine` run over the replay model with a stub run stage, and an abort mid-turn;
 * the production-exclusion metafile tripwire; the load-test compose override; and `drive.ts`'s
 * pure pieces (SSE framing, the report builder, the verdict).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import { caught, check, eq, section } from './harness';
import {
  OPERATION_CEILING,
  OperationBudget,
  OperationCapReached,
  assertThrowawayDatabase,
  countingTransactions,
  estimatedCostUsd,
  main as firestoreAdmissionMain,
  parseLoadArgs,
} from './firestore-admission-load';
import { productionEntryInputs } from './build-fixtures';
import type { ServerHandle, StartServerOptions, StartServerOverrides } from '../src/lifecycle';
import type { ServerConfig } from '../src/config';
import { runLoadtestServer, LoadtestConfigError, LOADTEST_ROSTER, LOADTEST_INERT_API_KEY, LOADTEST_HEALTHZ_SERVICE } from '../src/loadtest/server';
import { createReplayModel, loadRotationFixtures } from '../src/loadtest/replay-model';
import { runStaticChecks } from '../../checks/index';
import { createCheckStage } from '../src/generation/stages/check';
import { createBuildStage } from '../src/generation/stages/build';
import { loadPromptInputs } from '../src/generation/prompts/inputs';
import { GenerationMachine, type CheckedManifest, type RunStage } from '../src/generation/machine';
import { defaultModelRoster, type ModelRoster, type ModelStream } from '../src/generation/model';
import type { GenerateRequest, GenerationEvent, Usage } from '@whim/contract';
import {
  buildReport,
  cpuReport,
  feedSseBuffer,
  isRealFrame,
  leakVerdict,
  parseArgs,
  parseCoresLine,
  parseGenerationEvent,
  parseStatsCsv,
  readCpuReport,
  verdict,
  type DeviceOutcome,
  type LeakProbeOutcome,
  type StatsSample,
} from '../src/loadtest/drive';

const ROOT = process.cwd();
const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function collectText(stream: ModelStream): Promise<string> {
  let text = '';
  for await (const delta of stream.deltas) if (delta.kind === 'text') text += delta.text;
  return text;
}

async function collectEvents(iter: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

// ── runLoadtestServer: the key refusal (design D26 no-spend guarantee #1) ──

async function testKeyRefusal(): Promise<void> {
  section('runLoadtestServer refuses OPENROUTER_API_KEY, before ever calling the injected start (design D26)');

  const calls: StartServerOptions[] = [];
  const start = async (options: StartServerOptions): Promise<ServerHandle> => {
    calls.push(options);
    throw new Error('setup: start should never be called on the key-refusal path');
  };

  const err = await caught(async () => {
    await runLoadtestServer({ env: { OPENROUTER_API_KEY: 'sk-a-real-key' }, start });
  });
  check(
    'rejects with a LoadtestConfigError naming OPENROUTER_API_KEY',
    err instanceof LoadtestConfigError && err.reason === 'config' && err.message.includes('OPENROUTER_API_KEY'),
    String(err),
  );
  eq('the injected start was never called', calls.length, 0);
}

// ── runLoadtestServer: overrides, forced env, and the fetch trap (design D26 no-spend guarantee #2) ──

function fakeServerHandle(): ServerHandle {
  return {
    url: 'http://127.0.0.1:0',
    config: {} as ServerConfig,
    session: undefined,
    drain: async () => {},
    close: async () => {},
  };
}

async function testOverridesEnvAndFetchTrap(): Promise<void> {
  section('runLoadtestServer forces the load-test env/roster, wires the no-spend overrides, and traps fetch (design D26)');

  const calls: StartServerOptions[] = [];
  const start = async (options: StartServerOptions): Promise<ServerHandle> => {
    calls.push(options);
    return fakeServerHandle();
  };

  const savedFetch = globalThis.fetch;
  const fakeDataDir = path.join(os.tmpdir(), 'whim-loadtest-probe');
  const handle = await runLoadtestServer({ env: { WHIM_DATA_DIR: fakeDataDir }, start });
  try {
    check('fetch was replaced while the server is up', globalThis.fetch !== savedFetch);
    eq('the trap has not fired yet', handle.fetchCallCount(), 0);

    const trapped = await caught(async () => {
      await globalThis.fetch('https://openrouter.ai/api/v1/key');
    });
    check('the trap throws on any fetch call', trapped instanceof Error, String(trapped));
    eq('the trap counted the call', handle.fetchCallCount(), 1);

    eq('exactly one start call was made', calls.length, 1);
    const sent = calls[0];
    eq('NODE_ENV is forced to production', sent.env.NODE_ENV, 'production');
    eq('the inert key replaces whatever OPENROUTER_API_KEY the caller had (here: absent)', sent.env.OPENROUTER_API_KEY, LOADTEST_INERT_API_KEY);
    eq(
      'the roster env vars are the fixed load-test ids',
      [sent.env.WHIM_ENGINEER_MODEL, sent.env.WHIM_REWRITE_MODEL],
      [LOADTEST_ROSTER.engineer.model, LOADTEST_ROSTER.rewrite.model],
    );
    eq('the caller env passes through otherwise', sent.env.WHIM_DATA_DIR, fakeDataDir);

    const overrides = sent.overrides as StartServerOverrides;
    eq('the model override carries the fixed load-test roster', overrides.model?.roster, LOADTEST_ROSTER);

    const stats = await overrides.statsTransport?.fetchStats('gen-1', new AbortController().signal);
    eq('the stats transport resolves every id at zero cost', stats, { usage: ZERO_USAGE, totalCostUsd: 0 });

    const credit = await overrides.creditTransport?.lookupKey();
    eq('the credit transport reports no limit', credit, { status: 200, bodyText: JSON.stringify({ data: { limit_remaining: null } }) });

    const fakeInner = { fetch: async () => new Response('inner-ok') } as unknown as Parameters<NonNullable<StartServerOverrides['wrapApp']>>[0];
    const outer = overrides.wrapApp?.(fakeInner);
    for (const route of ['/health', '/healthz']) {
      const healthRes = (await outer?.fetch(new Request(`http://127.0.0.1${route}`), {} as never)) as Response;
      eq(`wrapApp intercepts ${route} with the load-test identity`, await healthRes.json(), { ok: true, service: LOADTEST_HEALTHZ_SERVICE });
    }
    const otherRes = (await outer?.fetch(new Request('http://127.0.0.1/v1/generate'), {} as never)) as Response;
    eq('every other route falls through to the wrapped app unchanged', await otherRes.text(), 'inner-ok');
  } finally {
    await handle.close();
  }
  check('fetch is restored once the handle has closed', globalThis.fetch === savedFetch);
}

// ── createReplayModel: per-role replies, and fixture rotation (design D26) ──

const GENERATE_SYSTEM_PROBE = 'Write ONE TypeScript file that default-exports the result of `defineApp({...})`.';
const CLASSIFIER_SYSTEM_PROBE = "You are Whim's content-safety classifier. Judge ONLY the quoted text.";

const NEW_APP_REQUEST: GenerateRequest = { prompt: 'a tip splitter' };

async function testReplayModelRoles(): Promise<void> {
  section('createReplayModel answers every role deterministically and rotates the clean fixtures (design D26)');

  const roster: ModelRoster = defaultModelRoster('lt/rewrite', 'lt/engineer');
  const fixtures = loadRotationFixtures();
  check('setup: at least one top-level fixture passes runStaticChecks with no error diagnostic', fixtures.length > 0);
  const model = createReplayModel({ roster, engineerTurnMs: 1, rewriteTurnMs: 1, fixtures });

  const classifierText = await collectText(
    model.stream({
      model: roster.rewrite.model,
      messages: [{ role: 'system', content: CLASSIFIER_SYSTEM_PROBE }, { role: 'user', content: 'Text to judge' }],
      reasoning: 'off',
      role: 'policy',
    }),
  );
  eq('the classifier always allows', JSON.parse(classifierText), { verdict: 'allow' });

  const seen = new Set<string>();
  for (let i = 0; i < fixtures.length * 2; i++) {
    const text = await collectText(
      model.stream({
        model: roster.engineer.model,
        messages: [{ role: 'system', content: GENERATE_SYSTEM_PROBE }, { role: 'user', content: 'Request: an app' }],
        reasoning: 'on',
        role: 'generate',
      }),
    );
    check(
      `generate call ${i}: the rotated reply passes runStaticChecks with no error diagnostic`,
      !runStaticChecks(text).diagnostics.some((d) => d.severity === 'error'),
    );
    seen.add(text);
  }
  eq('every clean fixture is seen across two full rotations', seen.size, fixtures.length);

  const unknownModelErr = await caught(() => {
    model.stream({ model: 'not-a-roster-id', messages: [{ role: 'system', content: 'x' }], reasoning: 'off', role: 'rewrite' });
  });
  check('an unrecognized model id throws rather than replaying silently', unknownModelErr instanceof Error, String(unknownModelErr));
}

// ── A full GenerationMachine run over the replay model, with a stub run stage (design D26) ──

async function testMachineOverReplayModel(): Promise<void> {
  section('a full GenerationMachine run over the replay model reaches result; an abort mid-turn ends with no terminal');

  const promptInputs = loadPromptInputs();
  const check1 = createCheckStage();
  const build = createBuildStage();
  const run: RunStage = {
    run: (input) => ({
      contained: true,
      diagnostics: [],
      record: {
        name: input.manifest?.name ?? 'Load Test App',
        source: input.source,
        bundle: input.build.bundle,
        manifest: (input.manifest as CheckedManifest | undefined)?.manifest ?? {},
        schema: (input.manifest as CheckedManifest | undefined)?.schema ?? {},
      },
    }),
  };
  const clock = { now: () => Date.now() };

  const model = createReplayModel({ roster: LOADTEST_ROSTER, engineerTurnMs: 1, rewriteTurnMs: 1 });
  const machine = new GenerationMachine({ model, roster: LOADTEST_ROSTER, promptInputs, check: check1, build, run, clock });
  const events = await collectEvents(machine.run(NEW_APP_REQUEST));
  eq('the run ends in exactly one result', events.filter((e) => e.type === 'result' || e.type === 'failure').map((e) => e.type), ['result']);

  const slowModel = createReplayModel({ roster: LOADTEST_ROSTER, engineerTurnMs: 300, rewriteTurnMs: 300 });
  const slowMachine = new GenerationMachine({ model: slowModel, roster: LOADTEST_ROSTER, promptInputs, check: check1, build, run, clock });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const abortedEvents = await collectEvents(slowMachine.run(NEW_APP_REQUEST, controller.signal));
  eq('an abort during the paced plan turn ends the run with no terminal event', abortedEvents.filter((e) => e.type === 'result' || e.type === 'failure'), []);
}

// ── Production exclusion: the metafile tripwire (design D26, discriminating red-check) ──

async function testProductionExclusion(): Promise<void> {
  section('the production entry bundle carries no server/src/loadtest/ input (design D26)');

  // Shares its one bundle pass with prod-build.suite.ts's own scan of this same entry — no
  // input under `server/src/loadtest/` was reaching it before this existed, but the bundle was
  // computed twice per gate run to check two different things about it.
  const mainInputs = await productionEntryInputs();
  eq(
    'no input under server/src/loadtest/ reaches the production entry',
    mainInputs.filter((i) => i.startsWith('server/src/loadtest/')),
    [],
  );
}

// ── The load-test compose override (design D26) ──

/** Read only the direct `env_file` list on `services.whim-server`, without pretending to be a
 * YAML or Compose model parser. The real merged-model proof stays an operator receipt. */
function replayEnvFileOverride(source: string): string[] | null {
  const lines = source.split('\n');
  const servicesIndex = lines.findIndex((line) => line === 'services:');
  if (servicesIndex === -1) return null;

  const serviceIndex = lines.findIndex((line, index) => index > servicesIndex && line === '  whim-server:');
  if (serviceIndex === -1) return null;

  for (let index = serviceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^ {2}\S/.test(line)) return null;
    if (line !== '    env_file: !override') continue;

    const entries: string[] = [];
    for (let entryIndex = index + 1; entryIndex < lines.length; entryIndex += 1) {
      const entry = lines[entryIndex];
      const match = /^ {6}- (\S.*)$/.exec(entry);
      if (!match) break;
      entries.push(match[1]);
    }
    return entries;
  }
  return null;
}

function testDeployFilesExcludeLoadtest(): void {
  section('the load-test compose override replaces only whim-server\'s env_file (design D26)');

  const override = readRepoFile('deploy/loadtest/compose.loadtest.yaml');
  check('the override exists and touches only whim-server', override.includes('whim-server:'));
  const envFiles = replayEnvFileOverride(override);
  check('whim-server replaces the inherited env_file sequence with !override', envFiles !== null, override);
  eq('the replacement list contains only config.env', envFiles, ['/etc/whim/config.env']);

  const ordinaryList = override.replace('    env_file: !override', '    env_file:');
  check('red-check: downgrading the service to an ordinary list fails isolation', replayEnvFileOverride(ordinaryList) === null);
}

// ── drive.ts pure pieces ───────────────────────────────────────────────────

function testSseFraming(): void {
  section('drive.ts: SSE frame parsing across chunk boundaries, keepalive filtering (design D26)');

  const whole = 'event: token\ndata: {"type":"token","text":"hi"}\nid: 1\n\n';
  const splitAt = 20;
  const first = feedSseBuffer('', whole.slice(0, splitAt));
  eq('a frame split mid-way parses nothing yet', first.frames, []);
  const second = feedSseBuffer(first.buffer, whole.slice(splitAt));
  eq('the remainder completes the frame once its blank line arrives', second.frames.length, 1);
  check('the completed frame is real (has event+data)', isRealFrame(second.frames[0]));
  eq('the frame decodes to the original GenerationEvent', parseGenerationEvent(second.frames[0]), { type: 'token', text: 'hi' });

  const withKeepalive = feedSseBuffer('', ': keepalive\n\nevent: result\ndata: {"type":"result","app":{}}\n\n');
  eq('two frames arrive: the comment and the event', withKeepalive.frames.length, 2);
  check('the keepalive comment is not a real frame', !isRealFrame(withKeepalive.frames[0]));
  check('the actual event IS a real frame', isRealFrame(withKeepalive.frames[1]));

  check('an unparseable data line yields no GenerationEvent, not a throw', parseGenerationEvent({ event: 'x', data: 'not json' }) === undefined);
}

const OK_OUTCOME = (id: string, ms: number): DeviceOutcome => ({ deviceId: id, timeToFirstEventMs: ms, totalMs: ms + 10, terminal: 'result' });
const REFUSED_OUTCOME = (id: string, code: string): DeviceOutcome => ({ deviceId: id, totalMs: 5, refusal: { status: 429, error: code } });
const OK_LEAK: LeakProbeOutcome = { ok: true, rounds: [[], []] };

function testReportAndVerdict(): void {
  section('drive.ts: buildReport aggregation and the exit-rule verdict, for a server with no line (WHIM_QUEUE_MAX=0)');

  const clean = [OK_OUTCOME('a', 100), OK_OUTCOME('b', 200), OK_OUTCOME('c', 300)];
  const cleanReport = buildReport(3, 3, 0, clean, OK_LEAK);
  eq('terminals tally correctly', cleanReport.terminals, { result: 3, failure: 0, none: 0 });
  eq('p50 time-to-first-event over [100,200,300]', cleanReport.timeToFirstEventMs.p50, 200);
  check('a clean report with a passing probe verdicts ok', verdict(cleanReport).ok);

  const failing = [OK_OUTCOME('a', 100), { deviceId: 'b', totalMs: 50, terminal: 'failure' as const }];
  check('any failure terminal fails the verdict', verdict(buildReport(2, 2, 0, failing, OK_LEAK)).ok === false);

  const refusedWithinCap = [OK_OUTCOME('a', 100), REFUSED_OUTCOME('b', 'server_busy')];
  check('a refusal when devices <= cap fails the verdict', verdict(buildReport(2, 3, 0, refusedWithinCap, OK_LEAK)).ok === false);

  const refusedOverCap = [OK_OUTCOME('a', 100), REFUSED_OUTCOME('b', 'server_busy'), REFUSED_OUTCOME('c', 'server_busy')];
  check(
    'a refusal when devices EXCEEDS the cap is expected and does not fail the verdict on its own',
    verdict(buildReport(3, 1, 0, refusedOverCap, OK_LEAK)).ok === true,
  );

  check('a clean run below capacity passes', verdict(buildReport(2, 3, 0, clean.slice(0, 2), OK_LEAK)).ok);
  const capPlusOne = [...clean, REFUSED_OUTCOME('d', 'server_busy')];
  check('cap + 1 passes with exactly one server_busy refusal', verdict(buildReport(4, 3, 0, capPlusOne, OK_LEAK)).ok);
  const invalidRuns: [string, number, number, DeviceOutcome[]][] = [
    ['missing terminal', 2, 2, [clean[0], { deviceId: 'b', totalMs: 5 }]],
    ['missing outcome', 3, 3, clean.slice(0, 2)],
    ['extra outcome', 2, 3, clean],
    ['wrong refusal type', 2, 1, [clean[0], REFUSED_OUTCOME('b', 'policy_unavailable')]],
    ['too many refusals', 3, 2, [clean[0], REFUSED_OUTCOME('b', 'server_busy'), REFUSED_OUTCOME('c', 'server_busy')]],
    ['too few refusals', 3, 1, [clean[0], clean[1], REFUSED_OUTCOME('c', 'server_busy')]],
    ['no refusal above capacity', 3, 2, clean],
    ['missing terminal above capacity', 2, 1, [{ deviceId: 'a', totalMs: 5 }, REFUSED_OUTCOME('b', 'server_busy')]],
  ];
  for (const [label, devices, cap, outcomes] of invalidRuns) {
    check(`${label} fails the capacity verdict`, !verdict(buildReport(devices, cap, 0, outcomes, OK_LEAK)).ok);
  }

  const leaked: LeakProbeOutcome = { ok: false, rounds: [[REFUSED_OUTCOME('probe-1', 'server_busy')], []], detail: 'leaked' };
  check('a failed leak probe fails the verdict even with a clean run', verdict(buildReport(2, 2, 0, clean.slice(0, 2), leaked)).ok === false);
}

const WAITED_OUTCOME = (id: string, waitMs: number): DeviceOutcome => ({ ...OK_OUTCOME(id, 5), totalMs: waitMs + 50, waitMs });

function testLineReportAndVerdict(): void {
  section('drive.ts: the generation line (beta-1 D8): past the cap devices wait then complete; only past cap + line are they refused');

  const running = [OK_OUTCOME('a', 100), OK_OUTCOME('b', 200), OK_OUTCOME('c', 300)];
  const waited = [WAITED_OUTCOME('d', 4000), WAITED_OUTCOME('e', 9000)];
  const report = buildReport(6, 3, 2, [...running, ...waited, REFUSED_OUTCOME('f', 'server_busy')], OK_LEAK);
  eq('the report counts the devices that waited', report.queued, 2);
  eq('and their wait as p50/p95/max', report.waitMs, { p50: 4000, p95: 9000, max: 9000 });
  check('two over the cap wait and complete, the one past the full line is refused: ok', verdict(report).ok, JSON.stringify(verdict(report)));

  check('one over the cap waits and completes, nothing refused: ok', verdict(buildReport(4, 3, 2, [...running, waited[0]], OK_LEAK)).ok);
  eq('a run with nobody waiting reports zero waits', buildReport(3, 3, 2, running, OK_LEAK).waitMs, { p50: 0, p95: 0, max: 0 });
  const invalid: [string, number, DeviceOutcome[]][] = [
    ['a refusal while the line still had room', 4, [...running, REFUSED_OUTCOME('d', 'server_busy')]],
    ['a device past the cap that never waited (the server runs more than the stated cap)', 4, [...running, OK_OUTCOME('d', 5)]],
    ['a device that waited past the longest wait and failed', 4, [...running, { ...WAITED_OUTCOME('d', 180_000), terminal: 'failure' }]],
    ['a device still waiting when the driver gave up', 4, [...running, { deviceId: 'd', totalMs: 300_000, waitMs: 299_000 }]],
  ];
  for (const [label, devices, outcomes] of invalid) {
    check(`${label} fails the verdict`, !verdict(buildReport(devices, 3, 2, outcomes, OK_LEAK)).ok);
  }

  section('drive.ts: the leak probe fails on a device that waited or was refused');
  const probe = (id: string): DeviceOutcome => ({ deviceId: id, timeToFirstEventMs: 30, totalMs: 31 });
  check('two rounds of devices that all got a slot at once pass', leakVerdict([[probe('p1'), probe('p2')], [probe('p3'), probe('p4')]]).ok);
  const waitedProbe = leakVerdict([[probe('p1'), probe('p2')], [probe('p3'), { ...probe('p4'), waitMs: 1 }]]);
  eq('a probe device that waited in line fails it, named', [waitedProbe.ok, waitedProbe.detail], [false, 'device p4 waited in line during the leak probe']);
  const refusedProbe = leakVerdict([[REFUSED_OUTCOME('p1', 'server_busy'), probe('p2')], []]);
  eq('a probe device refused server_busy fails it, named', [refusedProbe.ok, refusedProbe.detail], [false, 'device p1 was refused server_busy during the leak probe']);

  section('drive.ts: --queue-max is required and may be 0');
  const base = ['--target', 'https://api.example.test', '--devices', '4', '--cap', '3'];
  eq('--queue-max reaches the args', parseArgs([...base, '--queue-max', '0']).queueMax, 0);
  for (const raw of [undefined, '-1', '1.5', '']) {
    const argv = raw === undefined ? base : [...base, '--queue-max', raw];
    const threw = (() => {
      try {
        parseArgs(argv);
        return undefined;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    })();
    check(`--queue-max ${JSON.stringify(raw ?? 'missing')} is refused, naming the flag`, threw?.includes('--queue-max') === true, String(threw));
  }
}

function testCpuNormalization(): void {
  section('drive.ts: the report normalizes per-core CPU% to the whole machine (fix-9, 10.2/R18)');

  eq('parseCoresLine reads the sampler\'s leading cores line', parseCoresLine('cores,4\n40,10\n80,20\n'), 4);
  eq('parseCoresLine finds the cores line anywhere in the text', parseCoresLine('40,10\ncores,8\n80,20\n'), 8);
  for (const bad of ['', '40,10\n80,20\n', 'cores,0\n', 'cores,-2\n', 'cores,1.5\n', 'cores,nope\n']) {
    eq(`parseCoresLine rejects ${JSON.stringify(bad)}`, parseCoresLine(bad), undefined);
  }

  const samplesWithCoresLine = parseStatsCsv('cores,4\n40.0,10.0\n80.0,20.0\n');
  eq('parseStatsCsv skips the cores line as an unparseable row', samplesWithCoresLine, [
    { cpuPercent: 40, memoryPercent: 10 },
    { cpuPercent: 80, memoryPercent: 20 },
  ] satisfies StatsSample[]);

  // Fixed sample list: per-core % of [40, 80, 120, 160, 200] on a 2-core machine normalizes to
  // [20, 40, 60, 80, 100] — nearest-rank p50 is the 3rd of 5 (60), p95 the 5th (100, also the peak).
  const fixed: StatsSample[] = [40, 80, 120, 160, 200].map((cpuPercent) => ({ cpuPercent, memoryPercent: 0 }));
  eq('cpuReport normalizes a fixed sample list by dividing per-core % by cores', cpuReport(fixed, 2), {
    cores: 2,
    samples: 5,
    p50Percent: 60,
    p95Percent: 100,
    peakPercent: 100,
  });

  // The tiny-sample case: one sample, still divided by cores, not left raw.
  eq('cpuReport normalizes the tiny-sample (single-sample) case', cpuReport([{ cpuPercent: 150, memoryPercent: 0 }], 2), {
    cores: 2,
    samples: 1,
    p50Percent: 75,
    p95Percent: 75,
    peakPercent: 75,
  });

  eq('cpuReport is undefined with no samples', cpuReport([], 4), undefined);
  for (const badCores of [0, -1, 1.5]) {
    eq(`cpuReport is undefined for a non-positive-integer core count (${badCores})`, cpuReport(fixed, badCores), undefined);
  }

  const statsPath = path.join(os.tmpdir(), `whim-loadtest-cpu-${process.pid}-${Date.now()}.csv`);
  try {
    fs.writeFileSync(statsPath, 'cores,2\n40,5\n80,10\n120,15\n160,20\n200,25\n');
    eq('readCpuReport reads cores and samples from a stats file end to end', readCpuReport(statsPath), {
      cores: 2,
      samples: 5,
      p50Percent: 60,
      p95Percent: 100,
      peakPercent: 100,
    });
  } finally {
    fs.rmSync(statsPath, { force: true });
  }
  eq('readCpuReport is undefined with no --stats path', readCpuReport(undefined), undefined);
  const noCoresPath = path.join(os.tmpdir(), `whim-loadtest-cpu-nocores-${process.pid}-${Date.now()}.csv`);
  try {
    fs.writeFileSync(noCoresPath, '40,5\n80,10\n');
    eq('readCpuReport is undefined when the sampler never wrote a cores line', readCpuReport(noCoresPath), undefined);
  } finally {
    fs.rmSync(noCoresPath, { force: true });
  }
}

// ── The Firestore admission load test's guards (#143, design D7) ──────────

function refusalOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function testFirestoreAdmissionHarnessGuards(): Promise<void> {
  section('Firestore admission load test: the harness refuses the production database and any non-throwaway name');
  for (const [label, database, deployed] of [
    ['(default)', '(default)', undefined],
    ['the deployed WHIM_FIRESTORE_DATABASE, even with the prefix', 'whim-loadtest-live', 'whim-loadtest-live'],
    ['a name without the whim-loadtest- prefix', 'whim-staging', undefined],
    ['the bare prefix', 'whim-loadtest-', undefined],
    ['an uppercase suffix', 'whim-loadtest-X', undefined],
  ] as const) {
    check(`refuses ${label}`, refusalOf(() => assertThrowawayDatabase(database, deployed)) !== undefined);
  }
  eq('accepts whim-loadtest-<suffix>', refusalOf(() => assertThrowawayDatabase('whim-loadtest-20261009', '(default)')), undefined);
  check(`--max-ops above the ${OPERATION_CEILING} ceiling is refused`, refusalOf(() => parseLoadArgs(['--max-ops', String(OPERATION_CEILING + 1)]))?.includes('--max-ops') === true);
  eq('--max-ops at the ceiling is accepted', parseLoadArgs(['--max-ops', String(OPERATION_CEILING)]).maxOps, OPERATION_CEILING);

  // The client reads FIRESTORE_EMULATOR_HOST from the process environment, so a refusal that failed
  // to stop the run would reach a closed local port, never real Firestore.
  const saved = process.env.FIRESTORE_EMULATOR_HOST;
  const savedError = console.error;
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${await closedPort()}`;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => errors.push(args.join(' '));
  try {
    const realEnv = { WHIM_FIRESTORE_DATABASE: 'whim-loadtest-live' };
    const cases: Array<[string, string[], NodeJS.ProcessEnv, string]> = [
      ['(default)', ['--database', '(default)', '--max-ops', '100'], realEnv, 'production'],
      ['the deployed database', ['--database', 'whim-loadtest-live', '--max-ops', '100'], realEnv, 'deployed'],
      ['a real database without --max-ops', ['--database', 'whim-loadtest-a1'], realEnv, '--max-ops'],
      ['a plan above its cap', ['--database', 'whim-loadtest-a1', '--max-ops', '10'], realEnv, 'above --max-ops'],
      ['no database and no emulator', [], {}, 'FIRESTORE_EMULATOR_HOST'],
    ];
    for (const [label, argv, env, needle] of cases) {
      errors.length = 0;
      const started = Date.now();
      const code = await firestoreAdmissionMain(argv, env);
      check(`main refuses ${label} with exit 2, naming why, before opening a client`, code === 2 && errors.some((line) => line.includes(needle)) && Date.now() - started < 1000, `${code}: ${errors.join(' | ')}`);
    }
  } finally {
    console.error = savedError;
    if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = saved;
  }
}

/** A client double whose transaction runs `update` `attempts` times on one transaction double that
 *  records every call it receives. */
function transactionDouble(attempts: number): { db: Firestore; sent: string[] } {
  const sent: string[] = [];
  const tx = {
    getAll: (...refs: unknown[]) => {
      sent.push(`getAll(${refs.length})`);
      return Promise.resolve([]);
    },
    create: () => sent.push('create'),
    set: () => sent.push('set'),
  };
  const db = {
    runTransaction: async (update: (t: Transaction) => Promise<unknown>) => {
      let result: unknown;
      for (let n = 0; n < attempts; n++) result = await update(tx as unknown as Transaction);
      return result;
    },
  };
  return { db: db as unknown as Firestore, sent };
}

async function admissionShaped(tx: Transaction): Promise<void> {
  await tx.getAll(...([1, 2, 3] as unknown as Parameters<Transaction['getAll']>));
  tx.create({} as never, {});
  tx.set({} as never, {});
  tx.set({} as never, {});
}

async function testFirestoreAdmissionBudget(): Promise<void> {
  section('Firestore admission load test: every read and write is charged before it is sent, and none past the cap');
  const open = transactionDouble(2);
  const budget = new OperationBudget();
  const client = countingTransactions(open.db, budget);
  await client.db.runTransaction(admissionShaped);
  eq('a retried transaction is counted as two attempts', client.attempts(), [2]);
  eq('both attempts\' three reads and three writes are charged', budget.used(), 12);

  const capped = transactionDouble(1);
  const small = new OperationBudget(5);
  const cappedClient = countingTransactions(capped.db, small);
  const err = await caught(async () => {
    await cappedClient.db.runTransaction(admissionShaped);
  });
  check('the transaction ends with OperationCapReached once the next write would pass the cap', err instanceof OperationCapReached, String(err));
  eq('the write past the cap never reached the transaction', capped.sent, ['getAll(3)', 'create', 'set']);
  eq('the budget holds exactly the operations sent', small.used(), 5);
  eq('the cost estimate prices the ceiling at $0.09', estimatedCostUsd(OPERATION_CEILING), 0.09);
}

interface ShellRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly gcloud: string[];
  readonly node: string[];
}

const SCRIPT_STUBS: Readonly<Record<string, string>> = {
  gcloud: `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_DIR/gcloud.log"
case "$*" in
  *'firestore databases create'*) exit "\${STUB_CREATE_EXIT:-0}" ;;
  *'firestore databases delete'*) exit "\${STUB_DELETE_EXIT:-0}" ;;
  *'firestore databases list'*) printf 'projects/anycognition-whim/databases/(default)\\n%b' "\${STUB_LEFTOVER:-}" ;;
esac
exit 0
`,
  node: `#!/usr/bin/env bash
printf '%s|emulator=%s|project=%s\\n' "$*" "\${FIRESTORE_EMULATOR_HOST:-}" "\${GOOGLE_CLOUD_PROJECT:-}" >>"$STUB_DIR/node.log"
if [ -n "\${STUB_NODE_SIGNAL:-}" ]; then kill -"$STUB_NODE_SIGNAL" "$PPID"; fi
exit "\${STUB_NODE_EXIT:-0}"
`,
  sleep: '#!/usr/bin/env bash\nexit 0\n',
};

/** Runs deploy/loadtest/firestore-admission.sh with gcloud, node and sleep stubbed on PATH and an
 *  empty HOME, so no operator value, credential or network is reachable. */
function runFirestoreAdmissionScript(args: readonly string[], env: Readonly<Record<string, string>> = {}): ShellRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-loadtest-'));
  try {
    const bin = path.join(dir, 'bin');
    const home = path.join(dir, 'home');
    fs.mkdirSync(bin);
    fs.mkdirSync(home);
    for (const [tool, body] of Object.entries(SCRIPT_STUBS)) fs.writeFileSync(path.join(bin, tool), body, { mode: 0o755 });
    const result = spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'loadtest', 'firestore-admission.sh'), ...args], {
      encoding: 'utf8',
      input: '',
      timeout: 60_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: home, TMPDIR: os.tmpdir(), STUB_DIR: dir, ...env },
    });
    const log = (tool: string): string[] => {
      const file = path.join(dir, `${tool}.log`);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [];
    };
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, gcloud: log('gcloud'), node: log('node') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function describeRun(run: ShellRun): string {
  return `exit ${run.status}\n${run.stdout}\n${run.stderr}\ngcloud: ${run.gcloud.join(' / ')}\nnode: ${run.node.join(' / ')}`;
}

function firstCall(calls: readonly string[], needle: string): number {
  return calls.findIndex((call) => call.includes(needle));
}

function testFirestoreAdmissionScript(): void {
  section('Firestore admission load test script: refusals happen before any gcloud call or client');
  const spend = ['--confirm-spend'];
  const refusals: Array<[string, string[], Record<string, string>, string]> = [
    ['(default)', ['--database', '(default)', ...spend], {}, 'production database'],
    ['the deployed WHIM_FIRESTORE_DATABASE', ['--database', 'whim-loadtest-live', ...spend], { WHIM_FIRESTORE_DATABASE: 'whim-loadtest-live' }, 'production database'],
    ['a name without the whim-loadtest- prefix', ['--database', 'whim-staging', ...spend], {}, 'throwaway'],
    [`a cap above the ${OPERATION_CEILING} ceiling`, ['--database', 'whim-loadtest-a1', '--max-ops', String(OPERATION_CEILING + 1), ...spend], {}, '--max-ops'],
    ['a run without --confirm-spend', ['--database', 'whim-loadtest-a1'], {}, '--confirm-spend'],
  ];
  for (const [label, args, env, needle] of refusals) {
    const run = runFirestoreAdmissionScript(args, env);
    check(
      `refuses ${label}: non-zero, named, no gcloud call and no harness run`,
      run.status !== 0 && run.stderr.includes(needle) && run.gcloud.length === 0 && run.node.length === 0,
      describeRun(run),
    );
  }

  section('Firestore admission load test script: a real-database run creates, runs, deletes and checks the list');
  const ok = runFirestoreAdmissionScript(['--database', 'whim-loadtest-a1', '--max-ops', String(OPERATION_CEILING), '--bursts', '10,50', ...spend], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:9' });
  const created = firstCall(ok.gcloud, 'firestore databases create --database=whim-loadtest-a1 --location=northamerica-northeast1');
  const deleted = firstCall(ok.gcloud, 'firestore databases delete --database=whim-loadtest-a1');
  const listed = firstCall(ok.gcloud, 'firestore databases list');
  check('the run passes, creating the database in WHIM_GCP_REGION, deleting it, then listing', ok.status === 0 && created >= 0 && deleted > created && listed > deleted, describeRun(ok));
  check(`  ... printing the cap's cost before it starts, as the harness estimates it ($${estimatedCostUsd(OPERATION_CEILING).toFixed(4)})`, ok.stdout.includes(`at most $${estimatedCostUsd(OPERATION_CEILING).toFixed(4)}`), ok.stdout);
  eq(
    '  ... and the harness runs once, on real Firestore (no emulator host), with the cap and the bursts',
    ok.node,
    [`server/test/firestore-admission.run.mjs --database whim-loadtest-a1 --max-ops ${OPERATION_CEILING} --bursts 10,50|emulator=|project=anycognition-whim`],
  );

  for (const [label, env, status] of [
    ['a failing run', { STUB_NODE_EXIT: '3' }, 3],
    ['an interrupted run (SIGTERM)', { STUB_NODE_SIGNAL: 'TERM' }, 143],
    ['a run whose create failed', { STUB_CREATE_EXIT: '4' }, 4],
  ] as const) {
    const run = runFirestoreAdmissionScript(['--database', 'whim-loadtest-a1', ...spend], env);
    check(
      `${label} still deletes the database and checks the list, keeping its exit status`,
      run.status === status && firstCall(run.gcloud, 'firestore databases delete --database=whim-loadtest-a1') >= 0 && firstCall(run.gcloud, 'firestore databases list') >= 0,
      describeRun(run),
    );
  }
  const failedDelete = runFirestoreAdmissionScript(['--database', 'whim-loadtest-a1', ...spend], { STUB_DELETE_EXIT: '1', STUB_LEFTOVER: 'projects/anycognition-whim/databases/whim-loadtest-a1\\n' });
  check('a database still listed after the run fails it, naming the database', failedDelete.status !== 0 && failedDelete.stderr.includes('databases/whim-loadtest-a1'), describeRun(failedDelete));
  const leftover = runFirestoreAdmissionScript(['--database', 'whim-loadtest-a1', ...spend], { STUB_LEFTOVER: 'projects/anycognition-whim/databases/whim-loadtest-older\\n' });
  check('  ... and so does any other whim-loadtest-* database left in the project', leftover.status !== 0 && leftover.stderr.includes('databases/whim-loadtest-older'), describeRun(leftover));

  section('Firestore admission load test script: the default run is the emulator, with no gcloud call');
  const emulator = runFirestoreAdmissionScript(['--bursts', '10', '--profile', 'generate']);
  check(
    'it runs the harness under the pinned emulator and never calls gcloud',
    emulator.status === 0 && emulator.gcloud.length === 0 && emulator.node.length === 1 && emulator.node[0]!.startsWith('scripts/firestore-emulator-test.mjs server/test/firestore-admission.run.mjs --bursts 10 --profile generate|'),
    describeRun(emulator),
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runLoadTestTests(): Promise<void> {
  await testKeyRefusal();
  await testOverridesEnvAndFetchTrap();
  await testReplayModelRoles();
  await testMachineOverReplayModel();
  await testProductionExclusion();
  testDeployFilesExcludeLoadtest();
  testSseFraming();
  testReportAndVerdict();
  testLineReportAndVerdict();
  testCpuNormalization();
  await testFirestoreAdmissionHarnessGuards();
  await testFirestoreAdmissionBudget();
  testFirestoreAdmissionScript();
}
