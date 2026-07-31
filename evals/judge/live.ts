/**
 * The live judge (design D7): wraps the real `OpenRouterClient` from `server/src/openrouter.ts`.
 * Construction THROWS unless BOTH an explicit opt-in argument and the `OPENROUTER_API_KEY`
 * credential environment variable are present — never proceeds with a silently substituted judge.
 * The acceptance suite (`evals/test/tier-c.test.ts`) exercises ONLY this refusal path; `score`
 * makes a real network call and is never invoked there.
 *
 * `server/src/openrouter.ts` targets Node's streaming globals under its own `server/tsconfig.json`
 * (`types: ["node"]`, no `jsx`); the root RN tsconfig excludes `contract`/`server` for exactly
 * this reason (see its comment) — react-native's own ambient `fetch`/`Response`/`TextDecoder`
 * shapes conflict with the WHATWG-streaming ones `OpenRouterClient` needs, and a static (even
 * type-only) import here would pull that file into the root `tsc` program and fail `npm run
 * typecheck`. So this module never statically imports it: `score` (reached only after a human
 * opts in with a real credential — never in the gate) shells out to the `esbuild` CLI binary to
 * bundle the real file into a throwaway ESM module, then dynamically imports THAT. This is a CLI
 * subprocess rather than esbuild's JS API deliberately: `evals/test/run.mjs` bundles every
 * `*.test.ts` file (including this module, transitively, via `tier-c.test.ts`'s construction-gate
 * tests) into one file, and esbuild's own package does a dynamic `require("fs")` internally that
 * throws when esbuild bundles esbuild (the same "esbuild-in-esbuild" hazard `evals/test/run.mjs`
 * avoids for the `typescript` package) — a subprocess never gets inlined into that bundle. This is
 * the one deliberate deviation from a plain `import` in this chain — see `handoff/judge.md`.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import type { JudgeCriterionScore, JudgeVerdict } from '../contract';
import { RUBRIC_CRITERIA, RUBRIC_VERSION } from '../rubric';
import type { Judge, JudgeInput } from './judge';

export const LIVE_JUDGE_CREDENTIAL_ENV_VAR = 'OPENROUTER_API_KEY';

export interface LiveJudgeOptions {
  /** Model id, forwarded verbatim to OpenRouter (never embedded — decision #42). */
  readonly model: string;
  /** Explicit opt-in — construction throws when this is not `true`. */
  readonly optIn: boolean;
}

interface LiveOpenRouterMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}
interface LiveStreamResult {
  readonly deltas: AsyncIterable<string>;
}
interface MinimalOpenRouterClient {
  stream(options: { model: string; messages: LiveOpenRouterMessage[]; temperature?: number }): LiveStreamResult;
}
interface OpenRouterModuleShape {
  OpenRouterClient: new () => MinimalOpenRouterClient;
}

let cachedModule: Promise<OpenRouterModuleShape> | undefined;

/** Bundles `server/src/openrouter.ts` via the `esbuild` CLI binary and dynamically imports the
 *  result. Cached per process — the real bundle/import work happens at most once regardless of
 *  how many cases are scored. */
function loadOpenRouterModule(): Promise<OpenRouterModuleShape> {
  if (!cachedModule) {
    cachedModule = (async () => {
      const entry = join(process.cwd(), 'server', 'src', 'openrouter.ts');
      const outfile = join(process.cwd(), `.evals-live-judge.${process.pid}.tmp.mjs`);
      const esbuildBin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
      execFileSync(esbuildBin, [
        entry,
        `--outfile=${outfile}`,
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--target=node22',
        '--tsconfig-raw={}',
        '--log-level=warning',
      ]);
      try {
        return (await import(pathToFileURL(outfile).href)) as OpenRouterModuleShape;
      } finally {
        if (existsSync(outfile)) rmSync(outfile, { force: true });
      }
    })();
  }
  return cachedModule;
}

function buildMessages(input: JudgeInput): LiveOpenRouterMessage[] {
  const criteriaList = RUBRIC_CRITERIA.map(
    (criterion) => `- "${criterion.id}" (${criterion.label}): integer ${criterion.minScore}-${criterion.maxScore}`,
  ).join('\n');
  const system =
    'You are scoring a generated mini-app against a fixed rubric. Respond with ONLY a JSON object shaped ' +
    '{ "criteria": [ { "criterion": string, "score": number, "rationale": string }, ... ] }, scoring EVERY ' +
    `one of these criteria exactly once, each with a one-sentence rationale:\n${criteriaList}`;
  const userLines = [
    `Prompt: ${input.prompt}`,
    input.expectation !== undefined ? `Expectation: ${input.expectation}` : undefined,
    `Reached screens: ${input.observation.reachedScreens.join(', ') || '(none)'}`,
    `Syscalls invoked: ${input.observation.syscallsInvoked.join(', ') || '(none)'}`,
    `Diagnostic count: ${input.observation.diagnostics.length}`,
  ].filter((line): line is string => line !== undefined);
  return [
    { role: 'system', content: system },
    { role: 'user', content: userLines.join('\n') },
  ];
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseVerdictResponse(text: string, judgeIdentity: string): JudgeVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`createLiveJudge: model response was not valid JSON (${detail}).`);
  }
  const criteria = isRecord(parsed) && Array.isArray(parsed.criteria) ? (parsed.criteria as JudgeCriterionScore[]) : [];
  return { rubricVersion: RUBRIC_VERSION, judgeIdentity, criteria };
}

/**
 * Throws synchronously unless BOTH `options.optIn === true` AND the `OPENROUTER_API_KEY`
 * environment variable is set — construction never proceeds with a silently substituted judge
 * (spec "Live judge requires explicit opt-in").
 */
export function createLiveJudge(options: LiveJudgeOptions): Judge {
  if (!options.optIn) {
    throw new Error(
      'createLiveJudge: refusing to construct without explicit opt-in (options.optIn must be true) — ' +
        'a live judge is never constructed silently.',
    );
  }
  const apiKey = process.env[LIVE_JUDGE_CREDENTIAL_ENV_VAR];
  if (!apiKey) {
    throw new Error(
      `createLiveJudge: refusing to construct without the ${LIVE_JUDGE_CREDENTIAL_ENV_VAR} environment variable.`,
    );
  }

  const judgeIdentity = `live:${options.model}`;

  return {
    async score(input: JudgeInput): Promise<JudgeVerdict> {
      const { OpenRouterClient } = await loadOpenRouterModule();
      const client = new OpenRouterClient();
      const { deltas } = client.stream({ model: options.model, messages: buildMessages(input), temperature: 0 });
      let text = '';
      for await (const delta of deltas) text += delta;
      return parseVerdictResponse(text, judgeIdentity);
    },
  };
}
