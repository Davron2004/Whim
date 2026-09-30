# Sonar findings — PR #137 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #137
- gate: ERROR
- issues: 96

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — openspec/changes/beta-1/acceptance/ios-repro-resume/bounds.py:6 — pythonsecurity:S8707 (MAJOR)
Path Traversal via faulty LLM-supplied CLI arguments

## S2 — src/host/launcher/LauncherRoot.tsx:927 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S3 — src/host/launcher/generation-client.ts:201 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S4 — src/host/launcher/generation-client.ts:119 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S5 — src/host/launcher/settings-probe.ts:107 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S6 — server/src/flowbench/drive.ts:442 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S7 — deploy/smoke.sh:212 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S8 — server/src/routes/generate.ts:448 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S9 — scripts/release/lib/mmkv.ts:20 — typescript:S7772 (MINOR)
Prefer `node:buffer` over `buffer`.

## S10 — scripts/release/lib/upgrade-record.ts:23 — typescript:S7772 (MINOR)
Prefer `node:buffer` over `buffer`.

## S11 — scripts/release/upgrade-check.sh:36 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S12 — scripts/release/upgrade-check.sh:146 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S13 — scripts/release/upgrade-check.sh:148 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S14 — scripts/release/upgrade-check.sh:151 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S15 — scripts/release/upgrade-check.sh:153 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S16 — scripts/release/upgrade-check.sh:206 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S17 — scripts/release/upgrade-check.sh:206 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S18 — scripts/release/upgrade-check.sh:210 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S19 — scripts/release/upgrade-check.sh:221 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S20 — scripts/release/upgrade-check.sh:226 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S21 — scripts/release/upgrade-check.sh:226 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S22 — src/host/launcher/LauncherRoot.tsx:1106 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S23 — server/src/routes/generate.ts:792 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S24 — server/src/routes/generate.ts:798 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S25 — deploy/loadtest/run.sh:144 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S26 — server/src/routes/generate.ts:411 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S27 — server/src/admission/slots.ts:186 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S28 — server/src/admission/slots.ts:190 — typescript:S7747 (MINOR)
`for…of` can iterate over iterable, it's unnecessary to convert to an array.

## S29 — server/src/routes/generate.ts:658 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S30 — server/src/routes/generate.ts:658 — typescript:S7059 (CRITICAL)
Refactor this asynchronous operation outside of the constructor.

## S31 — server/src/routes/generate.ts:716 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S32 — server/src/routes/generate.ts:717 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S33 — server/src/usage-store.ts:485 — typescript:S7503 (MINOR)
Async method 'unitAvailable' has no 'await' expression.

## S34 — server/src/usage-store.ts:772 — typescript:S7503 (MINOR)
Async method 'unitAvailable' has no 'await' expression.

## S35 — src/host/launcher/generation-client.ts:330 — typescript:S6653 (MINOR)
Use 'Object.hasOwn()' instead of 'Object.prototype.hasOwnProperty.call()'.

## S36 — deploy/smoke.sh:232 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S37 — deploy/smoke.sh:232 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S38 — deploy/smoke.sh:262 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S39 — deploy/smoke.sh:262 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S40 — server/src/usage-store.ts:563 — typescript:S7503 (MINOR)
Async method 'purgeIdleUsage' has no 'await' expression.

## S41 — server/src/usage-store.ts:575 — typescript:S7503 (MINOR)
Async method 'deviceRecords' has no 'await' expression.

## S42 — server/src/usage-store.ts:585 — typescript:S7503 (MINOR)
Async method 'deleteDeviceRecords' has no 'await' expression.

## S43 — server/src/usage-store.ts:887 — typescript:S7503 (MINOR)
Async method 'purgeIdleUsage' has no 'await' expression.

## S44 — server/src/usage-store.ts:892 — typescript:S7503 (MINOR)
Async method 'deviceRecords' has no 'await' expression.

## S45 — server/src/usage-store.ts:915 — typescript:S7503 (MINOR)
Async method 'deleteDeviceRecords' has no 'await' expression.

## S46 — server/src/usage-store.ts:1000 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S47 — scripts/release/cli.ts:167 — typescript:S7503 (MINOR)
Async function 'runVerifyAab' has no 'await' expression.

