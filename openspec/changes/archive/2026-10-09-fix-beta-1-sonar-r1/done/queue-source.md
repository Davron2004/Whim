# DONE: queue snapshots and construction boundary

Source findings: S27, S28 (`typescript:S7747`, `server/src/admission/slots.ts:186,190`) and S30 (`typescript:S7059`, `server/src/routes/generate.ts:658`).

Create named copies of the queue and of each waiter's listener collection, then iterate those copies. A notification callback may mutate the live queue or listener set; current-pass membership is fixed at the start of the pass. Do not iterate a live Set or preserve only an array literal in the loop header.

Make `LineWakes` construction synchronous. The waiter that owns the ticket registers the existing outcome observation after the instance exists, and forwards the settled `LineOutcome` to the ordinary wake state. Preserve registration before entering the wait loop, one wake per settlement, a pre-wait settlement, abort/slot/drain/timeout priority, and the zero-position microtask check. Do not alter S31/S32's serial wait loop.

This is structural. Existing queue listener, abort, drain, timeout, and hand-off regressions remain the proof. No new test or source-text assertion. One fast gate and the later full gate cover these three source findings.
