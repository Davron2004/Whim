/**
 * server/src/loadtest/server.ts — `runLoadtestServer`, the no-spend load-test composition (design
 * D26; specs/server-deployment "A load test measures capacity without spending provider credit").
 * Runs chain-11's exact production composition (`startServer`) with three swaps: the replay model
 * (`replay-model.ts`, no network code at all), a stats transport that resolves every id at zero
 * cost, and a credit transport that reports no limit. Admission, the ledger, the real content-policy
 * check (over the replay model), the machine, esbuild, the static checks and the sandboxed synthetic
 * run all stay production code, unmodified.
 *
 * Refuses to start when `OPENROUTER_API_KEY` is set in `env` — before installing the `fetch` trap or
 * calling `start` — and otherwise forces `NODE_ENV=production`, the inert key `loadtest-no-network`,
 * and the fixed roster `loadtest/engineer` / `loadtest/rewrite` onto the environment `start` sees, so
 * every other production refusal in `config.ts` still applies and nothing here is env-selectable.
 *
 * The `fetch` trap is a safety net independent of the two transport swaps above: it replaces
 * `globalThis.fetch` with a function that counts its calls and throws, installed right before
 * `start` and restored the moment the returned handle's `drain()`/`close()` first resolves. Any
 * code path that reaches for the network — a missed override, a stray dependency — fails loudly
 * instead of spending credit.
 *
 * This module never value-imports `../lifecycle` (only its TYPES, which TypeScript erases at
 * compile time) — `startServer` pulls in `synthrun/session.ts` and so `playwright`, which
 * `server/test/run.mjs`'s fast-suite bundle has no `external` entry for (`disconnect.suite.ts`
 * avoids the same graph for the same reason). `RunLoadtestServerOptions.start` is therefore
 * REQUIRED: `server/loadtest-server.entry.mjs` (bundled separately, by `server/loadtest-build.mjs`,
 * exactly like `server/src/main.ts`) is the one production caller, and passes chain-11's real
 * `startServer` explicitly. `server/test/loadtest.suite.ts` passes a fake instead, keeping the
 * whole suite Chromium-free.
 */
import { Hono } from 'hono';
import type { Servable, ServerHandle, StartServerOptions, StartServerOverrides } from '../lifecycle';
import { createReplayModel, DEFAULT_ENGINEER_TURN_MS, DEFAULT_REWRITE_TURN_MS } from './replay-model';
import type { CreditTransport } from '../admission/credit';
import type { UsageAndCostTransport } from '../usage/resolve';
import { defaultModelRoster, type ModelRoster } from '../generation/model';

/** A minimal, `lifecycle.ts`-free stand-in for `BootError` (see the module doc for why this file
 *  never imports that class): `reason` mirrors `BootFailureReason`'s `'config'` member, so a
 *  caller that logs `err.reason` alongside a real `BootError` from `start()` sees the same shape
 *  either way. */
export class LoadtestConfigError extends Error {
  readonly reason = 'config' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LoadtestConfigError';
  }
}

const ENGINEER_TURN_MS_ENV = 'WHIM_LOADTEST_ENGINEER_TURN_MS';
const REWRITE_TURN_MS_ENV = 'WHIM_LOADTEST_REWRITE_TURN_MS';

/** Fixed and never env-selectable (design D26: "adds no new model role or model id" applies here
 *  too — these are the load test's own roster, never the operator's real one). */
export const LOADTEST_ROSTER: ModelRoster = defaultModelRoster('loadtest/rewrite', 'loadtest/engineer');

/** The only key-shaped value that ever reaches `loadServerConfig` here — inert, and OpenRouter
 *  would reject it (design D26's third no-spend guarantee). */
export const LOADTEST_INERT_API_KEY = 'loadtest-no-network';

/** The identity `/healthz` answers under the load-test server — never the production string. */
export const LOADTEST_HEALTHZ_SERVICE = 'whim-server-loadtest';

export interface RunLoadtestServerOptions {
  env: NodeJS.ProcessEnv;
  listen?: StartServerOptions['listen'];
  /** Chain-11's `startServer` (production) or a test double (`server/test/loadtest.suite.ts`) —
   *  see the module doc. Never called when `env.OPENROUTER_API_KEY` is set. */
  start: (options: StartServerOptions) => Promise<ServerHandle>;
}

