/**
 * Assertion harness for the corpus-eval acceptance suite: no test framework (repo idiom), tallies
 * pass/fail, and `report()` exits non-zero on any failure so `evals/test/run.mjs` gates CI. check
 * and eq delegate to node:assert (CLAUDE.md "Test assertions"); a failed assertion is recorded,
 * not thrown, so one run reports every failure.
 */

import nodeAssert from 'node:assert';
import { inspect } from 'node:util';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function record(name: string, assertion: () => void, detail?: () => string): void {
  try {
    assertion();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    if (!(err instanceof nodeAssert.AssertionError)) throw err;
    failed++;
    const detailText = detail ? ` — ${detail()}` : '';
    const line = `  XX  ${name}${detailText}`;
    failures.push(line);
    console.error(line);
  }
}

export function check(name: string, passedCheck: boolean, detail?: string): void {
  record(name, () => nodeAssert.ok(passedCheck, name), detail === undefined ? undefined : () => detail);
}

/** Deep, strict equality; key order doesn't matter. */
export function eq(name: string, actual: unknown, expected: unknown): void {
  record(name, () => nodeAssert.deepStrictEqual(actual, expected, name), () => `got ${inspect(actual, { depth: 6 })}, expected ${inspect(expected, { depth: 6 })}`);
}

/** Run `fn`, returning the thrown error (or `undefined` if it did not throw) for inspection. */
export async function caught(fn: () => void | Promise<void>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function report(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFAILURES:');
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log('evals:test OK');
}
