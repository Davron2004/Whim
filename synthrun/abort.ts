/**
 * Abort plumbing shared by the semaphore, the session and the report assembly (public-generation-
 * server design D12, spec §Abort is honoured at every wait in a run). Written against the
 * `aborted` flag and the `abort` event only, the part of `AbortSignal` every runtime this library
 * is typed for declares.
 */

/** The rejection a wait abandoned by its signal settles with. Named like the platform's own. */
export function abortError(): Error {
  const err = new Error('synthrun: the run was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Settles with `work`, unless `signal` aborts first, in which case it rejects with `abortError()`
 * at once. `work` keeps running and its eventual rejection is handled here, so abandoning it never
 * surfaces as an unhandled rejection.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err as Error);
      },
    );
  });
}

export interface LinkedAbort {
  /** Aborts as soon as any source has aborted. */
  signal: AbortSignal;
  /** Removes the listeners this link added to its sources. Idempotent. */
  unlink(): void;
}

/** One signal that aborts when any of `sources` does. Call `unlink()` when the linked work ends,
 *  so a long-lived source does not collect a listener per run. */
export function linkAbort(sources: readonly (AbortSignal | undefined)[]): LinkedAbort {
  const controller = new AbortController();
  const present = sources.filter((s): s is AbortSignal => s !== undefined);
  const unlink = (): void => {
    for (const source of present) source.removeEventListener('abort', onAbort);
  };
  const onAbort = (): void => {
    unlink();
    controller.abort();
  };
  if (present.some((s) => s.aborted)) controller.abort();
  else for (const source of present) source.addEventListener('abort', onAbort);
  return { signal: controller.signal, unlink };
}
