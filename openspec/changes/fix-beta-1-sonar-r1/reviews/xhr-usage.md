# XHR classification and usage-purge review

Independent read-only review: **CLEAN** for `add2be3988aca8ef35bd7cbbee2fbf8b1a05759d` against pinned BASE `6314b1eea6dca5f5f83d485950233ea7bc0f16ea`.

The four changed files exactly match the cohort allowlist. No harness, configuration, public-contract, or checker changes appear, and `git diff --check` is clean.

`finishHttpError` remains single-entry under duplicate native completion. Its two-argument continuation owns both success and rejection from `httpErrorFrom`: a classifier failure becomes the established content-free `GenerationClientError{kind:'network'}`, while a signal aborted after response completion resolves the existing silent-abort sentinel. The normal HTTP, device-identity, request-id, and retry-after paths still use the shared classifier. The new XHR cases force the adapter's header access to throw, exercise normal and late-abort ordering, assert one classification/read, bounded settlement, no unhandled rejection, preserved error taxonomy, and no secret in the host log buffer.

`scheduleUsagePurge` starts both purge jobs before waiting, reports each failed job once, and keeps an observer exception out of the pair and timer continuation. `onError` exceptions are caught without passing their error objects to the server logger; a thrown `onTick` is caught by the terminal continuation. The fixed log fields are only `operation: 'usage_purge'` and the hook name. The new server regression covers a thrown ledger observer, idle observer, and tick observer, holds one purge pending to prove completion ordering, proves the second interval starts both jobs, checks no callback recursion or unhandled rejection, and checks captured output contains no injected private value.

The changes preserve the generation-stream transport's error taxonomy and silent-cancellation contract, and the usage-record retention scheduler's independent ledger/idle work. No suites or gates were run by this reviewer; worker/root receipts and the later full gate remain the validation authority.
