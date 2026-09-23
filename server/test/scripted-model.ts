/**
 * server/test/scripted-model.ts — `ScriptedModelClient`, the deterministic `ModelClient` test
 * double every generation-pipeline suite replays turns through (design D3, spec "the deterministic
 * test suites SHALL run a scripted client that replays recorded turns"). No suite that uses this
 * file makes a live request.
 */
import type { ModelCallLabel, ModelClient, ModelDelta, ModelRequest, ModelRole, ModelRoster, ModelStream } from '../src/generation/model';
import type { Usage } from '@whim/contract';

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Maps a request's attribution label (`ModelRequest.role`, design D4) onto the roster role it
 *  must have been resolved from: `generate`/`repair` both read the `engineer` role, and `policy`
 *  reads the `rewrite` role's model (spec content-policy "adds no new model role or model id"). */
const ROSTER_ROLE_OF: Record<ModelCallLabel, ModelRole> = {
  policy: 'rewrite',
  clarify: 'clarify',
  rewrite: 'rewrite',
  summary: 'summary',
  plan: 'plan',
  generate: 'engineer',
  repair: 'engineer',
};

/** One recorded turn: which roster role it must be requested for (see `ROSTER_ROLE_OF` — a
 *  request's own `role` label is mapped onto this), the deltas to replay, and (optionally) a
 *  captured id/usage or a terminal error to raise after the deltas (§"A model failure is an honest
 *  failure" — lets a test simulate the wrapper's typed errors, e.g. `OpenRouterAuthError`, without
 *  ever touching the network).
 *
 *  `deltas` keeps the ergonomics of a plain string list even though a real turn's deltas are
 *  `ModelDelta`s: a bare `string` element replays as a text delta (`{ kind: 'text', text }`), and
 *  `{ reasoning: string }` replays as a reasoning delta (`{ kind: 'reasoning', text: reasoning }`)
 *  — a test scripts a reasoning-carrying turn as e.g. `[{ reasoning: 'thinking...' }, 'the reply']`
 *  rather than constructing `ModelDelta` objects by hand. */
export interface ScriptedTurn {
  role: ModelRole;
  deltas: Array<string | { reasoning: string }>;
  usage?: Usage;
  id?: string;
  /** Thrown from the deltas iterator after replaying `deltas`, and used to reject `usage` — mirrors
   *  `OpenRouterClient.stream`'s own contract (a throw path always rejects the usage promise). */
  error?: unknown;
}

/** A request `ScriptedModelClient` received, tagged with the roster role it resolved to. */
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

/** Thrown when a turn is requested for a different role or a different model than the script
 *  expects — catches a test (or a pipeline bug) that calls the wrong model, or labels a call with
 *  the wrong `ModelRequest.role`, instead of silently consuming the wrong fixture. */
export class ScriptedModelClientRoleMismatchError extends Error {
  constructor(index: number, expectedRole: ModelRole, expectedModel: string, gotLabel: ModelCallLabel, gotModel: string) {
    super(
      `ScriptedModelClient turn ${index}: expected a "${expectedRole}"-roster request (model "${expectedModel}"), ` +
        `got role "${gotLabel}" with model "${gotModel}".`,
    );
    this.name = 'ScriptedModelClientRoleMismatchError';
  }
}

function scriptedStream(turn: ScriptedTurn): ModelStream {
  let resolveUsage!: (usage: Usage) => void;
  let rejectUsage!: (err: unknown) => void;
  const usage = new Promise<Usage>((res, rej) => {
    resolveUsage = res;
    rejectUsage = rej;
  });
  const id = Promise.resolve(turn.id);

  async function* makeDeltas(): AsyncIterable<ModelDelta> {
    for (const delta of turn.deltas) {
      yield typeof delta === 'string' ? { kind: 'text', text: delta } : { kind: 'reasoning', text: delta.reasoning };
    }
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
 * requested for the roster role the script expects (`req.role` mapped through `ROSTER_ROLE_OF`,
 * cross-checked against `req.model`), and records the request so a test can assert on exactly what
 * the pipeline sent.
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

    const expected = this.roster[turn.role];
    if (ROSTER_ROLE_OF[req.role] !== turn.role || req.model !== expected.model) {
      throw new ScriptedModelClientRoleMismatchError(index, turn.role, expected.model, req.role, req.model);
    }

    this.cursor += 1;
    this.received.push({ role: turn.role, request: req });
    return scriptedStream(turn);
  }
}
