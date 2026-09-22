/**
 * The synthrun suites' test harness: `test(name, fn)` records a thrown test, and
 * `recordAssertion` records a node:assert failure instead of throwing (CLAUDE.md "Test
 * assertions"), so one run reports every failure.
 */

import nodeAssert from 'node:assert';

export const results = { passed: 0, failures: [] as string[] };

/** Runs one node:assert call and records its outcome. Each suite file wraps it in its own `ok`,
 *  which calls node:assert directly, so the assertion is visible where the test is written. */
export function recordAssertion(assertion: () => void, msg: string): void {
  try {
    assertion();
    results.passed++;
  } catch (err) {
    if (!(err instanceof nodeAssert.AssertionError)) throw err;
    results.failures.push(msg);
    console.error('  ✗ ' + msg);
  }
}

export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('• ' + name);
  } catch (err) {
    results.failures.push(`${name}: threw ${(err as Error).message}`);
    console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
  }
}
