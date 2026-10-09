# Contract: firestore-admission-loadtest (chain-5, #143)

Consumers: chain-6 (runbook prose in `docs/deploy.md` "Firestore stores"), the orchestrator (tasks
7.2, 7.3).

## CLI: `deploy/loadtest/firestore-admission.sh`

```
deploy/loadtest/firestore-admission.sh [--bursts N,N,...] [--profile generate|unary|both] [--limit N] [--json FILE]
deploy/loadtest/firestore-admission.sh --database whim-loadtest-<suffix> --confirm-spend [--max-ops N] [same options]
```

- `--bursts`: concurrent admissions per burst, each burst on fresh counters. Default `10,25,50,100`;
  each 1..1000.
- `--profile`: `generate` (kind `generate`), `unary` (`clarify`/`rewrite` alternating, one shared
  global limit across both, as `routes/clarify.ts`), or `both` (default; generate bursts first).
- `--limit`: the global limit every burst races for. Default per burst: `max(1, floor(0.4 × burst))`
  (10→4, 25→10, 50→20, 100→40), so every burst crosses its limit.
- `--json FILE`: also write the report to FILE (stdout always gets it).
- Every admission comes from its own device (`deviceLimit: 1`), so the global counter
  `admission/{utcDay}:global:{kind}` is the one contention point.
- Bursts run one after another; each lives under `loadtest/<runId>-<profile>-<burst>`.

Default target: the Firestore emulator, through
`node scripts/firestore-emulator-test.mjs server/test/firestore-admission.run.mjs <args>` (the
`stores:firestore:test` runner, now taking an optional script and arguments; free ports per run).
No gcloud call, no cost. Never runs in any gate.

Real target (`--database`), refusals in order, all before any gcloud call or Firestore client
(exit 1, or 2 for a usage error, message ends "Nothing was created."):
1. `(default)`, the `RUN_FIRESTORE_DATABASE` pinned in `deploy/cloudrun/deploy.sh`, and
   `$WHIM_FIRESTORE_DATABASE` when set.
2. Any name not `whim-loadtest-` + suffix matching `^[a-z][a-z0-9-]{2,61}[a-z0-9]$` overall.
3. `--max-ops` not an integer in `1..50000` (default 5000).
4. Prints `==> cap N operations: at most $X.XXXX (...)`, then refuses without `--confirm-spend`.

Then: `gcloud firestore databases create --database=<db> --location=$WHIM_GCP_REGION
--type=firestore-native`, runs the harness with `FIRESTORE_EMULATOR_HOST` unset and
`GOOGLE_CLOUD_PROJECT=$WHIM_GCP_PROJECT` (ADC), and on EXIT (also INT → 130, TERM → 143, a failed
create, a failed run):
- `gcloud firestore databases delete --database=<db> --quiet`;
- `gcloud firestore databases list`, polled up to 6 × 10 s, fails (exit 1 unless already
  non-zero) if any `…/databases/whim-loadtest-*` remains, naming it;
- keeps the run's own exit status otherwise.

Exit codes of the harness: 0 every burst passed; 1 a burst failed its verdict (report still
printed); 2 arguments or target refused (no client opened).

## Cap and cost

- `OPERATION_CEILING = 50_000` (proposal ruling 1; tasks.md's 20,000 ceiling is superseded), shell
  `LOADTEST_OPERATION_CEILING` must equal it (tested through behaviour on both sides).
- Price used: `USD_PER_100K_OPERATIONS = 0.18` (a multi-region write, the highest standard
  per-operation price), so the estimate is an upper bound: 5,000 ops ≤ $0.009; 50,000 ops ≤ $0.09.
- Hard cap at run time: every read (`tx.get` = 1, `tx.getAll(...refs)` = refs) and buffered write
  (`create`/`set`/`update`/`delete` = 1) of every transaction attempt, plus the client's one probe,
  is charged before it is sent; one that would pass the cap throws `OperationCapReached` and the
  transaction ends without committing. Operations sent never exceed `--max-ops`.
- Pre-run plan check (real target): `plannedOperations` = 1 + Σ(burst × reads + min(burst, limit) × 3),
  reads = 3 (`generate`) or 4 (`unary`); refused when above `--max-ops`. Retries add to it: on the
  emulator they multiplied it by about 7.

## Report (stdout JSON, `LoadReport`)

```ts
interface LoadReport {
  target: 'emulator' | 'firestore'; database: string;
  operationCap: number | null;          // null on the emulator without --max-ops
  plannedOperations: number;            // first-attempt-only estimate (above)
  operations: number;                   // charged: actually sent
  costCeilingUsd: number | null;        // the cap priced at USD_PER_100K_OPERATIONS
  bursts: BurstReport[]; ok: boolean; problems: string[];
}
interface BurstReport {
  profile: 'generate' | 'unary'; burst: number; limit: number;
  expectedAdmitted: number;             // min(burst, limit)
  admitted: number; refused: number;    // refused = at the limit
  exhausted: number;                    // ABORTED after ADMISSION_MAX_ATTEMPTS (25)
  capped: number; errors: number; errorMessages: string[];
  latencyMs: { p50: number; p99: number; max: number };   // per admit call, nearest rank
  attempts: { histogram: Record<string, number>; max: number }; // transactions per attempt count
  operations: number;
}
```

`problems`: over-admitted, admitted fewer than expected, any exhausted, any capped, any error.

## Reading contention

- Healthy: `admitted === expectedAdmitted`, `exhausted === 0`, histogram mass at low attempt counts.
- Contention: the histogram shifts right and p99 grows with the burst; `attempts.max` near 25 or
  `exhausted > 0` means a burst of that size would answer users with errors in production.
- The emulator serialises transactions with locks and has no per-document write-rate limit, so its
  latencies are not production's (50-admission unary burst: p50 ≈ 64 s). Use it for correctness
  and attempt counts only; only a real-database run gives production-like p99.

## Harness module (test-only): `server/test/firestore-admission-load.ts`

Exports used by `firestore-conformance.ts`: `runAdmissionBurst(db, { profile, burst, limit,
namespace, budget?, now? }): Promise<BurstReport>`, `OperationBudget(cap?)`, `plannedOperations`.
Entry: `server/test/firestore-admission.run.mjs` (esbuild-bundles it, runs `main(argv, env)`).

## Conformance cases added (`stores:firestore:test`)

- "50 concurrent admits for a global limit of 20 admit exactly 20, none exhausting its retries"
  (red against counters read outside the transaction: 50 admitted).
- "a lone admission sends exactly the operations the load test plans for it, per profile".
- "a burst under an operation cap stops at the cap, never past it".
