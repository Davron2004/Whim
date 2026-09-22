/**
 * server/test/loadtest.suite.ts — chain-16's suite (design D26; specs/server-deployment "A load
 * test measures capacity without spending provider credit"). Node-only, no Chromium: it never calls
 * the real `startServer` (which would launch a browser) — the browser-backed integration case (three
 * concurrent generations, the fourth refused, the leak probe, the `fetch` trap counting zero calls
 * for real) lives in `server/test/e2e.ts` (task 17.5).
 *
 * Covers: `runLoadtestServer`'s key refusal and its override/env/fetch-trap plumbing against an
 * injected `start`; `createReplayModel`'s per-role replies and fixture rotation; a full
 * `GenerationMachine` run over the replay model with a stub run stage, and an abort mid-turn;
 * the production-exclusion metafile tripwire; the load-test compose override; and `drive.ts`'s
 * pure pieces (SSE framing, the report builder, the verdict).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caught, check, eq, section } from './harness';
import { bundleServerEntry } from '../build.mjs';
import type { ServerHandle, StartServerOptions, StartServerOverrides } from '../src/lifecycle';
import type { ServerConfig } from '../src/config';
import { runLoadtestServer, LoadtestConfigError, LOADTEST_ROSTER, LOADTEST_INERT_API_KEY, LOADTEST_HEALTHZ_SERVICE } from '../src/loadtest/server';
import { createReplayModel, loadRotationFixtures } from '../src/loadtest/replay-model';
import { runStaticChecks } from '../../checks/index';
import { createCheckStage } from '../src/generation/stages/check';
import { createBuildStage } from '../src/generation/stages/build';
import { loadPromptInputs } from '../src/generation/prompts/inputs';
import { GenerationMachine, type CheckedManifest, type RunStage } from '../src/generation/machine';
import type { ModelRoster, ModelStream } from '../src/generation/model';
import type { GenerateRequest, GenerationEvent, Usage } from '@whim/contract';
import {
  buildReport,
  feedSseBuffer,
  isRealFrame,
  parseGenerationEvent,
  verdict,
  type DeviceOutcome,
  type LeakProbeOutcome,
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
      [LOADTEST_ROSTER.engineer, LOADTEST_ROSTER.rewrite],
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
    const healthzRes = (await outer?.fetch(new Request('http://127.0.0.1/healthz'), {} as never)) as Response;
    eq('wrapApp intercepts /healthz with the load-test identity', await healthzRes.json(), { ok: true, service: LOADTEST_HEALTHZ_SERVICE });
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

  const roster: ModelRoster = { engineer: 'lt/engineer', rewrite: 'lt/rewrite' };
  const fixtures = loadRotationFixtures();
  check('setup: at least one top-level fixture passes runStaticChecks with no error diagnostic', fixtures.length > 0);
  const model = createReplayModel({ roster, engineerTurnMs: 1, rewriteTurnMs: 1, fixtures });

  const classifierText = await collectText(
    model.stream({ model: roster.rewrite, messages: [{ role: 'system', content: CLASSIFIER_SYSTEM_PROBE }, { role: 'user', content: 'Text to judge' }] }),
  );
  eq('the classifier always allows', JSON.parse(classifierText), { verdict: 'allow' });

  const seen = new Set<string>();
  for (let i = 0; i < fixtures.length * 2; i++) {
    const text = await collectText(
      model.stream({ model: roster.engineer, messages: [{ role: 'system', content: GENERATE_SYSTEM_PROBE }, { role: 'user', content: 'Request: an app' }] }),
    );
    check(
      `generate call ${i}: the rotated reply passes runStaticChecks with no error diagnostic`,
      !runStaticChecks(text).diagnostics.some((d) => d.severity === 'error'),
    );
    seen.add(text);
  }
  eq('every clean fixture is seen across two full rotations', seen.size, fixtures.length);

  const unknownModelErr = await caught(() => {
    model.stream({ model: 'not-a-roster-id', messages: [{ role: 'system', content: 'x' }] });
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

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-loadtest-redcheck-'));
  try {
    const mainInputs = await bundleServerEntry({ entry: 'server/src/main.ts', outfile: path.join(scratch, 'main-probe.mjs'), write: false });
    eq(
      'no input under server/src/loadtest/ reaches the production entry',
      mainInputs.filter((i) => i.startsWith('server/src/loadtest/')),
      [],
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
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
  section('drive.ts: buildReport aggregation and the exit-rule verdict');

  const clean = [OK_OUTCOME('a', 100), OK_OUTCOME('b', 200), OK_OUTCOME('c', 300)];
  const cleanReport = buildReport(3, 3, clean, OK_LEAK);
  eq('terminals tally correctly', cleanReport.terminals, { result: 3, failure: 0, none: 0 });
  eq('p50 time-to-first-event over [100,200,300]', cleanReport.timeToFirstEventMs.p50, 200);
  check('a clean report with a passing probe verdicts ok', verdict(cleanReport).ok);

  const failing = [OK_OUTCOME('a', 100), { deviceId: 'b', totalMs: 50, terminal: 'failure' as const }];
  check('any failure terminal fails the verdict', verdict(buildReport(2, 2, failing, OK_LEAK)).ok === false);

  const refusedWithinCap = [OK_OUTCOME('a', 100), REFUSED_OUTCOME('b', 'server_busy')];
  check('a refusal when devices <= cap fails the verdict', verdict(buildReport(2, 3, refusedWithinCap, OK_LEAK)).ok === false);

  const refusedOverCap = [OK_OUTCOME('a', 100), REFUSED_OUTCOME('b', 'server_busy'), REFUSED_OUTCOME('c', 'server_busy')];
  check(
    'a refusal when devices EXCEEDS the cap is expected and does not fail the verdict on its own',
    verdict(buildReport(3, 1, refusedOverCap, OK_LEAK)).ok === true,
  );

  check('a clean run below capacity passes', verdict(buildReport(2, 3, clean.slice(0, 2), OK_LEAK)).ok);
  const capPlusOne = [...clean, REFUSED_OUTCOME('d', 'server_busy')];
  check('cap + 1 passes with exactly one server_busy refusal', verdict(buildReport(4, 3, capPlusOne, OK_LEAK)).ok);
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
    check(`${label} fails the capacity verdict`, !verdict(buildReport(devices, cap, outcomes, OK_LEAK)).ok);
  }

  const leaked: LeakProbeOutcome = { ok: false, rounds: [[REFUSED_OUTCOME('probe-1', 'server_busy')], []], detail: 'leaked' };
  check('a failed leak probe fails the verdict even with a clean run', verdict(buildReport(2, 2, clean.slice(0, 2), leaked)).ok === false);
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
}
