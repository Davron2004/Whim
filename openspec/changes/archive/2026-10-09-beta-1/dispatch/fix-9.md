# fix-9: the load-test report gives a normalized CPU p95, not only the peak (10.2, R18)

beta-1's cap rule (`specs/server-admission-control/spec.md`, design D8, progress.md R8/R13) is "the highest pair
with **p95** CPU under 70 % and no failed runs". `deploy/loadtest/run.sh drive` samples `docker stats` CPU% every
2 s (per-core percentages: 200 % = both vCPUs of e2-standard-2), and `server/src/loadtest/drive.ts` reports only
`peak.peakCpuPercent`. At cap 5 / 5 devices the peak was 160.7 % (80 % of the machine) with no failures and
unchanged latency, so the rule can't be applied.

1. The report gains `cpu: { cores, samples, p50Percent, p95Percent, peakPercent }` where the percentages are
   **normalized to the whole machine** (per-core % ÷ cores). Keep `peak.peakCpuPercent` as is (raw) for
   continuity. `cores` comes from the VM: have the sampler read `nproc` once over the same ssh (or
   `docker info --format '{{.NCPU}}'`), with no hardcoded 2. Pick the percentile method (nearest-rank is fine)
   and test it with a fixed sample list, including the tiny-sample case.
2. The markdown/console report prints the normalized p95 and the sample count next to the peak.
3. `docs/deploy.md` "Load test": state the rule in these terms (normalized p95 < 70 %, no `failure`
   terminals, no unexpected refusals), and that the peak is informative only.
Scope: `server/src/loadtest/drive.ts`, `deploy/loadtest/run.sh` (the sampler), `server/loadtest.mjs` if it
prints, `server/test/loadtest.suite.ts`, `docs/deploy.md`. Don't change the verdict's pass/fail rule (the operator
decides caps). `server:e2e` has a load-test case: run it.
