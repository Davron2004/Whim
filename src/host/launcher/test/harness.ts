/**
 * Tiny shared test harness for the launcher Node suites (back-policy, app-index, store-access).
 * Mirrors the version-store / storage-engine acceptance idiom: ok/eq/test, a running pass
 * count, and a failure list the runner reports + exits non-zero on.
 */

export class Harness {
  passed = 0;
  failures: string[] = [];

  ok(passedCheck: boolean, msg: string): void {
    if (passedCheck) {
      this.passed++;
    } else {
      this.failures.push(msg);
      console.error('  ✗ ' + msg);
    }
  }

  eq(a: unknown, b: unknown, msg: string): void {
    this.ok(
      JSON.stringify(a) === JSON.stringify(b),
      `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    );
  }

  async test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      console.log('• ' + name);
    } catch (err) {
      this.failures.push(`${name}: threw ${(err as Error).message}`);
      console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
    }
  }

  /** Assert that calling `fn` throws (optionally matching a substring of the message). */
  async throws(fn: () => void | Promise<void>, match: string, msg: string): Promise<void> {
    try {
      await fn();
      this.ok(false, `${msg} (expected throw matching "${match}", got none)`);
    } catch (err) {
      const m = (err as Error).message || String(err);
      this.ok(m.includes(match), `${msg} (threw "${m}", expected to include "${match}")`);
    }
  }
}
