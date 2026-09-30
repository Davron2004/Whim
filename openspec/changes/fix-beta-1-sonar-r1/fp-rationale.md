# Proposed Sonar false-positive dispositions

Snapshot: PR #137, open issues retrieved from SonarCloud API on 2026-09-29. This is a reviewed rationale only; no issue status was changed.

## Authority
No current canonical runbook requires a human to adjudicate a justified Sonar false positive. docs/harness.md:104 says “don't suppress, fix (or add a scoped .eslintrc.js override … human-ratified edit)”; that governs source/config choices, not Sonar issue status. .claude/commands/opsx/apply.md:52 requires a Sonar round “repeat until green” but does not assign issue transitions. Its step 12 says the human's one closure act is “reviewing and merging the ready-for-review PR,” so a false-positive transition is not reserved as ratification. The archive at 2026-08-21-automate-closure/pending-class2-sonar-1.md:273-290 is a nonbinding example of a human UI choice, not a current constraint.

Interpretation: the user’s authorization to orchestrate closure permits the orchestrator to adjudicate these correct external findings, provided this rationale and the current opaque issue keys are recorded, no source suppression/check weakening is used, and a new PR analysis reports the resulting green verdict. A project credential with issue-transition permission is operationally necessary; that is not a separate approval requirement.

## Async-contract findings
All store entries below implement Promise-returning public interfaces. Removing async changes synchronous throw-to-rejected-Promise behavior for duplicate IDs, validation, or DatabaseSync errors; adding a dummy await makes no contract clearer.
- S33 AaDv2Go9DHOwsfbTeJiW — usage-store.ts:485 unitAvailable: Promise API compatibility.
- S34 AaDv2Go9DHOwsfbTeJij — usage-store.ts:772 unitAvailable: Promise API compatibility.
- S40 AaDv2Go9DHOwsfbTeJid — usage-store.ts:563 purgeIdleUsage: Promise API compatibility.
- S41 AaDv2Go9DHOwsfbTeJie — usage-store.ts:575 deviceRecords: Promise API compatibility.
- S42 AaDv2Go9DHOwsfbTeJif — usage-store.ts:585 deleteDeviceRecords: Promise API compatibility.
- S43 AaDv2Go9DHOwsfbTeJiq — usage-store.ts:887 purgeIdleUsage: Promise API compatibility.
- S44 AaDv2Go9DHOwsfbTeJir — usage-store.ts:892 deviceRecords: Promise API compatibility.
- S45 AaDv2Go9DHOwsfbTeJis — usage-store.ts:915 deleteDeviceRecords: Promise API compatibility.
- S60 AaDv2Go9DHOwsfbTeJiV — usage-store.ts:460 admit: rejected duplicate/SQLite failures remain promises.
- S61 AaDv2Go9DHOwsfbTeJiX — usage-store.ts:509 refund: Promise API compatibility.
- S62 AaDv2Go9DHOwsfbTeJiY — usage-store.ts:514 settle: validation failures remain rejected promises.
- S63 AaDv2Go9DHOwsfbTeJiZ — usage-store.ts:525 recordCost: Promise API compatibility.
- S64 AaDv2Go9DHOwsfbTeJia — usage-store.ts:533 listUnresolvedCostRows: Promise API compatibility.
- S65 AaDv2Go9DHOwsfbTeJib — usage-store.ts:548 summary: Promise API compatibility.
- S66 AaDv2Go9DHOwsfbTeJic — usage-store.ts:552 purgeLedger: Promise API compatibility.
- S67 AaDv2Go9DHOwsfbTeJii — usage-store.ts:749 admit: rejected DatabaseSync failures remain promises.
- S68 AaDv2Go9DHOwsfbTeJik — usage-store.ts:800 refund: Promise API compatibility.
- S69 AaDv2Go9DHOwsfbTeJil — usage-store.ts:804 settle: validation/DatabaseSync failures remain promises.
- S70 AaDv2Go9DHOwsfbTeJim — usage-store.ts:820 recordCost: Promise API compatibility.
- S71 AaDv2Go9DHOwsfbTeJin — usage-store.ts:834 listUnresolvedCostRows: Promise API compatibility.
- S72 AaDv2Go9DHOwsfbTeJio — usage-store.ts:856 summary: Promise API compatibility.
- S73 AaDv2Go9DHOwsfbTeJip — usage-store.ts:882 purgeLedger: Promise API compatibility.
- S79 AaDv2GiGDHOwsfbTeJiA — generation/machine.ts:743 emitCompletion: must remain AsyncGenerator while preserving abort check between usage and terminal.
- S80 AaDv2GiGDHOwsfbTeJiB — generation/machine.ts:1101 emitDiagnosticsAndDone: must remain AsyncGenerator while preserving abort checks between diagnostics and done.
- S84 AaDv2GziDHOwsfbTeJjP — xhr-transport.ts:265 fake Response.json: async turns JSON.parse failure into a rejected promise, as Response.json requires.
- S91 AaDv2Go9DHOwsfbTeJiT — usage-store.ts:436 credit: Promise API compatibility.
- S92 AaDv2Go9DHOwsfbTeJiU — usage-store.ts:450 read: Promise API compatibility.
- S93 AaDv2Go9DHOwsfbTeJig — usage-store.ts:722 credit: Promise API compatibility.
- S94 AaDv2Go9DHOwsfbTeJih — usage-store.ts:734 read: Promise API compatibility.

