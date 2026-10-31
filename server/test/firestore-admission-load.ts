/**
 * The Firestore admission load test (#143; specs/server-deployment "Firestore admission contention
 * is load-tested without touching production"; design D7). Test code: bundled only by
 * `server/test/firestore-admission.run.mjs`, which `deploy/loadtest/firestore-admission.sh` runs,
 * and imported by the small-burst case in `firestore-conformance.ts`. Never part of the server.
 *
 * A burst fires N concurrent `FirestoreUsageStore.admit` calls at one fresh set of counters, all
 * under one global daily limit, so the global counter document is the one every transaction
 * contends on. Each burst reports admit latency, the transaction attempts each admission took, the
 * transactions that exhausted their retries, and whether exactly the limit was admitted.
 *
 * The store runs on a proxy of the client whose `runTransaction` counts the attempts and charges
 * every read and write an attempt sends to an `OperationBudget` before it goes out: past the budget's
 * cap the attempt throws and the transaction ends without committing, so a capped run can never send
 * more operations than its cap. No product seam is involved.
 *
 * Two targets: the Firestore emulator (`FIRESTORE_EMULATOR_HOST` set, no `--database`), and a
 * throwaway real database named `whim-loadtest-<suffix>` with an explicit `--max-ops`, which the
 * shell entry creates before and deletes after. The production database is refused here as well as
 * in the shell, before any client exists.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import { openFirestoreClient } from '../src/firestore/client';
import { FirestoreUsageStore } from '../src/firestore/usage-store';
import type { AdmitParams, AdmitResult, RequestKind } from '../src/usage-store';

/** Every real database this tool may open starts with this. */
export const THROWAWAY_DATABASE_PREFIX = 'whim-loadtest-';
/** The product owner's hard cap on operations per real-database run (proposal ruling 1). */
export const OPERATION_CEILING = 50_000;
/** The price the cost estimate charges every operation at: Firestore's highest standard per-operation
 *  price, a multi-region write ($0.18 per 100,000), so the estimate is an upper bound. */
export const USD_PER_100K_OPERATIONS = 0.18;
/** The collection each burst's namespace document sits in. */
export const LOADTEST_COLLECTION = 'loadtest';

const DEFAULT_BURSTS: readonly number[] = [10, 25, 50, 100];
const MAX_BURST = 1000;
/** The Firestore error code a transaction rejects with once its attempts are spent (ABORTED). */
const ABORTED = 10;
/** `/v1/clarify` and `/v1/rewrite` share one daily ceiling, as in `routes/clarify.ts`. */
const UNARY_KINDS: readonly RequestKind[] = ['clarify', 'rewrite'];
/** How long opening a client may take: the emulator answers in milliseconds idle, but a busy machine
 *  stretches it (see `firestore-conformance.ts`). Only bounds a hang. */
const PROBE_TIMEOUT_MS = 120_000;
/** The operations the client's open sends: one `listCollections` probe. */
const PROBE_OPERATIONS = 1;

export type LoadProfile = 'generate' | 'unary';

export class OperationCapReached extends Error {
  constructor(cap: number) {
    super(`the operation cap of ${cap} is reached; no further Firestore operation is sent`);
    this.name = 'OperationCapReached';
  }
}

/** Counts operations and refuses any that would take the count past `cap`. */
export class OperationBudget {
  private spent = 0;

  constructor(readonly cap: number = Number.POSITIVE_INFINITY) {}

  /** Records `count` operations about to be sent, or throws `OperationCapReached` without recording
   *  any when they would exceed the cap. */
  charge(count: number): void {
    if (this.spent + count > this.cap) throw new OperationCapReached(this.cap);
    this.spent += count;
  }

  used(): number {
    return this.spent;
  }
}

/** Transaction methods that send reads, with how many each call reads. */
const READS: Readonly<Record<string, (args: readonly unknown[]) => number>> = {
  get: () => 1,
  getAll: (args) => args.length,
};
/** Transaction methods that each buffer one write, sent with the commit. */
const WRITES = new Set(['create', 'set', 'update', 'delete']);

function chargedTransaction(tx: Transaction, budget: OperationBudget): Transaction {
  return new Proxy(tx, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      const name = String(property);
      const reads = READS[name];
      if (reads === undefined && !WRITES.has(name)) return method.bind(target);
      return (...args: unknown[]): unknown => {
        budget.charge(reads === undefined ? 1 : reads(args));
        return method.apply(target, args);
      };
    },
  });
}

