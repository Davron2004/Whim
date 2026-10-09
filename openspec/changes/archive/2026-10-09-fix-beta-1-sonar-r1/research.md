# Sonar round 1 planner — ready cohorts

Reviewed base: a1586b87. The 96 Sonar locations are in findings.md. This first dispatch set has no overlapping files. An external “exception” requires a human Sonar project owner to mark the actual issue Safe/False Positive; it is not a source suppression.

## Governing evidence
- docs/harness.md:104-107 says local lint is stricter, forbids suppression, and makes SonarCloud the PR-time authority.
- .claude/commands/opsx/apply.md:50-54 automates push/re-analysis only; it gives no agent authority to change issue status.
- Precedent: archive/2026-08-21-automate-closure/pending-class2-sonar-1.md:273-290 records a human Sonar UI Won't Fix / Safe choice for correct code.
- New acceptance/android-4/post-ui.py confines evidence capture to BASE, validates its name, rejects overwrites, and sends adb argv as a list. It does not expand S1.

## sonar-r1-evidence-path — S1, MAJOR
Allowlist: openspec/changes/beta-1/acceptance/ios-repro-resume/bounds.py.
EVIDENCE:
~~~py
walk(json.load(open(sys.argv[1])))
~~~
DONE: resolve one existing hierarchy JSON under this helper's own evidence directory before reading; reject an escaping, directory, or missing target. Preserve read-only inspection of sibling hierarchy files and printed bounds. Manual helper success and ../ refusal are the acceptance, not a product test.

## sonar-r1-host-guards — S3, S4, S35, MINOR
Allowlist: src/host/launcher/generation-client.ts.
EVIDENCE:
~~~ts
Object.prototype.hasOwnProperty.call(optional, key)
Object.prototype.hasOwnProperty.call(SUMMARY_KINDS, value.kind)
Object.prototype.hasOwnProperty.call(EVENT_GUARDS, type)
~~~
DONE: Object.hasOwn at all three guards; retain tolerant-null decoding and rejection of unknown event/summary kinds. No unit test is needed for the textual structural edit. I found no Hermes-host compatibility proof: src/sdk/navigation.ts runs in WebView. Terminal acceptance is final Android offline plus iOS Release generation decode through all three guards.

