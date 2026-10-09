VERDICT: report-mismatch

REPORT HONESTY: discrepancies: the R5 receipts substantiate the live-reference fixes, although the matrix says its GREEN run had 13,834 checks while the captured log reports 13,835. More materially, its `coverage complete` verdict omits a stale same-ID attempt that continues to emit nonterminal stream events while the newer attempt is active.

FINDINGS:

- `src/host/launcher/LauncherRoot.tsx:2072` — high — the stream loop processes every event before checking that its lease still owns the reused ID. A stale A can therefore call `journalStreamEvent()` at line 2078, which appends A's `stage`/aggregate data to B's freshly created `journal:<id>`; it then replaces `signalsRef`, `liveRef` (line 2085), and a visible Build screen (line 2086) with A's context. Trigger: A is left running; same-ID retry B activates; A subsequently emits a `stage:start` frame while B remains active. B may later settle and legitimately expose a verified report containing A's stage. The lease checks at terminal/refusal/recovery boundaries do not fence this earlier mutation. D19 requires a later same-ID activation to supersede the old attempt and fences stale mutations; this must be checked before every stream event has any journal, reference, signal, or screen effect.

- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx:746` — med — the new rendered stale-stream test is meaningful for a delayed terminal error: it proves B is still reattachable and that Cancel aborts B. It never pushes a nonterminal frame from A after B activates, so it cannot catch the journal/UI contamination above. A non-vacuous case should make stale A emit a stage frame, assert B's progress/live ref is unchanged, and verify B's eventual journal excludes A's stage.

SPEC CONFORMANCE: gaps: R5 correctly binds `liveRef` releases to the lease, verifies ownership before refusal-drop deletion, and has credible rendered coverage for active B after stale terminal errors and delayed refusals. The R4 retained-settlement rule still gives direct volatile failures actions only after a successful current-lease retention. Raw/current separation, durable marker and recovery guards, readback-gated Discard, removal faults, retry setup, cold demotion, app links, and observability fixture remain within scope. The unfenced event loop leaves stale same-ID stream ownership incomplete.

CHECK-WEAKENING SCAN: clean. The exact range changes no Class-1 configuration, dependencies, gates, generated output, or invariant suite. I found no checker relaxation, debug residue, or uncalled production path.

Validation: read-only review of `874be3307cabf29906be17137401723237a8ee3a..ac5a5390b9856d795f3c05e468d1c10f93786986`; `git diff --check` was clean. I inspected the cited RED, GREEN, fast-gate, and Knip receipts but did not run tests, builds, servers, native jobs, Git mutations, or product edits.
