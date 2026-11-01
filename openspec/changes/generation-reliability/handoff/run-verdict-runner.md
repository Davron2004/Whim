# run-verdict runner findings (tip 2a6bcf18, BASE b6a3b2d6, staging integration/beta-2-fixes)

OVERALL: PASS

1. Fast gate: capped-run.sh --mb 6144 --secs 1500 -- scripts/gate.sh -> exit 0, "FAST GATE PASSED", no ^FAIL lines. Log: run-verdict-gate.log
2. server:e2e (--mb 4096 --secs 900): exit 0, "68 passed, 0 failed". Log: run-verdict-e2e.log
3. fixloop.sh integrity (allow-run-verdict.txt): exit 0, "INTEGRITY OK" (13 files, all in allowlist).
4. removal-ratchet --base b6a3b2d6 --head chain/...: exit 0, PASS (6 verification files compared, no drops, no authorised lines).
5. Red-checks (wrappers rv-red-{a,b,c}.sh in scratchpad), all exit 0 = RED:
   a. server run-stage,machine, prod run.ts+machine.ts reverted: exit 0 COARSE RED (tsc type errors in server/tsconfig.json, e.g. machine.suite.ts(774) 'rerun' and (809,952) 'repairable' not in type). Builder's type-kept mutation reds in run-verdict-report.md cover the assertion level. Log: run-verdict-red-a.log
   b. synthrun resilience, prod observe.ts+report.ts reverted: exit 0 assertion RED, "5 FAILED, 95 passed" (module-eval, mount-timeout, throw-after-paint none, loader [probes], malformed verdict none; all "got undefined"). Log: run-verdict-red-b.log
   c. server:e2e, prod run.ts+machine.ts reverted: exit 0 assertion RED, "60 passed, 7 failed". Log: run-verdict-red-c.log
6. git log b6a3b2d6..tip: no Co-Authored-By / attribution lines (grep empty).
