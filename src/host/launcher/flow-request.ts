/**
 * flow-request — cancellation bookkeeping for the prompt flow's two unary requests, clarify and
 * rewrite (`prompt-flow` spec, "Leaving clarify or rewrite cancels the in-flight request cleanly"
 * / "A response to a request the user has left cannot move the screen").
 *
 * The pattern is the one `LauncherRoot`'s generation already uses (`genRef`): an `AbortController`
 * the leave-handler can reach, a `cancelled` flag it sets alongside `.abort()` — because an abort
 * and an ordinary failure look identical to a caller — and a screen-identity guard on every write
 * that happens after an `await`. The guard is the load-bearing half: aborting alone cannot stop a
 * promise that had already resolved when the user navigated away.
 *
 * Controllers are PER STEP, never one flow-wide controller: backing out of the plan step must not
 * require having aborted the clarify request that step was built from. No React and no I/O here,
 * so both halves are directly Node-testable.
 */

/** The flow steps that own a cancellable unary request: compose runs clarify, plan runs rewrite. */
export type FlowRequestStep = 'compose' | 'plan';

/** One in-flight request. `cancelled` is the caller's own intent, never inferred from the error. */
export interface FlowRequest {
  readonly controller: AbortController;
  cancelled: boolean;
}

/**
 * The per-step registry of in-flight requests. Starting a step's request supersedes (and aborts)
 * any previous request of the SAME step; other steps are untouched.
 */
export class FlowRequests {
  private readonly slots = new Map<FlowRequestStep, FlowRequest>();

  /** Begin a request for `step`, aborting whatever that step still had in flight. */
  start(step: FlowRequestStep): FlowRequest {
    this.abort(step);
    const request: FlowRequest = { controller: new AbortController(), cancelled: false };
    this.slots.set(step, request);
    return request;
  }

  /** The user left `step`: record the intent and cancel the request. A step with nothing in
   *  flight is a no-op, which is what makes calling this from every leave-handler safe. */
  abort(step: FlowRequestStep): void {
    const request = this.slots.get(step);
    if (!request) return;
    request.cancelled = true;
    request.controller.abort();
    this.slots.delete(step);
  }

  /** A settled request releases its slot — but ONLY if it is still the slot's occupant, so a
   *  newer request for the same step is never stranded. */
  release(step: FlowRequestStep, request: FlowRequest): void {
    if (this.slots.get(step) === request) this.slots.delete(step);
  }
}

/**
 * A `setScreen` updater that applies `next` only while `kind` is still the current screen — the
 * discard rule for a response to a request the user has already left. `next` receives the current
 * screen narrowed to that kind; anything else is returned unchanged (same reference, so React
 * sees no state change at all).
 */
export function onlyOnStep<S extends { kind: string }, K extends S['kind']>(
  kind: K,
  next: (current: Extract<S, { kind: K }>) => S,
): (current: S) => S {
  return (current: S) => (current.kind === kind ? next(current as Extract<S, { kind: K }>) : current);
}