## S48 — server/src/lifecycle.ts:287 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S49 — server/src/loadtest/drive.ts:237 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S50 — server/src/loadtest/drive.ts:238 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S51 — server/src/routes/clarify.ts:220 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S52 — server/src/routes/clarify.ts:223 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S53 — server/src/routes/clarify.ts:226 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S54 — server/src/routes/clarify.ts:362 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S55 — server/src/routes/clarify.ts:394 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S56 — server/src/routes/generate.ts:364 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S57 — server/src/routes/generate.ts:375 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S58 — server/src/routes/generate.ts:795 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S59 — server/src/routes/rewrite.ts:339 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S60 — server/src/usage-store.ts:460 — typescript:S7503 (MINOR)
Async method 'admit' has no 'await' expression.

## S61 — server/src/usage-store.ts:509 — typescript:S7503 (MINOR)
Async method 'refund' has no 'await' expression.

## S62 — server/src/usage-store.ts:514 — typescript:S7503 (MINOR)
Async method 'settle' has no 'await' expression.

## S63 — server/src/usage-store.ts:525 — typescript:S7503 (MINOR)
Async method 'recordCost' has no 'await' expression.

## S64 — server/src/usage-store.ts:533 — typescript:S7503 (MINOR)
Async method 'listUnresolvedCostRows' has no 'await' expression.

## S65 — server/src/usage-store.ts:548 — typescript:S7503 (MINOR)
Async method 'summary' has no 'await' expression.

## S66 — server/src/usage-store.ts:552 — typescript:S7503 (MINOR)
Async method 'purgeLedger' has no 'await' expression.

## S67 — server/src/usage-store.ts:749 — typescript:S7503 (MINOR)
Async method 'admit' has no 'await' expression.

## S68 — server/src/usage-store.ts:800 — typescript:S7503 (MINOR)
Async method 'refund' has no 'await' expression.

## S69 — server/src/usage-store.ts:804 — typescript:S7503 (MINOR)
Async method 'settle' has no 'await' expression.

## S70 — server/src/usage-store.ts:820 — typescript:S7503 (MINOR)
Async method 'recordCost' has no 'await' expression.

## S71 — server/src/usage-store.ts:834 — typescript:S7503 (MINOR)
Async method 'listUnresolvedCostRows' has no 'await' expression.

## S72 — server/src/usage-store.ts:856 — typescript:S7503 (MINOR)
Async method 'summary' has no 'await' expression.

## S73 — server/src/usage-store.ts:882 — typescript:S7503 (MINOR)
Async method 'purgeLedger' has no 'await' expression.

## S74 — src/host/launcher/LauncherRoot.tsx:840 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S75 — src/host/launcher/LauncherRoot.tsx:1058 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S76 — src/host/launcher/LauncherRoot.tsx:1968 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S77 — src/host/launcher/ReportSheet.tsx:118 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S78 — server/src/app.ts:65 — typescript:S7503 (MINOR)
Async method 'fetchStats' has no 'await' expression.

## S79 — server/src/generation/machine.ts:743 — typescript:S7503 (MINOR)
Async generator method 'emitCompletion' has no 'await' expression.

## S80 — server/src/generation/machine.ts:1101 — typescript:S7503 (MINOR)
Async generator method 'emitDiagnosticsAndDone' has no 'await' expression.

## S81 — src/host/launcher/HistoryScreen.tsx:176 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S82 — src/host/launcher/HistoryScreen.tsx:372 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S83 — src/host/launcher/LauncherRoot.tsx:1248 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S84 — src/host/launcher/xhr-transport.ts:265 — typescript:S7503 (MINOR)
Async method 'json' has no 'await' expression.

## S85 — src/host/launcher/xhr-transport.ts:271 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S86 — synthrun/observe.ts:640 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S87 — synthrun/observe.ts:663 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S88 — src/host/launcher/HistoryScreen.tsx:157 — typescript:S9383 (MAJOR)
Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator.

## S89 — build/build.mjs:246 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S90 — build/build.mjs:277 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S91 — server/src/usage-store.ts:436 — typescript:S7503 (MINOR)
Async method 'credit' has no 'await' expression.

## S92 — server/src/usage-store.ts:450 — typescript:S7503 (MINOR)
Async method 'read' has no 'await' expression.

## S93 — server/src/usage-store.ts:722 — typescript:S7503 (MINOR)
Async method 'credit' has no 'await' expression.

## S94 — server/src/usage-store.ts:734 — typescript:S7503 (MINOR)
Async method 'read' has no 'await' expression.

## S95 — fixtures/water-counter.app.tsx:70 — typescript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S96 — build/build.mjs:223 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.
