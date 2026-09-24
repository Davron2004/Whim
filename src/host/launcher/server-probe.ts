/**
 * server-probe — the one probe function shared by Settings save-time verification (chain-4) and
 * the launcher startup/retry loop (chain-3), per design.md decisions 1-2 and spec
 * "A shared probe classifies a server address as verified, unverified, or unreachable".
 *
 * Issues `GET <baseUrl>/healthz` and classifies the outcome against the `generation-server`
 * healthz identity stamp (`{ ok: true, service: 'whim-server' }`, `server/src/app.ts`'s `/healthz`
 * route): a 200 response whose body parses and carries `service === 'whim-server'` is
 * `'verified'`; a 200 response with any other or unparseable body is `'unverified'`; a non-200
 * response, a network error, or a timeout is `'unreachable'`. Never throws.
 *
 * The same response also carries the minimum supported build per platform (`minBuild`,
 * request-envelope D4), which `probeServerHealth` reads for the launch-time update check (D5):
 * only a verified Whim server's well-formed `minBuild` counts, and anything else — a server from
 * before `minBuild` existed, a malformed value, a probe that failed — means no known minimum.
 *
 * No React Native import — pure request/classify logic, Node-suite testable in isolation
 * (`npm run launcher:test`, `test/server-probe.suite.ts`), per this repo's pure-logic-in-non-RN-
 * siblings convention (`server-address.ts` is the same-layer precedent this file sits beside).
 */

import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export type ProbeResult = 'verified' | 'unverified' | 'unreachable';

export interface ProbeServerOptions {
  /** Milliseconds to wait before aborting the request. Default 4000 (the ~4s save-time budget,
   *  design.md decision 2). */
  timeoutMs?: number;
  /** Injectable `fetch`, defaulting to the global. Mirrors `generation-client.ts`'s
   *  `ClientOptions.fetchImpl` so `launcher:test` can supply canned responses with no real HTTP
   *  server. */
  fetchImpl?: typeof fetch;
}

/** The minimum supported build per platform, as `/healthz` reports it. `0` means that platform
 *  has no minimum. */
export interface MinimumBuilds {
  readonly ios: number;
  readonly android: number;
}

/** A probe's classification, plus the minimums when a verified Whim server reported well-formed
 *  ones (absent = no known minimum). */
interface ServerHealth {
  readonly result: ProbeResult;
  readonly minBuild?: MinimumBuilds;
}

const DEFAULT_TIMEOUT_MS = 4000;
const SERVICE_IDENTITY = 'whim-server';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A non-negative safe integer, the only shape the server ever sends for a minimum. */
function isMinimum(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** `body.minBuild` when it names a minimum for BOTH platforms, else `undefined` — a partial or
 *  mistyped value is treated as absent, never guessed at. */
function minimumBuildsOf(body: Record<string, unknown>): MinimumBuilds | undefined {
  const minBuild = body.minBuild;
  if (!isRecord(minBuild) || !isMinimum(minBuild.ios) || !isMinimum(minBuild.android)) return undefined;
  return { ios: minBuild.ios, android: minBuild.android };
}

/**
 * `GET ${baseUrl}/healthz`, aborted via `AbortController` + `setTimeout` at `opts.timeoutMs`
 * (default 4000ms), classified per this module's doc comment above. Every failure path
 * (non-200, thrown network error, or the timeout firing) resolves to `'unreachable'` rather than
 * rejecting — callers never need a try/catch around this call.
 */
export async function probeServer(baseUrl: string, opts: ProbeServerOptions = {}): Promise<ProbeResult> {
  return (await probeServerHealth(baseUrl, opts)).result;
}

/** `probeServer`'s one request and classification, with the reported minimums alongside. Never
 *  rejects, for the same reasons. */
export async function probeServerHealth(baseUrl: string, opts: ProbeServerOptions = {}): Promise<ServerHealth> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/healthz`, { method: 'GET', signal: controller.signal });
  } catch (err) {
    // Expected, routine outcome for this probe (a misconfigured or currently-down address, or the
    // ~4s timeout firing) — logged at debug so a real regression is still traceable through the
    // seam without an every-few-seconds retry loop spamming the error channel while offline.
    log.debug(CHANNELS.gen, 'probeServer: request failed', {
      host: baseUrl.replace(/^https?:\/\//, ''),
      message: err instanceof Error ? err.message : String(err),
    });
    return { result: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status !== 200) {
    return { result: 'unreachable' };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || body.service !== SERVICE_IDENTITY) return { result: 'unverified' };
  const minBuild = minimumBuildsOf(body);
  return minBuild === undefined ? { result: 'verified' } : { result: 'verified', minBuild };
}
