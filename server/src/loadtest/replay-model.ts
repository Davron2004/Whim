/**
 * server/src/loadtest/replay-model.ts — the no-spend `ModelClient` the load-test server runs
 * against (design D26; specs/server-deployment "A load test measures capacity without spending
 * provider credit"). It imports no transport and no `fetch` — every turn is a canned, deterministic
 * reply produced from a timer alone.
 *
 * The role is read from `req.model` against the load-test roster (`loadtest/engineer` /
 * `loadtest/rewrite`, `server.ts`'s `LOADTEST_ROSTER`), never guessed from message content, and
 * paces the reply: engineer-role turns (plan/generate/repair, all called with `roster.engineer`,
 * see `machine.ts#runModelTurn`) wait `engineerTurnMs`; rewrite-role turns (the content-policy
 * classifier, `/v1/rewrite`, `/v1/clarify`, the summariser — all called with `roster.rewrite`) wait
 * `rewriteTurnMs`. Within a role, WHICH canned reply is returned is read from the turn's own system
 * message, which is stable, distinctive prompt text owned by `generation/prompts/index.ts` and
 * `policy/policy.ts` (not re-exported — matched as substrings; a rewording there is a class-A
 * follow-up here, not a contract break, since a class-B fallback — the raw text reply the shapers
 * accept below — still keeps every turn conforming).
 *
 * - The plan turn gets a fixed, minimal, always-valid plan (`plan.ts#validatePlan`: no screens
 *   dangle, no unknown capability, no orphaned storage key).
 * - The classifier turn always allows (`policy.ts#parseVerdict`'s `{"verdict":"allow"}`).
 * - Every other engineer-role turn (generate, repair) gets one of the top-level `fixtures/*.app.tsx`
 *   that pass `runStaticChecks` with no error diagnostic, rotating forward on every such call so a
 *   run's synthetic-run stage sees different screens and sweeps across the load test.
 * - `/v1/rewrite`, `/v1/clarify` and the post-run summariser all degrade gracefully on a reply that
 *   is not their expected JSON (`routes/rewrite.ts#shapeRewrite` falls back to plain prose;
 *   `routes/clarify.ts`/`summarise.ts#shapeSummary` simply produce nothing) — a load test's driver
 *   never calls `/v1/rewrite` or `/v1/clarify` anyway (design D26: it only posts `/v1/generate`), so
 *   these get the same empty reply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runStaticChecks } from '../../../checks/index';
import type { ModelClient, ModelDelta, ModelMessage, ModelRequest, ModelRoster, ModelStream } from '../generation/model';
import type { Usage } from '@whim/contract';

export const DEFAULT_ENGINEER_TURN_MS = 15_000;
export const DEFAULT_REWRITE_TURN_MS = 1_000;

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const PLAN_RESPONSE = JSON.stringify({
  screens: [{ name: 'Main', purpose: "the app's one screen" }],
  initial: 'Main',
  state: [],
  capabilities: [],
  storageKeys: [],
});

const ALLOW_VERDICT = JSON.stringify({ verdict: 'allow' });

/** Substrings of the fixed system-message prefixes the real prompts carry — see the module doc for
 *  why matching them here is safe even if the wording moves. */
const PLAN_MARKER = 'planning a tiny Whim mini-app';
const CLASSIFIER_MARKER = "content-safety classifier";

export interface ReplayModelOptions {
  roster: ModelRoster;
  /** `WHIM_LOADTEST_ENGINEER_TURN_MS`, default 15000. */
  engineerTurnMs?: number;
  /** `WHIM_LOADTEST_REWRITE_TURN_MS`, default 1000. */
  rewriteTurnMs?: number;
  /** Injectable for the suite; defaults to `loadRotationFixtures()`'s real scan. */
  fixtures?: readonly string[];
}

/**
 * Every top-level `fixtures/*.app.tsx` source (never `fixtures/adversarial/**`) that passes
 * `runStaticChecks` with no error-severity diagnostic, sorted by filename for a deterministic
 * rotation order. Throws if none qualify — a load test with nothing to generate is a setup bug, not
 * a quiet no-op.
 */
