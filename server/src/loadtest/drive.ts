/**
 * server/src/loadtest/drive.ts — the load-test driver (design D26; specs/server-deployment "A load
 * test measures capacity without spending provider credit"). Pure pieces (SSE framing, percentile,
 * the report builder, the verdict) are exported for `server/test/loadtest.suite.ts`; the
 * network-calling pieces (`runDevice`/`runDevices`/`leakProbe`) are exercised for real against a
 * live load-test server by `server/test/e2e.ts`. `server/loadtest.mjs` is the CLI these all bundle
 * into.
 *
 * One synthetic device is one fresh UUID posting `POST /v1/generate`, with a complete client
 * envelope (`../bench-envelope.ts`) and a prompt unique to it
 * (so the content-policy cache can never hide the classifier's work) and reading its SSE stream to
 * the terminal event, recording time to the first REAL event (never a `:` comment/keepalive frame),
 * total time, and how long it waited in the generation line (beta-1 D8) when its stream opened with
 * `queued`. The leak probe starts `cap` fresh devices, aborts each right after its first event, and
 * repeats once after a delay: every one of them must get a slot at once, so a leaked slot or a
 * place in line that never emptied shows up as a device that waited, or was refused `server_busy`,
 * in either round.
 *
 * `realFetch` is captured at module load, before anything can have installed the load-test
 * server's `fetch` trap (`server/src/loadtest/server.ts`): in production this driver runs as its
 * own CLI process, so the distinction never arises, but `server/test/e2e.ts` drives an in-process
 * server whose trap replaces `globalThis.fetch` for the whole Node process — the driver is a
 * separate actor from the server it's driving and must never be caught by the server's own
 * no-spend instrumentation.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { ApiError, GenerationEvent } from '@whim/contract';
import { benchEnvelopeHeaders } from '../bench-envelope';

const realFetch: typeof fetch = globalThis.fetch;

// ─── SSE framing ─────────────────────────────────────────────────────────────

/** One parsed frame. `event`/`data` are both `undefined` for a bare `:` comment (a keepalive) —
 *  callers that only care about REAL events filter those out. */
export interface ParsedSseFrame {
  event?: string;
  data?: string;
}

/**
 * Feeds one more chunk of raw SSE text into `buffer`, returning every frame that closed on a blank
 * line plus the unconsumed remainder to carry into the next call — so a frame split across two TCP
 * reads (or two calls) still parses whole once its blank line finally arrives.
 */
export function feedSseBuffer(buffer: string, chunk: string): { frames: ParsedSseFrame[]; buffer: string } {
  const text = buffer + chunk;
  const parts = text.split('\n\n');
  const remainder = parts.pop() ?? '';
  const frames: ParsedSseFrame[] = [];
  for (const raw of parts) {
    if (raw.trim().length === 0) continue;
    let event: string | undefined;
    let data: string | undefined;
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // comment/keepalive — carries neither field
      if (line.startsWith('event: ')) event = line.slice('event: '.length);
      else if (line.startsWith('data: ')) data = line.slice('data: '.length);
    }
    frames.push({ event, data });
  }
  return { frames, buffer: remainder };
}

/** A frame that actually carries an event (as opposed to a bare keepalive comment). */
export function isRealFrame(frame: ParsedSseFrame): boolean {
  return frame.event !== undefined && frame.data !== undefined;
}

export function parseGenerationEvent(frame: ParsedSseFrame): GenerationEvent | undefined {
  if (frame.data === undefined) return undefined;
  try {
    return JSON.parse(frame.data) as GenerationEvent;
  // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable frame is reported as "no event", never thrown
  } catch {
    return undefined;
  }
}

// ─── One device, one generation ──────────────────────────────────────────────

export interface DeviceOutcome {
  deviceId: string;
  /** Absent when the request was refused, or a stream never produced a real event before ending. */
  timeToFirstEventMs?: number;
  totalMs: number;
  /** Present only for a device that waited in the generation line: from its first `queued` event to
   *  its first event of any other type, or to the end of the stream when none came. */
  waitMs?: number;
  /** Absent on a refusal, an abort, or a stream that ended with no terminal event. */
  terminal?: 'result' | 'failure';
  refusal?: { status: number; error: string };
}