## sonar-r1-shell-release — S7, S9-S21, S25, S36-S39, S47, MAJOR/MINOR
Allowlist: deploy/smoke.sh; deploy/loadtest/run.sh; scripts/release/lib/mmkv.ts; scripts/release/lib/upgrade-record.ts; scripts/release/upgrade-check.sh; scripts/release/cli.ts.
EVIDENCE:
~~~sh
if [ "$PROBE_STATUS" = 426 ] && [[ "$body" == *'"error":"update_required"'* ]]; then
while [ "$#" -gt 0 ]; do
~~~
DONE: cited Bash tests use [[; cited function positional parameters become named locals before use; Buffer imports use node:buffer; runVerifyAab becomes non-async while retaining numeric return/caught errors. Preserve Bash 3.2, set -euo pipefail, output, exit status, quoting, and upgrade artifact order. server/test/deploy-config.suite.ts remains regression coverage; no literal/source-grep test.

## sonar-r1-detached-resolution-routes — S8, S23-S24, S26, S51-S59, MAJOR
Allowlist: server/src/routes/generate.ts; server/src/routes/clarify.ts; server/src/routes/rewrite.ts.
EVIDENCE:
~~~ts
resolveTracker.track(resolveRequestUsage(requestId, deviceId, ids, true, resolveDeps(deps)));
~~~
DONE: explicitly discard each route’s tracker-returned promise. Preserve calls, generation IDs, credit ownership, response timing, and drain registration. ResolveTracker.track stores the exact promise and installs both fulfilment/rejection untracking handlers (server/src/usage/resolve.ts:375-389); the resolver is intentionally detached. Structural edit only. generate.ts is exclusive: do not overlap line-wakes work.

## sonar-r1-admission-snapshot — S27-S28, MINOR
Allowlist: server/src/admission/slots.ts.
EVIDENCE:
~~~ts
for (const waiter of [...line]) {
for (const listener of [...waiter.listeners]) listener(position);
~~~
DONE: retain snapshots while satisfying S7747. Mutations during notification must not skip old entries or visit new entries; preserve positions, FIFO hand-off, and listener once-only behavior. Existing admission queue move/leave cases are the regression surface.

## sonar-r1-launcher-fire-forget — S2, S5, S22, S74-S76, S77, S81-S83, S88, MAJOR
Allowlist: src/host/launcher/LauncherRoot.tsx; settings-probe.ts; HistoryScreen.tsx; ReportSheet.tsx.
EVIDENCE:
~~~ts
this.runProbe(this.pendingUrl, this.generation);
fieldsLeavingViewOnRestore(...).then(fields => { if (!cancelled) setRestoreDiff({ status: 'ready', fields }); });
~~~
DONE: use explicit disposal only where fire-and-forget intent and error handling are established. Preserve Home fallback/open behavior, first-run readiness ordering, consent continuation, app-link routing, cancellation fences, and best-effort description. S22/S77/S81/S82 need producer rejection tracing before an edit; add a meaningful existing-suite regression if rejected work currently strands UI or becomes unhandled. No blanket void sweep.

## sonar-r1-line-wakes — S29-S32, CRITICAL/MAJOR/MINOR
Allowlist: server/src/routes/generate.ts; server/test/routes-generate.suite.ts.
EVIDENCE:
~~~ts
constructor(outcome: Promise<LineOutcome>) { outcome.then((settled) => { this.outcome = settled; this.wake?.(); }); }
while (end === undefined) { await wakes.next(); end = await lineEndAfterWake(ticket, wakes); }
~~~
DONE: take asynchronous outcome observation out of construction and make settlement/rejection explicit. Preserve one serial wake then outcome decision per turn. A regression must cover entry/heartbeat, abort priority, timeout, drain, cleanup and slot hand-off, and fail before the source change.

## sonar-r1-serial-loops — S6, S48-S50, S86-S87, S95, MINOR
Allowlist: server/src/flowbench/drive.ts; server/src/lifecycle.ts; server/src/loadtest/drive.ts; synthrun/observe.ts; fixtures/water-counter.app.tsx.
EVIDENCE:
~~~ts
output[index] = await runCase(baseUrl, item.caseInfo, item.run, options);
while (resolveTracker.pendingCount > 0 && remaining() > 0) await resolveTracker.drain(remaining());
~~~
DONE: retain worker admission, bounded drain polling, two delayed leak-probe rounds, bounded synthrun polling, and ordered record appends. If no clear compliant formulation retains semantics, park each actual issue for the documented human Sonar exception rather than parallelizing or adding dummy awaits. Existing flowbench/e2e/loadtest/synthrun coverage is the regression surface.

## Targeted reconciliation
### Async-contract exception set — S33-S34, S40-S45, S60-S73, S79-S80, S84, S91-S94
UsageStore promises deliberately translate duplicate-ID, validation, and SQLite synchronous throws into rejected promises. The generation tails must remain AsyncGenerators to preserve abort checks between usage/diagnostic and terminal events. The XHR Response adapter must promise-reject a JSON parse failure, not synchronously throw it. These are Sonar S7503 false positives: no dummy await or async removal. Root's authorized external adjudication is documented in fp-rationale.md and fp-receipt.json. S46 alone is a safe source edit because both purge rejections are already handled before its final notification. S78 may return Promise.resolve(null), subject to existing server-core coverage.

### XHR terminal ownership — S85, MAJOR
httpErrorFrom catches response.json failures itself, then resolves a GenerationClientError (transport-shared.ts:351-374). Its continuation owns rejectOpen and the late-abort race asserted in xhr-transport.suite.ts:380-416. An explicit discarded chain is safe only with an equivalent rejection path; otherwise add a meaningful regression for promise settlement and abort-wins ordering.

### Correct serial-loop exceptions — S6, S31-S32, S48-S50, S86-S87, S89-S90, S95-S96
These loops encode bounded worker admission, one queue wake/outcome per turn, deadline polling, delayed two-round leak probes, watchdog polling, ordered build logs/fail-fast extraction, and ordered fixture appends. The LineTicket contract says outcome never rejects (admission/slots.ts:66-79), so moving its listener out of LineWakes construction clears S29/S30; S31/S32 stay exception candidates. No readable source refactor is justified solely to remove awaits. S89-S90/S96 additionally sit at the build/integrity boundary: do not modify or regenerate unless an authorized worker has a semantics-preserving patch; otherwise owner disposition.

### Launcher rejection split — S2, S5, S22, S74-S77, S81-S83, S88
S5 is structural: the probe contract explicitly never rejects. S2/S74-S76/S83 each launch work whose local body catches expected failures or intentionally fences its result; confirm each exact call before adding void. S77 reportDraftFor and S81/S82 history diff reads can reject from StoreAccess and leave draft/reassurance state incomplete; S88 runHistoryLoad deliberately rethrows after clearing loading (history-wait.ts:34-65). These need behavioral error handling with rendered regression coverage, not a void sweep. S22’s native-read rejection is normalized by runAgeCheck, but its KV write path has not been proven non-throwing; retain it until that contract is checked.

## Unverified
- No Hermes Object.hasOwn support proof exists in source or vendored files.
- I did not verify a UI error design for ReportSheet/history rejected StoreAccess reads; do not invent one without its governing spec.

## Producer reconciliation after the first worker gates

The initial explicit-void plans conflict with sonarjs/void-use and no-void. A second producer inspection proved the resolver calls already observe both settlement arms; their 13 source changes were restored and those findings were confirmed false positives. Report/history reads, age persistence, retry setup, XHR classification and usage-purge consumer callbacks have actual rejection gaps and need behavioral regressions. Five other launcher sites are evidenced false-positive candidates pending current-key verification. Corrected plans are in done/launcher-age.md and done/xhr-usage.md; latest terminal state is recorded in dispositions.md.
