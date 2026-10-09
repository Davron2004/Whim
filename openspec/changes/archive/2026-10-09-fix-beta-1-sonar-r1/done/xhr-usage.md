# DONE: XHR classification and usage-purge observers

Findings: S46 and S85 (`typescript:S9383`, `usage-store.ts:1000`, `xhr-transport.ts:271`).

A rejected HTTP classifier must settle the XHR opener once as the existing content-free network failure. A late abort still wins after the response completes. Keep the `GenerationClientError` taxonomy and the normal classified HTTP result unchanged; do not expose a parser/header callback error as a user hint.

The usage purge timer must continue after a consumer callback throws. Both purge calls still start each run, each failed purge is offered to `onError` once, and `onTick` is attempted after their settlement. A throwing `onError` must never call `onError` again. Record that observer failure through the server logger with a fixed operation/hook label and no thrown error value, device ID, prompt, or database detail. Apply the same content-free logging to a throwing `onTick`; neither exception reaches the timer promise or prevents a later interval run.

Add observable regressions:
1. force the XHR adapter's HTTP classification to reject, assert the caller receives a normal `GenerationClientError` with the network kind, then repeat with a late abort and assert silent completion;
2. make each usage-purge observer throw in turn, assert both purge jobs still run, the first run completes, and a later scheduled run is still attempted. The test must not inspect an empty catch or a log implementation.

Keep S84's async `Response.json` contract and S78's public promise contract out of this cohort. One fast gate and the later full gate cover S46 and S85.
