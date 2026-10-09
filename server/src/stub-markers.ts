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
import { PROTOCOL_LEVEL, type ClarifyResponse, type Compat, type CompatFallback } from '@whim/contract';
import { WIRE_REGISTRY, eventForLevel, type WireEntry, type WireEvent, type WireRegistry } from './wire-level';

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

/** The event type a `[[future:*]]` marker adds — one per fallback, since a registry entry carries
 *  one `compat`. */
function futureType(fallback: CompatFallback): string {
  return `stub-future-${fallback}`;
}

/** A future event's `compat`: the level above this one, the fallback, and a notice for `fail` and
 *  `update`. */
function futureCompat(fallback: CompatFallback): Compat {
  const notice = fallback === 'skip' ? {} : { notice: FUTURE_NOTICES[fallback] };
  return { min: PROTOCOL_LEVEL + 1, fallback, ...notice };
}

/** The production registry plus the stub's future event types, one level above this one, so the
 *  stub server's generate route adapts them for the app like any later event (beta-1 D16 layer 2).
 *  `createApp` uses it under `stub`. */
export const STUB_WIRE_REGISTRY: WireRegistry = Object.freeze({
  events: {
    ...WIRE_REGISTRY.events,
    ...Object.fromEntries(
      FUTURE_MARKERS.map(([, fallback]): [string, WireEntry<WireEvent>] => [futureType(fallback), { level: PROTOCOL_LEVEL + 1, compat: futureCompat(fallback) }]),
    ),
  },
  errors: WIRE_REGISTRY.errors,
});

/** The event a `[[future:*]]` marker makes the stub pipeline emit: a type from the protocol level
 *  above this one, as a later pipeline would emit it, before the route adapts it. */
export function stubFutureEvent(fallback: CompatFallback): WireEvent {
  return { type: futureType(fallback) };
}

/**
 * The same event as the server sends it to an app that predates it (`wire-level.ts#eventForLevel`
 * — only its envelope): `compat` with that fallback, and a notice for `fail` and `update`.
 */
export function stubFutureFrame(fallback: CompatFallback): WireEvent {
  return eventForLevel(stubFutureEvent(fallback), PROTOCOL_LEVEL, STUB_WIRE_REGISTRY);
}
