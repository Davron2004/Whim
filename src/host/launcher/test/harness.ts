/**
 * Shared test harness for the launcher Node suites: ok/eq/test, a running pass count, and a
 * failure list the runner reports and exits non-zero on. ok and eq delegate to node:assert
 * (CLAUDE.md "Test assertions"); a failed assertion is recorded, not thrown, so one run reports
 * every failure.
 */

import nodeAssert from 'node:assert';
import { inspect, isDeepStrictEqual } from 'node:util';

/** The most characters of a value one failure message shows: a value that reaches a rendered tree
 *  prints every fiber's debug stack. */
const SHOWN_CHARS = 4000;

function show(value: unknown): string {
  const text = inspect(value, { depth: 6, breakLength: Infinity });
  return text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)} … (${text.length - SHOWN_CHARS} more characters)` : text;
}

export class Harness {
  passed = 0;
  failures: string[] = [];

  ok(passedCheck: boolean, msg: string): void {
    this.record(() => nodeAssert.ok(passedCheck, msg), msg);
  }

  /** Deep, strict equality: key order doesn't matter, but an extra key holding `undefined` does.
   *  Compared apart from the assertion: a failed `deepStrictEqual` inspects `a` all the way down to
   *  build its diff, which for a value reaching a rendered tree runs the machine out of memory. */
  eq(a: unknown, b: unknown, msg: string): void {
    this.record(() => nodeAssert.ok(isDeepStrictEqual(a, b), msg), `${msg} (got ${show(a)}, want ${show(b)})`);
  }

  private record(assertion: () => void, failure: string): void {
    try {
      assertion();
      this.passed++;
    } catch (err) {
      if (!(err instanceof nodeAssert.AssertionError)) throw err;
      this.failures.push(failure);
      console.error('  ✗ ' + failure);
    }
  }

  async test(name: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
      console.log('• ' + name);
    } catch (err) {
      this.failures.push(`${name}: threw ${(err as Error).message}`);
      console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
    }
  }

  /** Assert that calling `fn` throws (optionally matching a substring of the message). */
  async throws(fn: () => unknown, match: string, msg: string): Promise<void> {
    try {
      await fn();
      this.ok(false, `${msg} (expected throw matching "${match}", got none)`);
    } catch (err) {
      const m = (err as Error).message || String(err);
      this.ok(m.includes(match), `${msg} (threw "${m}", expected to include "${match}")`);
    }
  }
}
