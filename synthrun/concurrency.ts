/**
 * A small counting semaphore (design D4 — "bound concurrent runs with a caller-set
 * semaphore"). No dependency; a session creates one of these by default and a caller may
 * instead supply its own (`contract.ts`'s `Semaphore`) to share a concurrency bound across
 * multiple sessions.
 *
 * Acquisition is abortable (public-generation-server design D12): a waiter whose signal aborts
 * leaves the queue and rejects, never having held a slot. Each grant's release is idempotent, so a
 * second call cannot free a slot someone else now holds.
 */
import { abortError } from './abort';
import type { Semaphore } from './contract';

export function createSemaphore(maxConcurrent: number): Semaphore {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(`createSemaphore: maxConcurrent must be a positive integer (got ${maxConcurrent})`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      const next = queue.shift();
      if (next) {
        active++;
        next();
      }
    };
  }

  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        if (active < maxConcurrent) {
          active++;
          resolve(releaseOnce());
          return;
        }
        const waiter = {
          grant(): void {
            signal?.removeEventListener('abort', waiter.leave);
            resolve(releaseOnce());
          },
          leave(): void {
            queue.splice(queue.indexOf(waiter.grant), 1);
            reject(abortError());
          },
        };
        queue.push(waiter.grant);
        signal?.addEventListener('abort', waiter.leave);
      });
    },
  };
}
