/**
 * The one classifier for a failed model call (generation-reliability D5). A leaf module with no
 * imports: `openrouter.ts` logs its verdict, `generation/model.ts` re-exports it as
 * `isUpstreamModelFailure`, and the machine and the unary routes decide on it, so none of them
 * can disagree about whether the provider was at fault.
 *
 * Structural, like `isCreditExhaustedError`: an adapter signals a failure with `kind` and `status`
 * fields, as `openrouter.ts`'s typed errors do. Never reads a message, so no content can leak
 * into a log field that carries the result.
 */

/** Why a model call failed, as a closed vocabulary safe to log and to count. `server`,
 *  `rate_limit`, `network` and `timeout` are the provider's side (`upstream`). */
export type ModelErrorKind =
  | 'server'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'credit'
  | 'client'
  | 'cancelled'
  | 'other';

export interface ModelFailure {
  errorKind: ModelErrorKind;
  /** The provider's HTTP(-equivalent) status when the error carried one. */
  status?: number;
  /** True exactly for `server`, `rate_limit`, `network` and `timeout`: the provider or the way to
   *  it failed, not the request or the caller. */
  upstream: boolean;
}

const UPSTREAM_KINDS: ReadonlySet<ModelErrorKind> = new Set<ModelErrorKind>(['server', 'rate_limit', 'network', 'timeout']);

function failure(errorKind: ModelErrorKind, status?: number): ModelFailure {
  return { errorKind, ...(status !== undefined ? { status } : {}), upstream: UPSTREAM_KINDS.has(errorKind) };
}

/** An abort reads as the call's own timeout when its reason is a `TimeoutError` (what
 *  `AbortSignal.timeout` and a combined signal built from one carry), else as a cancellation: a
 *  client disconnect, the run-wide deadline and the summary timeout abort with no such reason. */
function abortKind(signal: AbortSignal): ModelErrorKind {
  const { reason } = signal as { reason?: unknown };
  const name = typeof reason === 'object' && reason !== null ? (reason as { name?: unknown }).name : undefined;
  return name === 'TimeoutError' ? 'timeout' : 'cancelled';
}

/** Classify why a model call failed. `signal` is the signal the call ran under: it is checked
 *  first, because an abort surfaces from the provider client as a status-less network error that
 *  the typed error alone would call upstream. */
export function modelFailureOf(err: unknown, signal?: AbortSignal): ModelFailure {
  if (signal?.aborted) return failure(abortKind(signal));
  if (typeof err !== 'object' || err === null) return failure('other');
  const { kind, status } = err as { kind?: unknown; status?: unknown };
  const code = typeof status === 'number' ? status : undefined;
  if (code !== undefined && code >= 500) return failure('server', code);
  if (kind === 'rate_limit') return failure('rate_limit', code);
  if (kind === 'network' && code === undefined) return failure('network');
  if (kind === 'auth' || code === 401) return failure('auth', code);
  if (kind === 'credit' || code === 402) return failure('credit', code);
  if (code !== undefined && code >= 400 && code < 500) return failure('client', code);
  return failure('other', code);
}
