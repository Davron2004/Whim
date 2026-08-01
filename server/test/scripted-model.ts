/**
 * server/test/scripted-model.ts — `ScriptedModelClient`, the deterministic `ModelClient` test
 * double every generation-pipeline suite replays turns through (design D3, spec "the deterministic
 * test suites SHALL run a scripted client that replays recorded turns"). No suite that uses this
 * file makes a live request: pair it with `noNetworkTransport` (below) as the injected `FetchFn` of
 * any real `OpenRouterClient` a test happens to construct, so a stray real call fails loudly
 * instead of hanging or hitting the network.
 */
import type { ModelClient, ModelRequest, ModelRole, ModelRoster, ModelStream } from '../src/generation/model';
import type { FetchFn } from '../src/openrouter';
import type { Usage } from '@whim/contract';

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** One recorded turn: which role it must be requested for, the deltas to replay, and (optionally)
 *  a captured id/usage or a terminal error to raise after the deltas (§"A model failure is an
 *  honest failure" — lets a test simulate the wrapper's typed errors, e.g. `OpenRouterAuthError`,
 *  without ever touching the network). */
export interface ScriptedTurn {
  role: ModelRole;
  deltas: string[];
  usage?: Usage;
  id?: string;
  /** Thrown from the deltas iterator after replaying `deltas`, and used to reject `usage` — mirrors
   *  `OpenRouterClient.stream`'s own contract (a throw path always rejects the usage promise). */
  error?: unknown;
}

/** A request `ScriptedModelClient` received, tagged with the role it resolved to. */
export interface CapturedRequest {
  role: ModelRole;
  request: ModelRequest;
}

/** Thrown when more turns are requested than were scripted — a test that drives more model calls
 *  than it recorded is a bug in the test, not a silently-reused last turn. */
export class ScriptedModelClientExhaustedError extends Error {
  constructor(index: number, scripted: number) {
    super(`ScriptedModelClient: turn ${index} requested but only ${scripted} turn(s) are scripted.`);
    this.name = 'ScriptedModelClientExhaustedError';
  }
}

/** Thrown when a turn is requested for a different role than the script expects — catches a test
 *  (or a pipeline bug) that calls the wrong model instead of silently consuming the wrong fixture. */
export class ScriptedModelClientRoleMismatchError extends Error {
  constructor(index: number, expected: ModelRole, expectedModel: string, gotModel: string) {
    super(
      `ScriptedModelClient turn ${index}: expected a "${expected}" request (model "${expectedModel}"), ` +
        `got model "${gotModel}".`,
    );
    this.name = 'ScriptedModelClientRoleMismatchError';
  }
}

function roleOf(roster: ModelRoster, model: string): ModelRole | undefined {
  if (model === roster.engineer) return 'engineer';
  if (model === roster.rewrite) return 'rewrite';
  return undefined;
}

function scriptedStream(turn: ScriptedTurn): ModelStream {
  let resolveUsage!: (usage: Usage) => void;
  let rejectUsage!: (err: unknown) => void;
  const usage = new Promise<Usage>((res, rej) => {
    resolveUsage = res;
    rejectUsage = rej;
  });
  const id = Promise.resolve(turn.id);

  async function* makeDeltas(): AsyncIterable<string> {
    for (const delta of turn.deltas) yield delta;
    if (turn.error !== undefined) {
      rejectUsage(turn.error);
      throw turn.error;
    }
    resolveUsage(turn.usage ?? ZERO_USAGE);
  }

  return { deltas: makeDeltas(), usage, id };
}

/**
 * Replays `turns` in order. Each `stream()` call consumes the next scripted turn, asserts it was
 * requested for the role the script expects (by comparing `req.model` against `roster`), and
 * records the request so a test can assert on exactly what the pipeline sent.
 */
export class ScriptedModelClient implements ModelClient {
  private cursor = 0;
  private readonly received: CapturedRequest[] = [];

  constructor(
    private readonly roster: ModelRoster,
    private readonly turns: readonly ScriptedTurn[],
  ) {}

  /** Every request received so far, in order. */
  get requests(): readonly CapturedRequest[] {
    return this.received;
  }

  stream(req: ModelRequest): ModelStream {
    const index = this.cursor;
    const turn = this.turns[index];
    if (!turn) throw new ScriptedModelClientExhaustedError(index, this.turns.length);

    const actualRole = roleOf(this.roster, req.model);
    if (actualRole !== turn.role) {
      throw new ScriptedModelClientRoleMismatchError(index, turn.role, this.roster[turn.role], req.model);
    }

    this.cursor += 1;
    this.received.push({ role: turn.role, request: req });
    return scriptedStream(turn);
  }
}

/**
 * A `FetchFn` that throws on any request to the provider host — installed as the transport of any
 * real `OpenRouterClient` a deterministic suite constructs, so a stray live call fails loudly (and
 * synchronously, before touching the network) instead of hanging or leaking a request.
 */
export const noNetworkTransport: FetchFn = async (input: Parameters<FetchFn>[0]) => {
  throw new Error(
    `noNetworkTransport: refused to fetch "${String(input)}" — the deterministic suite must never reach ` +
      `the network. Use ScriptedModelClient instead of a live model call.`,
  );
};