export interface RunDeviceOptions {
  baseUrl: string;
  prompt: string;
  deviceId?: string;
  /** Cancel the request the moment its first real event arrives — the leak probe's shape. */
  abortAfterFirstEvent?: boolean;
  /** Overall wall-clock bound for this one device, default `DEVICE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** One device's default wall-clock bound: a run's own 120 s plus the server's default longest wait
 *  in line (`WHIM_QUEUE_MAX_WAIT_MS`, 180 s). A device still waiting at the bound reports no
 *  terminal, which fails the verdict. */
const DEVICE_TIMEOUT_MS = 300_000;

/** Shapes a non-200 `/v1/generate` response into a refusal — a non-JSON body still reports, under
 *  a generic `http_<status>` code. */
async function refusalOf(response: Response): Promise<DeviceOutcome['refusal']> {
  let body: Partial<ApiError> = {};
  try {
    body = (await response.json()) as Partial<ApiError>;
  // eslint-disable-next-line no-restricted-syntax -- intentional: a non-JSON refusal body still reports, under a generic code
  } catch {
    /* falls through to the generic http_<status> code below */
  }
  return { status: response.status, error: typeof body.error === 'string' ? body.error : `http_${response.status}` };
}

interface SseOutcome {
  firstEventAt?: number;
  /** When the first `queued` event arrived, and when the first event of another type did. */
  queuedAt?: number;
  leftLineAt?: number;
  terminal?: 'result' | 'failure';
}

/** Folds one parsed frame into `outcome` in place — a bare comment/keepalive is a no-op. */
function applyFrame(outcome: SseOutcome, frame: ParsedSseFrame): void {
  if (!isRealFrame(frame)) return;
  const now = Date.now();
  outcome.firstEventAt ??= now;
  const parsed = parseGenerationEvent(frame);
  if (parsed?.type === 'queued') outcome.queuedAt ??= now;
  else if (outcome.queuedAt !== undefined) outcome.leftLineAt ??= now;
  if (parsed?.type === 'result' || parsed?.type === 'failure') outcome.terminal = parsed.type;
}

/** Reads `reader` frame by frame until it ends, its terminal event arrives, or (when
 *  `abortAfterFirstEvent`) its first real event does — canceling the reader in that last case. A
 *  mid-stream read error just ends the loop with whatever was already observed. */
async function readSseToOutcome(reader: ReadableStreamDefaultReader<Uint8Array>, abortAfterFirstEvent: boolean): Promise<SseOutcome> {
  const decoder = new TextDecoder();
  let buffer = '';
  const outcome: SseOutcome = {};

  for (;;) {
    let read: Awaited<ReturnType<typeof reader.read>>;
    try {
      read = await reader.read();
    // eslint-disable-next-line no-restricted-syntax -- intentional: a mid-stream abort/error just ends the read loop with whatever was observed so far
    } catch {
      return outcome;
    }
    if (read.done) return outcome;

    const fed = feedSseBuffer(buffer, decoder.decode(read.value, { stream: true }));
    buffer = fed.buffer;
    for (const frame of fed.frames) applyFrame(outcome, frame);

    if (abortAfterFirstEvent && outcome.firstEventAt !== undefined) {
      await reader.cancel().catch(() => undefined);
      return outcome;
    }
    if (outcome.terminal) return outcome;
  }
}

/** Drives one synthetic device's `POST /v1/generate` to its terminal event (or a refusal, or the
 *  first event when `abortAfterFirstEvent`). Never throws — a transport failure reports as a
 *  refusal with `status: 0`. */
export async function runDevice(options: RunDeviceOptions): Promise<DeviceOutcome> {
  const deviceId = options.deviceId ?? randomUUID();
  const started = Date.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEVICE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await realFetch(`${options.baseUrl}/v1/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': deviceId, ...benchEnvelopeHeaders() },
      body: JSON.stringify({ prompt: options.prompt }),
      signal,
    });
  } catch (err) {
    return {
      deviceId,
      totalMs: Date.now() - started,
      refusal: { status: 0, error: err instanceof Error ? err.message : String(err) },
    };
  }

  if (response.status !== 200) {
    return { deviceId, totalMs: Date.now() - started, refusal: await refusalOf(response) };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { deviceId, totalMs: Date.now() - started, refusal: { status: response.status, error: 'no_stream_body' } };
  }

  const { firstEventAt, queuedAt, leftLineAt, terminal } = await readSseToOutcome(reader, options.abortAfterFirstEvent ?? false);
  const endedAt = Date.now();
  return {
    deviceId,
    totalMs: endedAt - started,
    timeToFirstEventMs: firstEventAt !== undefined ? firstEventAt - started : undefined,
    waitMs: queuedAt !== undefined ? (leftLineAt ?? endedAt) - queuedAt : undefined,
    terminal,
  };
}

/** `count` fresh devices, concurrently, each with its own unique prompt. */
export async function runDevices(baseUrl: string, count: number): Promise<DeviceOutcome[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) => runDevice({ baseUrl, prompt: `whim load test device ${i} ${randomUUID()}` })),
  );
}

// ─── Leak probe ───────────────────────────────────────────────────────────────

export interface LeakProbeOutcome {
  ok: boolean;
  rounds: DeviceOutcome[][];
  detail?: string;
}

/** Two rounds of `cap` fresh devices, `roundDelayMs` apart (default 5000, spec "twice"), each
 *  aborted right after its first event, judged by `leakVerdict`. */
export async function leakProbe(baseUrl: string, cap: number, roundDelayMs = 5000): Promise<LeakProbeOutcome> {
  const rounds: DeviceOutcome[][] = [];
  for (let round = 0; round < 2; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, roundDelayMs));
    const outcomes = await Promise.all(
      Array.from({ length: cap }, () =>
        runDevice({ baseUrl, prompt: `whim load test leak probe ${randomUUID()}`, abortAfterFirstEvent: true }),
      ),
    );
    rounds.push(outcomes);
  }
  return leakVerdict(rounds);
}

/** The leak probe's verdict: with nothing else running, `cap` devices must each get a slot at once.
 *  One that waits in line, or is refused `server_busy`, in either round means a slot never came back
 *  or the line never emptied. */
export function leakVerdict(rounds: DeviceOutcome[][]): LeakProbeOutcome {
  const leaked = rounds.flat().find((o) => o.refusal?.error === 'server_busy' || o.waitMs !== undefined);
  let detail: string | undefined;
  if (leaked?.refusal) detail = `device ${leaked.deviceId} was refused server_busy during the leak probe`;
  else if (leaked) detail = `device ${leaked.deviceId} waited in line during the leak probe`;
  return { ok: leaked === undefined, rounds, detail };
}

// ─── Percentile, stats sampling, report, verdict ─────────────────────────────

/** Nearest-rank percentile over `values` (0 for an empty input). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export interface StatsSample {
  cpuPercent: number;
  memoryPercent: number;
}

/** Parses `run.sh`'s sampler CSV: one `cpuPercent,memoryPercent` pair per line (both docker
 *  `stats --format` percentages, e.g. `12.34,56.78` — no byte-unit conversion in bash; `200` means
 *  both vCPUs of an e2-standard-2, since these are per-core percentages), blank lines and
 *  unparseable rows (including the leading `cores,<N>` line `parseCoresLine` reads) skipped. */
export function parseStatsCsv(text: string): StatsSample[] {
  const samples: StatsSample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [cpuRaw, memRaw] = trimmed.split(',');
    const cpuPercent = Number(cpuRaw);
    const memoryPercent = Number(memRaw);
    if (Number.isFinite(cpuPercent) && Number.isFinite(memoryPercent)) samples.push({ cpuPercent, memoryPercent });
  }
  return samples;
}

const CORES_LINE_PREFIX = 'cores,';

/** Parses the one `cores,<N>` line `run.sh`'s sampler writes before its CSV samples (`nproc`, read
 *  once over the same ssh session as the sampler loop — never hardcoded) — `undefined` when no such
 *  line is present or its value isn't a positive integer. */
export function parseCoresLine(text: string): number | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(CORES_LINE_PREFIX)) continue;
    const cores = Number(trimmed.slice(CORES_LINE_PREFIX.length));
    if (Number.isInteger(cores) && cores > 0) return cores;
  }
  return undefined;
}

export interface PeakStats {
  peakCpuPercent: number;
  peakMemoryPercent: number;
}

export function peakStats(samples: readonly StatsSample[]): PeakStats | undefined {
  if (samples.length === 0) return undefined;
  return samples.reduce(
    (peak, s) => ({
      peakCpuPercent: Math.max(peak.peakCpuPercent, s.cpuPercent),
      peakMemoryPercent: Math.max(peak.peakMemoryPercent, s.memoryPercent),
    }),
    { peakCpuPercent: 0, peakMemoryPercent: 0 },
  );
}

/** CPU usage normalized to the whole machine (per-core `docker stats` % ÷ `cores`), so `100` means
 *  every vCPU saturated — the shape the beta-1 cap rule (`specs/server-admission-control`, "p95 CPU
 *  under 70 %") is stated in, unlike `PeakStats.peakCpuPercent`, which stays raw/per-core. */
export interface CpuReport {
  cores: number;
  samples: number;
  p50Percent: number;
  p95Percent: number;
  peakPercent: number;
}

/** `undefined` when there are no samples or `cores` isn't a positive integer — a missing/unreadable
 *  `nproc` result means no normalized figure can be reported, not a divide-by-a-guessed-constant. */
export function cpuReport(samples: readonly StatsSample[], cores: number): CpuReport | undefined {
  if (samples.length === 0 || !Number.isInteger(cores) || cores <= 0) return undefined;
  const normalized = samples.map((s) => s.cpuPercent / cores);
  return {
    cores,
    samples: samples.length,
    p50Percent: percentile(normalized, 50),
    p95Percent: percentile(normalized, 95),
    peakPercent: percentile(normalized, 100),
  };
}

export interface LoadTestReport {
  devices: number;
  cap: number;
  /** The server's `WHIM_QUEUE_MAX`, as the operator passed it. */
  queueMax: number;
  timeToFirstEventMs: { p50: number; p95: number };
  totalMs: { p50: number; p95: number };
  /** Devices that waited in line, and how long they waited. */
  queued: number;
  waitMs: { p50: number; p95: number; max: number };
  terminals: { result: number; failure: number; none: number };
  refusals: Record<string, number>;
  leakProbe: { ok: boolean; detail?: string };
  /** Raw/per-core (continuity with earlier reports) — `cpu` below is the normalized figure the cap
   *  rule is stated in. */
  peak?: PeakStats;
  cpu?: CpuReport;
}

export function buildReport(
  devices: number,
  cap: number,
  queueMax: number,
  outcomes: readonly DeviceOutcome[],
  leak: LeakProbeOutcome,
  peak?: PeakStats,
  cpu?: CpuReport,
): LoadTestReport {
  const firstEvents = outcomes.map((o) => o.timeToFirstEventMs).filter((v): v is number => v !== undefined);
  const totals = outcomes.map((o) => o.totalMs);
  const waits = outcomes.map((o) => o.waitMs).filter((v): v is number => v !== undefined);
  const refusals: Record<string, number> = {};
  let result = 0;
  let failure = 0;
  let none = 0;
  for (const o of outcomes) {
    if (o.refusal) refusals[o.refusal.error] = (refusals[o.refusal.error] ?? 0) + 1;
    else if (o.terminal === 'result') result += 1;
    else if (o.terminal === 'failure') failure += 1;
    else none += 1;
  }
  return {
    devices,
    cap,
    queueMax,
    timeToFirstEventMs: { p50: percentile(firstEvents, 50), p95: percentile(firstEvents, 95) },
    totalMs: { p50: percentile(totals, 50), p95: percentile(totals, 95) },
    queued: waits.length,
    waitMs: { p50: percentile(waits, 50), p95: percentile(waits, 95), max: percentile(waits, 100) },
    terminals: { result, failure, none },
    refusals,
    leakProbe: { ok: leak.ok, detail: leak.detail },
    peak,
    cpu,
  };
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

/** Every admitted device must finish successfully, including every one that waited in line; the
 *  devices past the cap wait, and only those past the cap and a full line may be refused busy. */
export function verdict(report: LoadTestReport): Verdict {
  if (report.terminals.failure > 0) {
    return { ok: false, reason: `${report.terminals.failure} run(s) ended in a failure terminal` };
  }
  const refused = Object.values(report.refusals).reduce((a, b) => a + b, 0);
  const room = report.cap + report.queueMax;
  if (refused > 0 && report.devices <= room) {
    return { ok: false, reason: `${refused} refusal(s) at ${report.devices} device(s) <= cap ${report.cap} + line ${report.queueMax}: ${JSON.stringify(report.refusals)}` };
  }
  if (report.terminals.none > 0) {
    return { ok: false, reason: `${report.terminals.none} run(s) ended without a terminal event` };
  }
  if (report.terminals.result + report.terminals.failure + report.terminals.none + refused !== report.devices) {
    return { ok: false, reason: 'the report does not account for exactly the requested number of devices' };
  }
  const expectedRefusals = Math.max(0, report.devices - room);
  if (refused !== expectedRefusals || (report.refusals.server_busy ?? 0) !== expectedRefusals) {
    return { ok: false, reason: `expected ${expectedRefusals} server_busy refusal(s), got ${JSON.stringify(report.refusals)}` };
  }
  const expectedQueued = Math.min(Math.max(0, report.devices - report.cap), report.queueMax);
  if (report.queued !== expectedQueued) {
    return { ok: false, reason: `expected ${expectedQueued} device(s) to wait in line, ${report.queued} did` };
  }
  if (!report.leakProbe.ok) {
    return { ok: false, reason: report.leakProbe.detail ?? 'the leak probe failed' };
  }
  return { ok: true };
}

// ─── CLI argument parsing (pure — `server/loadtest.mjs` does the I/O) ────────

export interface CliArgs {
  target: string;
  devices: number;
  cap: number;
  /** The server's `WHIM_QUEUE_MAX`; `0` when it runs with no line. */
  queueMax: number;
  jsonPath?: string;
  statsPath?: string;
}

function positiveInt(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`--${name} is required`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

function nonNegativeInt(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`--${name} is required`);
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** Parses `node server/loadtest.mjs --target <url> --devices <N> --cap <C> --queue-max <Q> [--json <file>] [--stats <file>]`.
 *  Throws with an actionable message on any missing/malformed flag. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
    const name = flag.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    values.set(name, value);
    i += 1;
  }
  const target = values.get('target');
  if (!target) throw new Error('--target <https url> is required');
  return {
    target,
    devices: positiveInt('devices', values.get('devices')),
    cap: positiveInt('cap', values.get('cap')),
    queueMax: nonNegativeInt('queue-max', values.get('queue-max')),
    jsonPath: values.get('json'),
    statsPath: values.get('stats'),
  };
}

/** Reads `--stats`, when given, into a peak-usage summary — kept a pure-argument function (rather
 *  than folded into `parseArgs`) so `server/loadtest.mjs` is the only place that touches the
 *  filesystem for it. */
export function readPeakStats(statsPath: string | undefined): PeakStats | undefined {
  if (!statsPath) return undefined;
  return peakStats(parseStatsCsv(fs.readFileSync(statsPath, 'utf8')));
}

/** Reads `--stats`, when given, into the normalized CPU report — `undefined` when there's no file,
 *  no samples, or the sampler's `cores,<N>` line is missing/unparseable (never a hardcoded core
 *  count). Kept a pure-argument function alongside `readPeakStats` for the same reason. */
export function readCpuReport(statsPath: string | undefined): CpuReport | undefined {
  if (!statsPath) return undefined;
  const text = fs.readFileSync(statsPath, 'utf8');
  const cores = parseCoresLine(text);
  if (cores === undefined) return undefined;
  return cpuReport(parseStatsCsv(text), cores);
}
