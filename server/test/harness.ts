/**
 * Tiny assertion harness for the server/contract acceptance suite. No test framework (repo idiom):
 * checks tally pass/fail; `report()` exits non-zero on any failure so `npm run server:test` gates CI.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

/** Order-independent structural equality — so a zod round-trip whose keys come back in schema order
 *  still equals a literal written in a different key order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort((left, right) => left.localeCompare(right));
    const bk = Object.keys(bo).sort((left, right) => left.localeCompare(right));
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

export function check(name: string, passedCheck: boolean, detail?: string): void {
  if (passedCheck) {
    passed++;
    console.log(`  ok  ${name}`);
    return;
  }

  failed++;
  const detailText = detail ? ` — ${detail}` : '';
  const line = `  XX  ${name}${detailText}`;
  failures.push(line);
  console.error(line);
}

export function eq(name: string, actual: unknown, expected: unknown): void {
  const ok = deepEqual(actual, expected);
  check(
    name,
    ok,
    ok ? undefined : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

/** Run `fn`, returning the thrown error (or `undefined` if it did not throw) for type inspection. */
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
  console.log('server:test OK');
}
