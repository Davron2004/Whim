/**
 * The static-checks test harness: `test(name, fn)` records a pass or a failure, and `report()`
 * prints every verdict and returns a non-zero exit code if any test failed.
 */

import nodeAssert from 'node:assert';
import { CheckReport, Diagnostic, DiagnosticKind } from '../contract';

interface TestRecord {
  name: string;
  error?: Error;
}

const records: TestRecord[] = [];

export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    records.push({ name });
  } catch (err) {
    records.push({ name, error: err instanceof Error ? err : new Error(String(err)) });
  }
}

// ── shared assertion helpers (assertions throw), used by acceptance.ts, hostile/corpus.ts and
// the release suites. ─────────────

export function assert(cond: boolean, msg: string): void {
  nodeAssert.ok(cond, msg);
}

export function kindsOf(r: CheckReport): DiagnosticKind[] {
  return r.diagnostics.map((d) => d.kind);
}

export function findByKind(r: CheckReport, kind: DiagnosticKind): Diagnostic[] {
  return r.diagnostics.filter((d) => d.kind === kind);
}

export function assertHasKind(r: CheckReport, kind: DiagnosticKind, msg?: string): Diagnostic {
  const hits = findByKind(r, kind);
  assert(hits.length > 0, msg ?? `expected a "${kind}" diagnostic; got kinds [${kindsOf(r).join(', ')}]`);
  return hits[0];
}

export function assertNoKind(r: CheckReport, kind: DiagnosticKind, msg?: string): void {
  assert(findByKind(r, kind).length === 0, msg ?? `expected no "${kind}" diagnostic; got ${findByKind(r, kind).length}`);
}

/** Print the per-test verdicts and the summary line; the exit code is non-zero if any test failed. */
export function report(): { exitCode: number; pass: number; fail: number } {
  let fail = 0;
  for (const r of records) {
    if (r.error === undefined) {
      console.log(`  ✓ ${r.name}`);
    } else {
      fail++;
      console.error(`  ✗ FAIL ${r.name}: ${r.error.message}`);
    }
  }
  const pass = records.length - fail;
  console.log('');
  console.log(`PASS ${pass} · FAIL ${fail}`);
  return { exitCode: fail > 0 ? 1 : 0, pass, fail };
}