export function loadRotationFixtures(cwd: string = process.cwd()): string[] {
  const dir = path.join(cwd, 'fixtures');
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.app.tsx'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const clean: string[] = [];
  for (const name of names) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    const report = runStaticChecks(source);
    if (!report.diagnostics.some((d) => d.severity === 'error')) clean.push(source);
  }
  if (clean.length === 0) {
    throw new Error('loadRotationFixtures: no top-level fixtures/*.app.tsx pass runStaticChecks with no error diagnostic.');
  }
  return clean;
}

function roleFor(roster: ModelRoster, model: string): 'engineer' | 'rewrite' | undefined {
  if (model === roster.engineer) return 'engineer';
  if (model === roster.rewrite) return 'rewrite';
  return undefined;
}

function systemMessageOf(messages: readonly ModelMessage[]): string {
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

/** Resolves `true` once `ms` elapse, or `false` the moment `signal` aborts first — never rejects,
 *  because an abort mid-wait is not a model failure (spec "Cancellation aborts the pipeline at
 *  every boundary"). */
function pacedWait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One replayed turn: waits `waitMs` (or stops quietly on abort, yielding nothing), then a single
 *  text delta carrying the whole reply. `usage`/`id` resolve alongside it, and stay pending forever
 *  on an aborted wait — nothing ever awaits them on that path (`machine.ts#runModelTurn` returns as
 *  soon as its abort check sees the deltas iterable end early). */
function replayStream(text: string, waitMs: number, signal: AbortSignal | undefined): ModelStream {
  let resolveUsage!: (usage: Usage) => void;
  const usage = new Promise<Usage>((resolve) => {
    resolveUsage = resolve;
  });
  let resolveId!: (id: string | undefined) => void;
  const id = new Promise<string | undefined>((resolve) => {
    resolveId = resolve;
  });

  async function* deltas(): AsyncIterable<ModelDelta> {
    const completed = await pacedWait(waitMs, signal);
    if (!completed) return;
    yield { kind: 'text', text };
    resolveUsage(ZERO_USAGE);
    resolveId(undefined);
  }

  return { deltas: deltas(), usage, id };
}

/**
 * The no-spend replay `ModelClient` (design D26). Every call is answered locally and
 * deterministically; nothing here ever imports a transport or touches `fetch`.
 */
export function createReplayModel(options: ReplayModelOptions): ModelClient {
  const { roster } = options;
  const engineerTurnMs = options.engineerTurnMs ?? DEFAULT_ENGINEER_TURN_MS;
  const rewriteTurnMs = options.rewriteTurnMs ?? DEFAULT_REWRITE_TURN_MS;
  const fixtures = options.fixtures ?? loadRotationFixtures();
  let cursor = 0;

  return {
    stream(req: ModelRequest, signal?: AbortSignal): ModelStream {
      const role = roleFor(roster, req.model);
      if (role === undefined) {
        throw new Error(
          `createReplayModel: request named an unknown model "${req.model}" — expected the load-test roster (${roster.engineer} / ${roster.rewrite}).`,
        );
      }
      const waitMs = role === 'engineer' ? engineerTurnMs : rewriteTurnMs;
      const system = systemMessageOf(req.messages);

      if (role === 'engineer' && system.includes(PLAN_MARKER)) {
        return replayStream(PLAN_RESPONSE, waitMs, signal);
      }
      if (role === 'engineer') {
        const source = fixtures[cursor % fixtures.length];
        cursor += 1;
        return replayStream(source, waitMs, signal);
      }
      if (system.includes(CLASSIFIER_MARKER)) {
        return replayStream(ALLOW_VERDICT, waitMs, signal);
      }
      // /v1/rewrite, /v1/clarify, the summariser: none of these are on the driver's path (it only
      // ever posts /v1/generate), and each degrades to "nothing structured came back" gracefully.
      return replayStream('', waitMs, signal);
    },
  };
}