export interface CountingClient {
  /** The client to build the store under test on: every transaction is counted and charged. */
  readonly db: Firestore;
  /** The attempts of each transaction that has settled, in settling order. */
  attempts(): readonly number[];
}

/** A proxy of `db` whose `runTransaction` counts each transaction's attempts and charges every read
 *  and write of every attempt to `budget`. Every other member is the original client's. */
export function countingTransactions(db: Firestore, budget: OperationBudget): CountingClient {
  const settled: number[] = [];
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === 'runTransaction') {
        return async <T>(update: (tx: Transaction) => Promise<T>, options?: Parameters<Firestore['runTransaction']>[1]): Promise<T> => {
          let attempts = 0;
          try {
            return await target.runTransaction((tx) => {
              attempts++;
              return update(chargedTransaction(tx, budget));
            }, options);
          } finally {
            settled.push(attempts);
          }
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: counting, attempts: () => settled };
}

export interface BurstOptions {
  readonly profile: LoadProfile;
  /** Concurrent admissions. */
  readonly burst: number;
  /** The global daily limit they race for. */
  readonly limit: number;
  /** The burst's own document under `loadtest/`, so its counters start at zero. */
  readonly namespace: string;
  readonly budget?: OperationBudget;
  /** The admissions' clock reading. Defaults to now. */
  readonly now?: number;
}

export interface BurstReport {
  readonly profile: LoadProfile;
  readonly burst: number;
  readonly limit: number;
  /** `min(burst, limit)`: what a correct store admits. */
  readonly expectedAdmitted: number;
  readonly admitted: number;
  /** Refused at a limit. */
  readonly refused: number;
  /** Transactions that spent every attempt (`ADMISSION_MAX_ATTEMPTS`) without committing. */
  readonly exhausted: number;
  /** Admissions stopped by the operation cap. */
  readonly capped: number;
  /** Admissions that failed any other way. */
  readonly errors: number;
  /** One message per distinct other failure. */
  readonly errorMessages: readonly string[];
  readonly latencyMs: { readonly p50: number; readonly p99: number; readonly max: number };
  /** Transactions per attempt count (`"1"`: committed on its first attempt), plus the largest. */
  readonly attempts: { readonly histogram: Readonly<Record<string, number>>; readonly max: number };
  /** Reads and writes this burst sent (charged to the budget). */
  readonly operations: number;
}

type AdmitOutcome = 'admitted' | 'refused' | 'exhausted' | 'capped' | 'error';

function outcomeOfError(err: unknown): AdmitOutcome {
  if (err instanceof OperationCapReached) return 'capped';
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === ABORTED) return 'exhausted';
  return 'error';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Nearest-rank percentile of `sorted` (ascending); 0 when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]!;
}

function admitParams(options: BurstOptions, n: number, now: number): AdmitParams {
  const common = { requestId: randomUUID(), deviceId: randomUUID(), now, deviceLimit: 1, globalLimit: options.limit };
  if (options.profile === 'generate') return { ...common, kind: 'generate' };
  return { ...common, kind: UNARY_KINDS[n % UNARY_KINDS.length]!, globalKinds: UNARY_KINDS };
}

/** Fires one burst of concurrent admissions at fresh counters, each from its own device, and reports. */
export async function runAdmissionBurst(db: Firestore, options: BurstOptions): Promise<BurstReport> {
  const budget = options.budget ?? new OperationBudget();
  const before = budget.used();
  const client = countingTransactions(db, budget);
  const store = new FirestoreUsageStore(client.db, db.collection(LOADTEST_COLLECTION).doc(options.namespace));
  const now = options.now ?? Date.now();
  const results = await Promise.all(
    Array.from({ length: options.burst }, async (_, n) => {
      const started = performance.now();
      const outcome = await store.admit(admitParams(options, n, now)).then(
        (result: AdmitResult): { outcome: AdmitOutcome; message?: string } => ({ outcome: result.ok ? 'admitted' : 'refused' }),
        (err: unknown) => ({ outcome: outcomeOfError(err), message: messageOf(err) }),
      );
      return { ...outcome, ms: performance.now() - started };
    }),
  );
  const count = (outcome: AdmitOutcome): number => results.filter((r) => r.outcome === outcome).length;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const histogram: Record<string, number> = {};
  for (const attempts of client.attempts()) histogram[String(attempts)] = (histogram[String(attempts)] ?? 0) + 1;
  const round = (ms: number): number => Math.round(ms * 10) / 10;
  return {
    profile: options.profile,
    burst: options.burst,
    limit: options.limit,
    expectedAdmitted: Math.min(options.burst, options.limit),
    admitted: count('admitted'),
    refused: count('refused'),
    exhausted: count('exhausted'),
    capped: count('capped'),
    errors: count('error'),
    errorMessages: [...new Set(results.filter((r) => r.outcome === 'error').map((r) => r.message ?? ''))],
    latencyMs: { p50: round(percentile(latencies, 50)), p99: round(percentile(latencies, 99)), max: round(latencies.at(-1) ?? 0) },
    attempts: { histogram, max: Math.max(0, ...client.attempts()) },
    operations: budget.used() - before,
  };
}

