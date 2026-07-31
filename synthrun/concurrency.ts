/**
 * A small counting semaphore (design D4 — "bound concurrent runs with a caller-set
 * semaphore"). No dependency; a session creates one of these by default and a caller may
 * instead supply its own (`contract.ts`'s `Semaphore`) to share a concurrency bound across
 * multiple sessions.
 */
import type { Semaphore } from './contract';

export function createSemaphore(maxConcurrent: number): Semaphore {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(`createSemaphore: maxConcurrent must be a positive integer (got ${maxConcurrent})`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function release(): void {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  }

  return {
    acquire(): Promise<() => void> {
      return new Promise((resolve) => {
        const grant = () => resolve(release);
        if (active < maxConcurrent) {
          active++;
          grant();
        } else {
          queue.push(grant);
        }
      });
    },
  };
}
