# fix-3 dispatch block: a stub that can run the whole device acceptance + candidate caps (R13)

From 10.4 Android (progress.md). The dev stub pipeline (`WHIM_PIPELINE=stub`, which production refuses to
boot) can't drive the acceptance:
1. **Rewrite.** `/v1/rewrite` answers 502 `rewrite_not_configured` for any prompt without a marker
   (`server/src/routes/rewrite.ts:320-327`). In stub mode, answer every prompt with a canned plan: a
   `rewrittenPrompt` and at least 5 `plan` rows, so plan editing of the 4th+ row can be tested. The rows must
   honour the `decide`/`choices`/`other` clarifications the way the real prompt path does, at least by naming
   them in a row. Keep `[[fail]]` and `[[future:*]]` behaviour.
2. **App source.** `STUB_APP_SOURCE` (`server/src/pipeline.ts:9`) still uses the old `defineApp({ render })`
   shape, so the stub-built app throws `TypeError` on render. Update it to the current SDK app shape
   (`{ name, initial, screens, capabilities }`: copy the idiom of a real fixture such as
   `fixtures/tip-splitter.app.tsx`). Make it a real little app with a long enough screen that the orb inset is
   visible (the last element must be able to scroll above the orb). Add a test that proves it runs: bundle it
   through the same path the stub pipeline uses and mount it (synthrun, or the build's app-record extraction
   plus a render). It must fail on the old source.
3. **Line staging.** Add `WHIM_STUB_DELAY_MS` (stub-only, parsed with the other stub settings, default = today's
   200 ms per step) so a device test can make a build take ~60 s and stage a cap-1 line. Refuse it outside
   stub mode, as `WHIM_PIPELINE=stub` is refused in production.
4. **Candidate caps (R13).** Change the defaults in `server/src/config.ts`:
   `WHIM_MAX_CONCURRENT_GENERATIONS` 3 → 5 and `WHIM_SYNTHRUN_CONCURRENCY` 2 → 3. Update every place that
   documents or pins them: the `docs/deploy.md` capacity-profile table, config tests, and the load-test docs.
   The orchestrator load-tests this after deploy and may revert it, so keep the change to the two numbers and
   their docs/tests.
Gate-full-only suites touching these files: `npm run server:e2e`, `npm run synthrun:test`. Run both.
