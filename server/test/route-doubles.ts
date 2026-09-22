/**
 * server/test/route-doubles.ts — test doubles and bounded-wait helpers shared by every suite that
 * drives a route through the real app: `routes-generate.suite.ts` and `disconnect.suite.ts` both
 * used to keep their own copies (one file doubling as another's helper library). Nothing here
 * asserts anything; it only builds fixtures and waits.
 */
import {
  InMemoryUsageStore,
  type AdmitParams,
  type AdmitResult,
  type CostState,
  type CostSweepCandidate,
  type CostSweepQuery,
  type RequestOutcome,
  type SummaryParams,
  type UsageStore,
  type UsageSummary,
} from '../src/usage-store';
import { GenerationMachine, type Clock, type RunTrace } from '../src/generation/machine';
import type { Pipeline } from '../src/pipeline';
import type { ModelClient, ModelDelta, ModelRequest, ModelRoster, ModelStream } from '../src/generation/model';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import type { GenerateRequest, Usage } from '@whim/contract';

const WAIT_MS = 5000;

// ─── Bounded waits ───────────────────────────────────────────────────────────

export const TIMED_OUT = Symbol('timed out');

/** Races `promise` against a ref'd timer, so a promise that never settles ends as `TIMED_OUT`
 *  instead of letting the process exit with the suite half-run. */
export function within<T>(promise: Promise<T>, ms: number = WAIT_MS): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Polls `predicate` until it holds or `ms` elapses; returns whether it held. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, ms: number = WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ─── Doubles ─────────────────────────────────────────────────────────────────

export interface SettleRecord {
  requestId: string;
  outcome: RequestOutcome;
  usage?: Usage;
}

export interface CostRecord {
  requestId: string;
  state: CostState;
  costUsd?: number;
}

/** The in-memory store, delegating method by method (never a spread of a class instance), with
 *  every ledger write recorded so a test can read outcomes and costs the store keeps private. */
export class RecordingUsageStore implements UsageStore {
  readonly admitted: string[] = [];
  readonly settles: SettleRecord[] = [];
  readonly costs: CostRecord[] = [];
  constructor(private readonly inner: UsageStore = new InMemoryUsageStore()) {}

  /** Set by a test to make the next `credit` fail — a store blip inside admission, after the slot
   *  was taken and the daily unit consumed. */
  creditFailure: Error | undefined;

  credit(deviceId: string, usage: Usage): Promise<void> {
    if (this.creditFailure) return Promise.reject(this.creditFailure);
    return this.inner.credit(deviceId, usage);
  }

  read(deviceId: string): Promise<Usage> {
    return this.inner.read(deviceId);
  }

  async admit(params: AdmitParams): Promise<AdmitResult> {
    const result = await this.inner.admit(params);
    if (result.ok) this.admitted.push(result.requestId);
    return result;
  }

  refund(requestId: string): Promise<void> {
    return this.inner.refund(requestId);
  }

  settle(requestId: string, params: { outcome: RequestOutcome; usage?: Usage }): Promise<void> {
    this.settles.push({ requestId, ...params });
    return this.inner.settle(requestId, params);
  }

  recordCost(requestId: string, params: { state: CostState; costUsd?: number }): Promise<void> {
    this.costs.push({ requestId, ...params });
    return this.inner.recordCost(requestId, params);
  }

  listUnresolvedCostRows(query: CostSweepQuery): Promise<CostSweepCandidate[]> {
    return this.inner.listUnresolvedCostRows(query);
  }

  summary(params: SummaryParams): Promise<UsageSummary> {
    return this.inner.summary(params);
  }

  purgeLedger(beforeUtcDay: string): Promise<number> {
    return this.inner.purgeLedger(beforeUtcDay);
  }

  /** Non-refunded generation units on `now`'s UTC day, across every device. */
  async generationUnits(now: number): Promise<number> {
    const summary = await this.inner.summary({ days: 1, now });
    return summary.days[0]?.countByKind.generate ?? 0;
  }

  /** The COST VERDICT recorded for a request — the resolver's first `recordCost` call registers
   *  the generation ids while the row is still `pending` (so a sweep can retry after a crash), and
   *  that registration is not a verdict. */
  costFor(requestId: string | undefined): CostRecord | undefined {
    return this.costs.filter((c) => c.requestId === requestId && c.state !== 'pending').at(-1);
  }

  settlesFor(requestId: string | undefined): SettleRecord[] {
    return this.settles.filter((s) => s.requestId === requestId);
  }
}

export const STALL = 'stall';

export interface ModelCallRecord {
  aborted: boolean;
}

/** A stream that emits one reasoning delta and then blocks until `signal` aborts, as a live
 *  provider stream mid-generation does; `usage` and the next delta then reject. */
function stalledStream(signal: AbortSignal | undefined, call: ModelCallRecord, id: string): ModelStream {
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      call.aborted = true;
      reject(new Error('model stream aborted'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  let sentFirst = false;
  const deltas: AsyncIterable<ModelDelta> = {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<ModelDelta>> => {
        if (sentFirst) return aborted;
        sentFirst = true;
        return Promise.resolve({ done: false, value: { kind: 'reasoning', text: 'thinking' } });
      },
    }),
  };
  return { deltas, usage: aborted, id: Promise.resolve(id) };
}

function replyStream(text: string, id: string): ModelStream {
  async function* deltas(): AsyncIterable<ModelDelta> {
    yield { kind: 'text', text };
  }
  return { deltas: deltas(), usage: Promise.resolve({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }), id: Promise.resolve(id) };
}

/** A `ModelClient` following `plan` call by call: `STALL` blocks until aborted, any other string is
 *  replied at once. Every call's generation id (`<idPrefix>-<n>`) resolves immediately, as
 *  OpenRouter's first frame does, and every call records whether its signal aborted. */
export class ControlledModelClient implements ModelClient {
  readonly calls: ModelCallRecord[] = [];

  constructor(
    private readonly plan: readonly string[],
    private readonly idPrefix: string,
  ) {}

  stream(_req: ModelRequest, signal?: AbortSignal): ModelStream {
    const index = this.calls.length;
    const step = this.plan[index];
    if (step === undefined) throw new Error(`ControlledModelClient: call ${index + 1} was not planned`);
    const call: ModelCallRecord = { aborted: false };
    this.calls.push(call);
    const id = `${this.idPrefix}-${index + 1}`;
    return step === STALL ? stalledStream(signal, call, id) : replyStream(step, id);
  }
}

const FAKE_INPUTS: PromptInputs = { sdkReference: 'fake sdk reference', fewShotExamples: [] };

const unreachableStage = (): never => {
  throw new Error('a route test reached a pipeline stage past the model call');
};

/** The real `GenerationMachine` behind the route, with stages past the first model call made
 *  unreachable: the endings under test all happen during the plan call. */
export function machinePipeline(model: ModelClient, clock: Clock, roster: ModelRoster): Pipeline {
  const machine = new GenerationMachine({
    model,
    roster,
    promptInputs: FAKE_INPUTS,
    check: { check: unreachableStage },
    build: { build: unreachableStage },
    run: { run: unreachableStage },
    clock,
  });
  return { run: (request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace) => machine.run(request, signal, trace) };
}
