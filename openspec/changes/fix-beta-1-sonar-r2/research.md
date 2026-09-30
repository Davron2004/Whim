# Sonar r2 reconciliation — PR #137

Snapshot: `integration/beta-1` at `46dbc32f6fa5349065b1558fb2af48e9def7354a`; SonarCloud PR 137 query on 2026-09-30 returned three open `typescript:S9383` findings and gate `ERROR`. This is a plan and rationale only. No source, test, ref, configuration, or Sonar issue state was changed.

## Dispositions

| finding | Sonar key | current location | disposition | basis |
| --- | --- | --- | --- | --- |
| S1 | `AaDw7l8d1jYWi4I5U-jc` | `server/src/routes/generate.ts:698` | FALSE_POSITIVE | closed resolve-only ticket outcome and resolve-only observer |
| S2 | `AaDv2GvxDHOwsfbTeJjJ` | `src/host/launcher/LauncherRoot.tsx:1106` | FALSE_POSITIVE | all production age-check paths settle; writes are caught and the installed MMKV read contract has no throwing path |
| S3 | `AaDv2GvxDHOwsfbTeJjI` | `src/host/launcher/LauncherRoot.tsx:1058` | SOURCE FIX | terminal-persistence failure after a retry can still reject the continuation and strand the launcher |

The prior r1 API receipts cover 60 different current keys. S1 is the moved successor of accepted queue S29 (`AaDv2Gn6DHOwsfbTeJiM`), but its new key needs its own documented transition/readback. S2 and S3 were deliberately retained as r1 source work (`done/launcher-age.md`); they were not among the 60 prior false positives.

## S1 — false-positive rationale

- `LineTicket.outcome` is expressly “Never rejects” in `server/src/admission/slots.ts:72-74`.
- Its only construction, `joinLine` at `slots.ts:225-251`, retains only the Promise `resolve`; every completion uses `waiter.settle(...)`. There is no rejection capability.
- The S1 observer at `generate.ts:698` only records the `LineOutcome` and calls `LineWakes.settle`; that writes a field and invokes a stored Promise resolver (`generate.ts:657-660`). Neither path introduces rejection.
- Existing route/admission coverage exercises queue handoff, cancellation, drain, and terminal outcome paths (`server/test/routes-generate.suite.ts:666-675,747-781`; `server/test/admission.suite.ts:237-240`).

Suggested root action: apply the documented key-level Sonar false-positive transition for `AaDw7l8d1jYWi4I5U-jc` with notifications disabled, then read the same key back. No source dispatch or added observer is justified.

## S2 — false-positive rationale

- The effect observes `runAgeCheck(...).then(...)` at `LauncherRoot.tsx:1106-1108` and only advances the current legal flow synchronously.
- Native age reads, native sheet calls, rejection, synchronous throw, and timeouts are normalized by `answerWithin` (`age-check.ts:96-109`) before `runAgeCheck` derives a result.
- Both writes remaining in the age flow are caught: guardian acknowledgement (`age-check.ts:176-186`) and outcome record (`195-205`). The r1 regression covers persistent MMKV write failure and preserves the derived blocked/allowed decision (`test/age-check.suite.ts:110-117,185-197`).
- The sole production backend is `createMmkvBackend('whim.launcher')` (`LauncherRoot.tsx:411-424`), which delegates `getString` to `react-native-mmkv`. Its installed primary interface documents `getString` only as returning a string or `undefined`, while it explicitly documents throws for `set` (`node_modules/react-native-mmkv/src/specs/MMKV.nitro.ts:39-56`). A synthetic arbitrary throwing `KVBackend` is not a production producer; an MMKV construction failure happens before the effect is installed.

Suggested root action: apply the documented key-level Sonar false-positive transition for `AaDv2GvxDHOwsfbTeJjJ` with notifications disabled, then read the same key back. Do not add `void`, an empty handler, or a second error surface merely to satisfy S9383.

## S3 — bounded behavioral cohort required

### Evidence

`runContinuation` discards `onRetryPending(continuation.record)` at `LauncherRoot.tsx:1050-1060`. `onRetryPending` awaits `runAttempt` (`2005-2010`). The initial r1 repair only protects `beginPendingAttempt` (`1650-1686`), before a request exists.