Required evidence before disposition: existing server/test/admin.suite.ts proves synchronous DatabaseSync behavior; server/test/machine.suite.ts proves abort/terminal ordering; xhr transport suite proves the classified-error race. No source or test change is proposed.

## Correct serial-loop findings
Each entry has intentional seriality/boundedness; replacing it with Promise.all or a dummy await changes a stated contract or reduces clarity.
- S6 AaDv2GrLDHOwsfbTeJiy — flowbench/drive.ts:442: each worker claims one indexed run at a time; output ordering and parallel cap depend on it.
- S31 AaDv2Gn6DHOwsfbTeJiO — routes/generate.ts:716: each queue turn waits for one wake before deciding its outcome.
- S32 AaDv2Gn6DHOwsfbTeJiP — routes/generate.ts:717: outcome decision follows that same wake; abort/slot/timeout priority is sequential.
- S48 AaDv2GsEDHOwsfbTeJiz — lifecycle.ts:287: drain rechecks pending count and remaining deadline after every bounded wait.
- S49 AaDv2Gp_DHOwsfbTeJiu — loadtest/drive.ts:237: the second probe round begins only after the documented delay.
- S50 AaDv2Gp_DHOwsfbTeJiv — loadtest/drive.ts:238: each round collects its whole capped device set before the next.
- S86 AaDv2Gs1DHOwsfbTeJi1 — synthrun/observe.ts:640: watchdog mount polling is bounded and abort-aware.
- S87 AaDv2Gs1DHOwsfbTeJi2 — synthrun/observe.ts:663: quiet polling is bounded by its hard cap.
- S89 AaDv2G_fDHOwsfbTeJjd — build/build.mjs:246: app-record extraction logs and fails in input order.
- S90 AaDv2G_fDHOwsfbTeJje — build/build.mjs:277: source-map verification logs and fails in input order.
- S95 AaDv2G9vDHOwsfbTeJjb — water-counter.app.tsx:70: record appends remain ordered so partial persistence and landed count are truthful.
- S96 AaDv2G_fDHOwsfbTeJjc — build/build.mjs:223: bundle generation logs and fails in input order.

Required evidence before disposition: existing flowbench/e2e/loadtest/synthrun tests cover the worker cap, two-round leak outcome, and watchdog bounds. routes-generate suite covers queue heartbeat, abort, timeout, drain, cleanup, and hand-off. npm run build remains the build-series proof. No source or test change is proposed.

