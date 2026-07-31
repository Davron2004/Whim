/**
 * server/src/generation/stages/build.ts — the concrete `BuildStage` (design D6/D12,
 * `handoff/stage-contracts.md`). Builds a checked candidate through `synthrun`'s
 * `buildCandidateSource`, which mirrors `build/build.mjs`'s esbuild call field-for-field (IIFE,
 * classic JSX, `{vc-sdk,react,react-dom}` externals, `tsconfigRaw:'{}'`) — the same production
 * bundle contract a delivered `WireAppRecord.bundle` must honor (spec "Bundle honours the
 * production contract"). A builder throw is mapped to ONE `build_failure` error diagnostic
 * (never propagated) so the machine feeds it through the ordinary repair loop, exactly like a
 * check-stage error.
 */
import type { BuildFailure } from 'esbuild';
import { buildCandidateSource } from '../../../../synthrun/builder';
import type { BuildOutcome, BuildStage } from '../machine';
import type { Diagnostic } from '@whim/contract';

function isBuildFailure(err: unknown): err is BuildFailure {
  return typeof err === 'object' && err !== null && Array.isArray((err as { errors?: unknown }).errors);
}

/** Renders the first esbuild error's text and source location (when present) into one
 *  actionable line; falls back to the raw error's message for a non-esbuild throw. */
function buildFailureDiagnostic(err: unknown): Diagnostic {
  if (isBuildFailure(err) && err.errors.length > 0) {
    const first = err.errors[0];
    const where = first.location ? ` (${first.location.file}:${first.location.line}:${first.location.column})` : '';
    const hint = `Fix the build error before this candidate can run: ${first.text}${where}.`;
    return { kind: 'build_failure', severity: 'error', message: hint, hint };
  }
  const text = err instanceof Error ? err.message : String(err);
  const hint = `Fix the build error before this candidate can run: ${text}.`;
  return { kind: 'build_failure', severity: 'error', message: hint, hint };
}

/** The production `BuildStage`: one call into the pinned production builder, `signal` accepted
 *  for interface conformance only — esbuild's one-shot `build()` call has no cancellation hook,
 *  and the machine already treats every stage call as atomic w.r.t. its own abort checks. */
export function createBuildStage(): BuildStage {
  return {
    async build(source: string): Promise<BuildOutcome> {
      try {
        const { js, map } = await buildCandidateSource(source);
        return { ok: true, result: { bundle: js, sourceMap: map } };
      } catch (err) {
        return { ok: false, diagnostic: buildFailureDiagnostic(err) };
      }
    },
  };
}