After a retry has started, `showStreamFailure` calls `settleFailed` (`1491-1522`); `settleFailed` immediately writes `journal.appendTerminal` and then the failed pending record (`1451-1470`). Both storage writers call `kv.set` without internal recovery (`run-journal.ts:131-152`; `pending-builds.ts:149-157`), and MMKV expressly permits `set` to throw. If a no-terminal stream reaches this code and the terminal journal/pending write fails, the enclosing `runAttempt` catch calls `settleFailed` again (`1861-1870`); a second persistence failure then rejects `runAttempt`. The legal-flow continuation has no handler for that rejection.

This can leave a completed retry represented as `building` and bypass the required failure UI. It conflicts with the pending-build requirement that a record reflect the true status (`openspec/specs/pending-builds/spec.md:32-39`) and the requirement that terminal failure is persisted or otherwise not falsely represented (`60-72`), while retaining the journal’s immediate-terminal and no-raw-data rules (`generation-run-journal/spec.md:63-87,136-145`).

### DONE: sonar-r2-retry-terminal-persistence

Use a fresh dispatcher BASE from the current staging tip after the two external false-positive transitions; do not reuse the historical r1 BASE.

**Allowlist**

```text
src/host/launcher/LauncherRoot.tsx
src/host/launcher/test/attempt-lifecycle-ui.suite.tsx
```

**Required observable behavior**

1. A retry resumed through the age/terms/consent continuation must not leave a rejected Promise when the stream has ended but its terminal persistence fails.
2. A failed retry must never remain or be presented as a truthful `building` ghost. If terminal storage cannot establish the new failed state, preserve the prior retry record/journal or otherwise show only a state that is supported by persisted data; do not forge a terminal journal or a failed payload.
3. The user sees the established generic, content-free failure surface. No raw storage error, diagnostic internals, prompt contents, or new retry/request is exposed.
4. Retain normal retry identity, cancellation, successful delivery, terminal-failure handling, and the r1 pre-request setup recovery. The paired pending/journal and single-writer invariants remain intact.
5. Do not add `void`, empty catch blocks, Sonar suppressions, checker changes, or a test that merely repeats source literals.

**RED/GREEN acceptance**

- In the existing rendered lifecycle suite, seed a failed retry record and journal, require consent, then let the retry start against the existing streaming test server.
- Inject a persistent terminal-write failure only after initial retry setup has succeeded; use the existing shared MMKV fault seam, whose predicate can distinguish the later write without changing the seam.
- The regression must follow the real Retry → consent → Agree path and end the stream with no terminal event. Against the pre-fix BASE it must expose the rejected/stranded terminal-persistence path.
- Green proof must establish one request only; generic error content without the storage error; no unhandled rejection; no false building ghost; and exact preservation of the old retry pair whenever persistence leaves no truthful replacement. Include a direct retry assertion only if it reaches a distinct callback boundary.

A worker owns only these two files, self-gates under the released source lease, and submits for independent review before merge. Root performs the usual red/integrity/full-gate sequence.

### S3 dispatch evidence (canonical stale grammar)

Severity: **HIGH** planning severity (Sonar severity: MAJOR). A completed consent-resumed retry can reject outside React’s handler and leave its persisted state falsely `building` after a terminal-write failure.

```text
## src/host/launcher/LauncherRoot.tsx
    } else {
      onRetryPending(continuation.record);
    }
```

The evidence block is intentionally limited to the currently flagged, discarded producer call. It is suitable for extraction to the fix-loop `stale` input; the rest of this Markdown file is not a stale-input file.

### Existing targeted validation

The repository provides no single-suite selector. The supported launcher command that always includes `runAttemptLifecycleUiTests` is:

```sh
npm run -s launcher:test
```

The worker’s required broader inner-loop command remains `bash scripts/gate.sh`; no narrower custom runner is warranted.

### r1 ledger reconciliation

- Original r1 **S22** is the current **S2**: `LauncherRoot.tsx:1106`, the age-check effect. Its source task caught guardian and outcome writes in `ccea1d07`; the remaining current finding is a false positive under the installed MMKV read contract. Keep S22 complete and append the current-key false-positive transition/readback receipt. Do not reopen it.
- Original r1 **S75** is the current **S3**: `LauncherRoot.tsx:1058`, the retry continuation. Its r1 DONE/review and corrected commit covered pre-request setup and partial-write restoration. They did not test or close post-stream terminal persistence: `settleFailed` can still throw after a real request and the discarded continuation can reject. Reopen **S75 only** in an append-only r1 correction record, then close it only after the r2 behavioral cohort is independently reviewed and gated.
