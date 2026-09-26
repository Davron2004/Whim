# fix-3b: candidate generation cap 5 (R13 as amended)

Change the default of `WHIM_MAX_CONCURRENT_GENERATIONS` in `server/src/config.ts` from 3 to 5. Leave
`WHIM_SYNTHRUN_CONCURRENCY` at 2 (D25's synthrun ≤ vCPU rule stays). Update every place that documents or pins
the generation default, including relational rules (grep `maxConcurrentGenerations`, `MAX_CONCURRENT_GENERATIONS`,
`profileProblems`, and the `docs/deploy.md` capacity-profile table and load-test section). Load the new value
through `npm run server:test` once before editing docs, to find any rule that constrains it (a
generation/synthrun ratio, the `event` profile, the load-test driver's expectations). The orchestrator
load-tests 5 after deploy and may revert. So the change is exactly the one default plus its docs and tests;
say in the report exactly what reverting takes.
