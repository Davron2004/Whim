/** Runs `fn` and returns its result as a promise; a synchronous throw becomes a rejection, as in an async function. */
export function settle<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err as Error);
  }
}
