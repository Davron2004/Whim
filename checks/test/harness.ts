/**
 * The greenBy phased-TDD harness (design D9, `handoff/greenby-harness.md`). FROZEN after
 * Chain B: C/D/E add tagged `test()` calls in `acceptance.ts`, they never edit this file —
 * a needed change here is a class-B stop for a later chain.
 *
 * Chain B authors the FULL B–E assertion corpus tests-first; each test is tagged with the
 * chain that must turn it green. `checks/test/.phase` (git-ignored, dispatcher-written into
 * each chain's worktree) says which chains are "due" right now — absent means STRICT (every
 * test due), which is what the merged main tip and CI always see.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CheckReport, Diagnostic, DiagnosticKind } from '../contract';

export type Chain = 'B' | 'C' | 'D' | 'E';
export interface TestOpts {
  greenBy: Chain;
}

const RANK: Record<Chain, number> = { B: 0, C: 1, D: 2, E: 3 };
const VALID_CHAINS: readonly Chain[] = ['B', 'C', 'D', 'E'];

interface TestRecord {
  name: string;
  greenBy: Chain;
  due: boolean;
  passed: boolean;
  error?: Error;
}

const records: TestRecord[] = [];

// The phase is read once per process (the runner is a fresh `node` invocation per suite run,
// so there is no cross-run staleness to worry about) and cached.
let phaseRead = false;
let phase: Chain | undefined;

function currentPhase(): Chain | undefined {
  if (phaseRead) return phase;
  phaseRead = true;
  const phasePath = path.join(process.cwd(), 'checks', 'test', '.phase');
  try {
    const raw = fs.readFileSync(phasePath, 'utf8').trim();
    phase = (VALID_CHAINS as readonly string[]).includes(raw) ? (raw as Chain) : undefined;
  } catch {
    phase = undefined; // absent (or unreadable) ⇒ STRICT, fail-closed
  }
  return phase;
}

function isDue(greenBy: Chain): boolean {
  const p = currentPhase();
  if (p === undefined) return true; // STRICT: everything is due
  return RANK[greenBy] <= RANK[p];
}

/** Tagged form: `test(name, { greenBy }, fn)`. */
export function test(name: string, opts: TestOpts, fn: () => void | Promise<void>): Promise<void>;
/** Legacy/untagged form: `test(name, fn)` ⇒ `greenBy: 'B'` (due immediately). */
export function test(name: string, fn: () => void | Promise<void>): Promise<void>;
export async function test(
  name: string,
  optsOrFn: TestOpts | (() => void | Promise<void>),
  maybeFn?: () => void | Promise<void>,
): Promise<void> {
  const opts: TestOpts = typeof optsOrFn === 'function' ? { greenBy: 'B' } : optsOrFn;
  const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn!;
  const due = isDue(opts.greenBy);
  try {
    await fn();
    records.push({ name, greenBy: opts.greenBy, due, passed: true });
  } catch (err) {
    records.push({
      name,
      greenBy: opts.greenBy,
      due,
      passed: false,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

// ── shared assertion helpers (the storage:test / bridge:test idiom — assertions throw).
// Not part of the phased-TDD scheduling logic above; used by both acceptance.ts and
// hostile/corpus.ts, so they live here rather than being duplicated in each. ─────────────

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
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

/**
 * Print the per-test verdicts + the summary line, and return the process exit code:
 * non-zero IFF at least one DUE test failed. PENDING and XPASS never fail the suite, but
 * XPASS is always surfaced (never swallowed) — a not-yet-due test passing early is the
 * vacuity tripwire the owning chain must resolve before claiming that greenBy.
 */
export function report(): { exitCode: number; pass: number; pending: number; xpass: number; fail: number } {
  let pass = 0;
  let pending = 0;
  let xpass = 0;
  let fail = 0;
  for (const r of records) {
    if (r.due) {
      if (r.passed) {
        pass++;
        console.log(`  ✓ ${r.name}`);
      } else {
        fail++;
        console.error(`  ✗ FAIL (greenBy:${r.greenBy}, due) ${r.name}: ${r.error?.message ?? ''}`);
      }
    } else if (r.passed) {
      xpass++;
      console.log(`  ⚠ XPASS (greenBy:${r.greenBy}, not yet due) ${r.name}`);
    } else {
      pending++;
      console.log(`  … PENDING (greenBy:${r.greenBy}) ${r.name}`);
    }
  }
  console.log('');
  console.log(`PASS ${pass} · PENDING ${pending} · XPASS ${xpass} · FAIL ${fail}`);
  return { exitCode: fail > 0 ? 1 : 0, pass, pending, xpass, fail };
}
