# Appstats no-op review

Independent read-only review: **CLEAN** for `1c7b4a8c6c8f5a839eb18c191b9b4346b746d16e` against pinned BASE `720803675c547ea2d6b4288e7c2eb8308314472a`.

The commit changes only allowlisted `server/src/app.ts`; it adds no test, configuration, or checker change, and `git diff --check` is clean.

The default transport still accepts the resolver's generation id and abort signal through its structural `UsageAndCostTransport` assignment, returns a `Promise<GenerationStats | null>`, and resolves `null`. `Promise.resolve(null)` has the same observable result to the resolver's await/race path as the previous `async` method. It neither calls a provider nor changes the retry, rejection, or accounting paths. `createApp` still selects this transport only when callers supply no resolver transport.

This is the requested structural removal of an async wrapper with no await. Existing application and resolver coverage remains the relevant regression coverage; a new literal-return test would add no behavior check.

No suites, gates, native actions, or server activity were run by this reviewer. Worker/root receipts and the pending full gate remain the validation authority.