export interface LoadtestServerHandle extends ServerHandle {
  /** How many times the `fetch` trap fired. Must stay 0 for the whole life of the server
   *  (design D26's second no-spend guarantee). */
  fetchCallCount(): number;
}

function readPositiveIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new LoadtestConfigError(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

const zeroCostStatsTransport: UsageAndCostTransport = {
  async fetchStats() {
    return { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, totalCostUsd: 0 };
  },
};

/** `limit_remaining: null` is `checkCredit`'s own "no limit" value (`admission/credit.ts`) — never
 *  refuses, and never touches `fetch` (the value is returned directly, not fetched). */
const noLimitCreditTransport: CreditTransport = {
  async lookupKey() {
    return { status: 200, bodyText: JSON.stringify({ data: { limit_remaining: null } }) };
  },
};

type AppInstance = Parameters<NonNullable<StartServerOverrides['wrapApp']>>[0];

/** Shadows `/healthz` with the load-test identity; every other route falls through to the real
 *  app unchanged. */
function wrapWithLoadtestHealthz(app: AppInstance): Servable {
  const outer = new Hono();
  outer.get('/healthz', (c) => c.json({ ok: true, service: LOADTEST_HEALTHZ_SERVICE }, 200));
  outer.all('*', (c) => app.fetch(c.req.raw, c.env));
  return outer;
}

function installFetchTrap(): { restore: () => void; count: () => number } {
  const original = globalThis.fetch;
  let count = 0;
  const throwing: typeof fetch = (async (...args: Parameters<typeof fetch>) => {
    count += 1;
    throw new Error(
      `the load-test server attempted a network fetch (call #${count}) — this must never happen (design D26). args: ${JSON.stringify(String(args[0]))}`,
    );
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'fetch', { value: throwing, writable: true, configurable: true });
  return {
    restore: () => {
      Object.defineProperty(globalThis, 'fetch', { value: original, writable: true, configurable: true });
    },
    count: () => count,
  };
}

/**
 * The no-spend load-test server (design D26). See the module doc for the refusal/override/trap
 * sequence.
 */
export async function runLoadtestServer(options: RunLoadtestServerOptions): Promise<LoadtestServerHandle> {
  if (options.env.OPENROUTER_API_KEY) {
    throw new LoadtestConfigError('OPENROUTER_API_KEY must be unset for the load-test server (design D26) — refusing to start.');
  }

  const engineerTurnMs = readPositiveIntEnv(options.env, ENGINEER_TURN_MS_ENV, DEFAULT_ENGINEER_TURN_MS);
  const rewriteTurnMs = readPositiveIntEnv(options.env, REWRITE_TURN_MS_ENV, DEFAULT_REWRITE_TURN_MS);
  const model = createReplayModel({ roster: LOADTEST_ROSTER, engineerTurnMs, rewriteTurnMs });

  const loadtestEnv: NodeJS.ProcessEnv = {
    ...options.env,
    NODE_ENV: 'production',
    OPENROUTER_API_KEY: LOADTEST_INERT_API_KEY,
    WHIM_ENGINEER_MODEL: LOADTEST_ROSTER.engineer.model,
    WHIM_REWRITE_MODEL: LOADTEST_ROSTER.rewrite.model,
  };

  const trap = installFetchTrap();
  let handle: ServerHandle;
  try {
    handle = await options.start({
      env: loadtestEnv,
      listen: options.listen,
      overrides: {
        model: { client: model, roster: LOADTEST_ROSTER },
        statsTransport: zeroCostStatsTransport,
        creditTransport: noLimitCreditTransport,
        wrapApp: wrapWithLoadtestHealthz,
      },
    });
  } catch (err) {
    trap.restore();
    throw err;
  }

  let restored = false;
  const restoreOnce = (): void => {
    if (restored) return;
    restored = true;
    trap.restore();
  };

  return {
    ...handle,
    fetchCallCount: trap.count,
    drain: async () => {
      await handle.drain();
      restoreOnce();
    },
    close: async () => {
      await handle.close();
      restoreOnce();
    },
  };
}
