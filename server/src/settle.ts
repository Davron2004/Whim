/** Runs `fn` and returns its result as a promise; a synchronous throw becomes a rejection, as in an async function. */
export function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => resolve(fn()));
}
