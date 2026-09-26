# fix-1 dispatch block: the reviewer's findings (verdict SHIP WITH FIXES), progress.md R11

Findings, with file:line from the review of `f847b1cd..45300120`:

- **M1 (must).** A `fail`/`update` fallback, or a `stream_parse` error, mid-build throws out of
  `generation-client.ts#streamEvents` (:393, :669), and nothing cancels the reader or aborts the XHR. The
  `LauncherRoot.tsx:1759` catch goes through `settleServerEnding` → `releaseGenRef`, which only clears a ref.
  The only `controller.abort()` is in `abortLiveAttempt` (:1463, the explicit Cancel). So the server runs the
  build to the end: it holds a slot, spends credit and records `delivered`, and a retry gets `device_busy`.
  Fix: every client-side terminal ending of a generate stream (fallback `fail`/`update`, `stream_parse`, and
  any other throw out of the stream loop) aborts the request. Prefer a `try/finally` in `streamEvents` that
  cancels the reader and aborts the transport, so every caller gets it. Test: count transport aborts for a
  mid-build `fail`, a mid-build `update` and a `stream_parse`, on both transports, and red-check it.
- **M2 (must).** Rolling the server back below beta-1 breaks every beta-1 app. The device requires
  `select`/`other` on clarify questions (`generation-client.ts:108-109`), and the old server requires
  `answer` on a `Clarification`. Fix:
  (a) the device's guard defaults a missing `select` to `'one'` and a missing `other` to `false` (tolerant
      reader, and consistent with the server's default); a present but wrongly typed value still fails the
      guard. Test both.
  (b) `docs/deploy.md` "Rolling back and rotating the key": once beta-1 builds are installed, never
      `--tag` below the beta-1 server image, because a pre-beta-1 server rejects beta-1's `Clarification`
      shape. Say what to do instead (roll forward).
  (c) Correct `openspec/changes/beta-1/design.md` "Rollback" (the paragraph after the Migration Plan) to
      match.
- **L1.** `queue_timeout` in `server/src/generation/failure-codes.ts:17` is never produced (a waiter has no
  ledger row), and `server/test/ledger.suite.ts:652-653,672` asserts a state production can't create. Remove
  both. Update `openspec/changes/beta-1/handoff/wire-protocol.md` and the `generation-contract` delta if they
  name it. Keep `failure.reason` for a timed-out waiter as the `server_busy` hint.
- **L2.** Layer 2 relies on convention. `routes/generate.ts#forwardEvents` (:715) routes only `restart`
  through `eventForLevel`. Route every event it forwards through `eventForLevel(ev, c.get('protocolLevel'))`,
  and route `ApiError` bodies through `errorForLevel` wherever the request's level is known. Test that a
  synthetic level-2 pipeline event reaches a level-1 client only as the envelope or its downgrade.
- **L3.** `server/test/wire-v2.suite.ts:396-397` ("the plan the (stub) model wrote names the decision",
  "keeps both picks") only repeat the stub's canned output. Replace them with checks that would fail if the
  implementation broke (e.g. the delegated question and both picks reach the model's input, as data), or
  delete them if the prompt and quoting checks already cover it.
- **L4.** `prompts/index.ts:305-306` asks for `limit.alternative` "as a short request the user could send",
  and `copy.ts:780` renders `Build ${alternative} instead`, so a real model will produce "Build Make me a …
  instead". Ask for a short noun phrase (e.g. "a weather log you fill in yourself"), and pin the instruction
  in the prompts suite. Keep the device copy as it is.
- **L5a.** The report sheet's `update` fallback opens the update screen without the notice
  (`ReportSheet.tsx:146`). Pass the notice, the way clarify, rewrite and generate do.
- **L5b.** A content-policy refusal while every slot is busy writes no ledger row (`generate.ts:412-415`),
  but the free-slot path records `refused`. Record it the same way, without spending a daily unit (the row
  must not count against the limit, the same as the free-slot refusal: check how that one is counted), and
  test it.

Scope: only these. Gate-full-only suites that touch these files: `npm run server:e2e`,
`npm run launcher:deliver-verify`. Run both in the worktree before reporting.
