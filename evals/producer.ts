/**
 * evals/producer.ts — candidate sourcing (design D12, task 6.2, `handoff/eval-contract.md`,
 * `handoff/report.md`'s "what chain-F still owns"). Two ways to obtain each case's candidate
 * source, neither ever executed or evaluated here — that is Tier A/B/C's job, driven by
 * `evals/cli.mjs`:
 *
 *   - `sourceFromDirectory`: reads `<sourceDir>/<caseId>.ts` for every case. Constructs no
 *     pipeline, contacts no model. A missing file is recorded as a per-case error naming the
 *     case id; the remaining cases still run (spec "Missing candidate source").
 *   - `sourceFromPipeline`: drives an injected, structurally-typed pipeline once per case. A
 *     completed stream carrying anything other than exactly one terminal event (`result` |
 *     `failure`) is a RUNNER error, never a candidate failure — never adopted as a source, never
 *     silently ignored (spec "Exactly one terminal event").
 *
 * `CandidatePipeline` is declared locally, NOT imported from `server/src/pipeline.ts`: `evals/`
 * (root RN tsconfig) can never statically import `server/src/*`, not even type-only
 * (`handoff/judge.md`'s precedent). Any object shaped like this — including a real
 * `createStubPipeline()` from that module — satisfies it structurally; `evals/cli.mjs` is the
 * one place that ever constructs a concrete pipeline and passes it in here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationEvent } from '@whim/contract';

export type CandidateSourceErrorKind = 'missing-source' | 'generation-failure' | 'runner-error';

export type CandidateSourceResult =
  | { readonly status: 'sourced'; readonly source: string }
  | { readonly status: 'error'; readonly kind: CandidateSourceErrorKind; readonly message: string };

export interface SourceableCase {
  readonly caseId: string;
  readonly prompt: string;
}

/** Structural shape of an injected generation pipeline (design D12) — see module header for why
 *  this is declared locally rather than imported. */
export interface CandidatePipeline {
  run(request: { readonly prompt: string }, signal?: AbortSignal): AsyncIterable<GenerationEvent>;
}

/**
 * Fully offline (spec "Fully offline sourcing"): every candidate is read from
 * `<sourceDir>/<caseId>.ts`, no pipeline is constructed, and no model is contacted. A case with
 * no matching file is recorded as `status: 'error', kind: 'missing-source'` naming the case id
 * and the path looked up; every other case is still sourced.
 */
export function sourceFromDirectory(
  cases: readonly SourceableCase[],
  sourceDir: string,
): Map<string, CandidateSourceResult> {
  const results = new Map<string, CandidateSourceResult>();
  for (const evalCase of cases) {
    const path = join(sourceDir, `${evalCase.caseId}.ts`);
    if (!existsSync(path)) {
      results.set(evalCase.caseId, {
        status: 'error',
        kind: 'missing-source',
        message: `no candidate source file for case "${evalCase.caseId}" at ${path}`,
      });
      continue;
    }
    results.set(evalCase.caseId, { status: 'sourced', source: readFileSync(path, 'utf8') });
  }
  return results;
}

/** The two terminal `GenerationEvent` variants (`@whim/contract`'s `type: 'result' | 'failure'`
 *  members) — narrowed once here so the exactly-one-terminal-event check below is fully typed,
 *  never a runtime cast. */
type TerminalEvent = Extract<GenerationEvent, { type: 'result' } | { type: 'failure' }>;

/**
 * Drives `pipeline.run({ prompt })` once per case (design D12). Classifies the result:
 *   - exactly one `result` terminal event ⇒ sourced, the app's original TS `source`;
 *   - exactly one `failure` terminal event ⇒ `status: 'error', kind: 'generation-failure'`
 *     (a real candidate outcome — the pipeline itself declared it could not produce an app);
 *   - anything else (0 or ≥2 terminal events, or the pipeline throwing) ⇒
 *     `status: 'error', kind: 'runner-error'` — a transport/harness bug, never read as a bad
 *     model (spec "Exactly one terminal event").
 */
export async function sourceFromPipeline(
  cases: readonly SourceableCase[],
  pipeline: CandidatePipeline,
): Promise<Map<string, CandidateSourceResult>> {
  const results = new Map<string, CandidateSourceResult>();
  for (const evalCase of cases) {
    results.set(evalCase.caseId, await sourceOneFromPipeline(evalCase, pipeline));
  }
  return results;
}

async function sourceOneFromPipeline(
  evalCase: SourceableCase,
  pipeline: CandidatePipeline,
): Promise<CandidateSourceResult> {
  const terminals: TerminalEvent[] = [];
  try {
    for await (const event of pipeline.run({ prompt: evalCase.prompt })) {
      if (event.type === 'result' || event.type === 'failure') terminals.push(event);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      status: 'error',
      kind: 'runner-error',
      message: `pipeline threw while generating case "${evalCase.caseId}": ${detail}`,
    };
  }

  if (terminals.length !== 1) {
    return {
      status: 'error',
      kind: 'runner-error',
      message:
        `generation stream for case "${evalCase.caseId}" completed carrying ${terminals.length} terminal ` +
        `events (expected exactly 1) — a runner error, not a candidate failure.`,
    };
  }

  const terminal = terminals[0];
  if (terminal.type === 'failure') {
    return {
      status: 'error',
      kind: 'generation-failure',
      message: `generation failed for case "${evalCase.caseId}": ${terminal.reason}`,
    };
  }
  return { status: 'sourced', source: terminal.app.source };
}