/** What is wrong with a burst: over- or under-admission, exhausted retries, the cap, other errors. */
export function burstProblems(report: BurstReport): string[] {
  const label = `${report.profile} burst of ${report.burst} (limit ${report.limit})`;
  const problems: string[] = [];
  if (report.admitted > report.expectedAdmitted) problems.push(`${label}: over-admitted ${report.admitted}`);
  if (report.admitted < report.expectedAdmitted) problems.push(`${label}: admitted only ${report.admitted} of ${report.expectedAdmitted}`);
  if (report.exhausted > 0) problems.push(`${label}: ${report.exhausted} transaction(s) exhausted their retries`);
  if (report.capped > 0) problems.push(`${label}: ${report.capped} admission(s) stopped by the operation cap`);
  if (report.errors > 0) problems.push(`${label}: ${report.errors} error(s): ${report.errorMessages.join('; ')}`);
  return problems;
}

export class LoadArgsError extends Error {}

export interface LoadArgs {
  readonly bursts: readonly number[];
  readonly profiles: readonly LoadProfile[];
  /** A fixed global limit for every burst; when absent each burst's limit is 40% of it (at least 1),
   *  so every burst crosses its limit. */
  readonly limit?: number;
  readonly database?: string;
  readonly maxOps?: number;
  readonly json?: string;
}

const PROFILES: Readonly<Record<string, readonly LoadProfile[]>> = { generate: ['generate'], unary: ['unary'], both: ['generate', 'unary'] };

function positiveInt(flag: string, raw: string | undefined, max: number): number {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw) || Number(raw) > max) {
    throw new LoadArgsError(`${flag} must be an integer from 1 to ${max}, got ${JSON.stringify(raw ?? '')}`);
  }
  return Number(raw);
}

