/**
 * The stub's prompt markers for the beta-1 flow screens (`WHIM_PIPELINE=stub`: a dev server that
 * needs no model key, and that production refuses to boot). They let a simulator reach the clarify
 * limit and each fallback of a message the app can't use without a model call. Same idiom as the
 * stub pipeline's `[[fail]]` and the stub clarify's `[[noclarify]]`: a literal substring of the
 * prompt, read only on the stub path — the model-backed path never looks at them.
 *
 * Kept apart from `pipeline.ts` (which bundles the stub app with esbuild) so the device's suites can
 * take their frames from here.
 */
import { PROTOCOL_LEVEL, type ClarifyResponse, type CompatFallback } from '@whim/contract';
import type { WireEvent } from './wire-level';

/** A prompt carrying it makes the stub clarify answer with a `limit` and no questions. */
export const STUB_LIMIT_MARKER = '[[limit]]';

/** The stub clarify's `limit` (beta-1 D9): the weather case, whose alternative clarifies normally. */
export const STUB_LIMIT: ClarifyResponse = {
  questions: [],
  limit: {
    reason: 'Mini-apps can’t fetch live weather, so this one can’t show today’s forecast.',
    alternative: 'a packing list you fill in yourself',
  },
};

/** The markers that make the stub generate stream carry one event of a type no app knows. */
const FUTURE_MARKERS: readonly (readonly [string, CompatFallback])[] = [
  ['[[future:skip]]', 'skip'],
  ['[[future:fail]]', 'fail'],
  ['[[future:update]]', 'update'],
];

/** The plain-text notice each ending fallback carries. */
const FUTURE_NOTICES: Readonly<Record<Exclude<CompatFallback, 'skip'>, string>> = {
  fail: 'This build needs a newer version of Whim to finish.',
  update: 'Update Whim to see this build through.',
};

/** Whether `prompt` carries a marker the stub PIPELINE reads — its own `[[fail]]` or a
 *  `[[future:*]]` — which the stub rewrite must pass through raw, since the pipeline only ever sees
 *  the rewritten prompt. */
export function carriesStubPipelineMarker(prompt: string): boolean {
  return prompt.includes('[[fail]]') || stubFutureFallback(prompt) !== undefined;
}

/** The fallback a prompt's `[[future:*]]` marker names, or `undefined` when it carries none. */
export function stubFutureFallback(prompt: string): CompatFallback | undefined {
  return FUTURE_MARKERS.find(([marker]) => prompt.includes(marker))?.[1];
}

/**
 * The event a `[[future:*]]` marker adds to the stub stream: a type from a protocol level above
 * this one, as the server sends it to an app that predates it (`wire-level.ts#eventForLevel` —
 * only its envelope): `compat` with that fallback, and a notice for `fail` and `update`.
 */
export function stubFutureFrame(fallback: CompatFallback): WireEvent {
  const notice = fallback === 'skip' ? {} : { notice: FUTURE_NOTICES[fallback] };
  return { type: 'stub-future', compat: { min: PROTOCOL_LEVEL + 1, fallback, ...notice } };
}