export function parseLoadArgs(argv: readonly string[]): LoadArgs {
  let bursts = DEFAULT_BURSTS;
  let profiles = PROFILES.both!;
  let limit: number | undefined;
  let database: string | undefined;
  let maxOps: number | undefined;
  let json: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    switch (flag) {
      case '--bursts':
        bursts = (value ?? '').split(',').map((raw) => positiveInt('--bursts', raw, MAX_BURST));
        break;
      case '--profile':
        if (value === undefined || PROFILES[value] === undefined) throw new LoadArgsError(`--profile must be generate, unary or both, got ${JSON.stringify(value ?? '')}`);
        profiles = PROFILES[value];
        break;
      case '--limit':
        limit = positiveInt('--limit', value, MAX_BURST);
        break;
      case '--database':
        if (!value) throw new LoadArgsError('--database needs a name');
        database = value;
        break;
      case '--max-ops':
        maxOps = positiveInt('--max-ops', value, OPERATION_CEILING);
        break;
      case '--json':
        if (!value) throw new LoadArgsError('--json needs a file');
        json = value;
        break;
      default:
        throw new LoadArgsError(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  return { bursts, profiles, limit, database, maxOps, json };
}

/**
 * Refuses any database this tool may not open for real: `(default)`, `deployed` (the production
 * server's `WHIM_FIRESTORE_DATABASE`), and every name that is not `whim-loadtest-<suffix>` with a
 * valid Firestore database id.
 */
export function assertThrowawayDatabase(database: string, deployed: string | undefined): void {
  if (database === '(default)') throw new LoadArgsError('refusing the (default) database: it is production');
  if (deployed && database === deployed) throw new LoadArgsError(`refusing ${database}: it is the deployed WHIM_FIRESTORE_DATABASE`);
  if (!database.startsWith(THROWAWAY_DATABASE_PREFIX) || !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(database)) {
    throw new LoadArgsError(`refusing ${JSON.stringify(database)}: only a throwaway ${THROWAWAY_DATABASE_PREFIX}<suffix> database (lowercase letters, digits, hyphens) may be load-tested`);
  }
}

export interface PlannedBurst {
  readonly profile: LoadProfile;
  readonly burst: number;
  readonly limit: number;
}

export function plannedBursts(args: LoadArgs): PlannedBurst[] {
  return args.profiles.flatMap((profile) => args.bursts.map((burst) => ({ profile, burst, limit: args.limit ?? Math.max(1, Math.floor((burst * 2) / 5)) })));
}

/** The operations a plan sends when every transaction commits on its first attempt: each admission
 *  reads its row and its counters (one global counter for `generate`, two for the unary pair), and
 *  each admitted one writes the row and two counters. Retries only add to it. */
export function plannedOperations(plan: readonly PlannedBurst[]): number {
  return plan.reduce((sum, { profile, burst, limit }) => sum + burst * (profile === 'generate' ? 3 : 4) + Math.min(burst, limit) * 3, PROBE_OPERATIONS);
}

/** The cost estimate for `operations`, in US dollars, at `USD_PER_100K_OPERATIONS`. */
export function estimatedCostUsd(operations: number): number {
  return (operations * USD_PER_100K_OPERATIONS) / 100_000;
}

export interface LoadReport {
  readonly target: 'emulator' | 'firestore';
  readonly database: string;
  readonly operationCap: number | null;
  readonly plannedOperations: number;
  readonly operations: number;
  readonly costCeilingUsd: number | null;
  readonly bursts: readonly BurstReport[];
  readonly ok: boolean;
  readonly problems: readonly string[];
}

interface Target {
  readonly target: LoadReport['target'];
  readonly database: string;
  readonly budget: OperationBudget;
}

/** Where the run goes, refused before any client exists when it is not the emulator or a capped
 *  throwaway database. */
function targetOf(args: LoadArgs, env: NodeJS.ProcessEnv, planned: number): Target {
  if (args.database === undefined) {
    if (!env.FIRESTORE_EMULATOR_HOST) throw new LoadArgsError('FIRESTORE_EMULATOR_HOST is unset and no --database is named; run deploy/loadtest/firestore-admission.sh');
    return { target: 'emulator', database: '(default)', budget: new OperationBudget(args.maxOps) };
  }
  if (env.FIRESTORE_EMULATOR_HOST) throw new LoadArgsError('--database names a real database, but FIRESTORE_EMULATOR_HOST is set');
  assertThrowawayDatabase(args.database, env.WHIM_FIRESTORE_DATABASE);
  if (args.maxOps === undefined) throw new LoadArgsError('a real-database run needs --max-ops');
  if (planned > args.maxOps) throw new LoadArgsError(`the plan needs at least ${planned} operations, above --max-ops ${args.maxOps}`);
  return { target: 'firestore', database: args.database, budget: new OperationBudget(args.maxOps) };
}

/**
 * The CLI: runs every planned burst in turn, prints the JSON report (and writes it to `--json`), and
 * resolves the exit code: 0 when every burst admitted exactly its limit with no exhausted, capped or
 * failed transaction, 1 when one did not, 2 when the arguments or the target were refused.
 */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args: LoadArgs;
  let target: Target;
  const plan: PlannedBurst[] = [];
  try {
    args = parseLoadArgs(argv);
    plan.push(...plannedBursts(args));
    target = targetOf(args, env, plannedOperations(plan));
  } catch (err) {
    if (!(err instanceof LoadArgsError)) throw err;
    console.error(`firestore-admission: ${err.message}`);
    return 2;
  }
  const runId = randomUUID();
  const bursts: BurstReport[] = [];
  target.budget.charge(PROBE_OPERATIONS);
  const db = await openFirestoreClient(target.database, { probeTimeoutMs: PROBE_TIMEOUT_MS });
  try {
    for (const planned of plan) {
      bursts.push(await runAdmissionBurst(db, { ...planned, namespace: `${runId}-${planned.profile}-${planned.burst}`, budget: target.budget }));
    }
  } finally {
    await db.terminate();
  }
  const problems = bursts.flatMap(burstProblems);
  const cap = Number.isFinite(target.budget.cap) ? target.budget.cap : null;
  const report: LoadReport = {
    target: target.target,
    database: target.database,
    operationCap: cap,
    plannedOperations: plannedOperations(plan),
    operations: target.budget.used(),
    costCeilingUsd: cap === null ? null : estimatedCostUsd(cap),
    bursts,
    ok: problems.length === 0,
    problems,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  if (args.json) fs.writeFileSync(args.json, text);
  return report.ok ? 0 : 1;
}
