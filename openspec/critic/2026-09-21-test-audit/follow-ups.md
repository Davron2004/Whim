# Follow-ups found while carrying out the audit

Problems noticed during the cleanup that the audit doesn't list. They stay out of the cleanup diff.

## synthrun never delivers a syscall result to the mini-app (found 2026-09-21, batch 1)

`src/runtime/web/syscall.js:82` drops a `sysret` unless `ev.origin` is `'null'` or the iframe's
own origin. synthrun serves the outer page from `DELIVERY_ORIGIN` (`synthrun/session.ts:55`,
`http://…`), so every host answer is dropped inside the realm. Mini-apps under synthrun, and so
under the generation server's run stage, never see a storage result: an `await storage.kv.get()`
never resolves, and anything after it never runs.

Evidence: a real run of `fixtures/water-counter.app.tsx` (now `evals/test/fixtures/synthetic-run-report.json`)
traces `storage.kv.get` (id 1) and then two `storage.kv.set` (ids 2, 3) from button presses. The
host answered id 1 `ok`, but the app never issued the `storage.records.list` that follows the
awaited `kv.get` on mount, and never reached `records.append` after the awaited `kv.set`. The ids
are contiguous, so no records call was ever sent. The origin check came in with `559defe`
(2026-07-06, a Sonar cleanup).

Why the suites miss it: synthrun's acceptance tests check the host-side trace, and the records
test at `synthrun/test/acceptance.ts:1436` calls `append` without awaiting an earlier syscall.
`bridge:invariants` serves its page from a different origin setup, so the round trip works there.

Next step: decide the legitimate origin set (production `'null'`, synthrun's `DELIVERY_ORIGIN`),
then add a synthrun test where the app renders a value it read back from storage. Recording the
eval fixture again after the fix would add `records.*` entries to it.

Re-run the evidence (this is also how the eval fixture was recorded). From the repo root:

```sh
cat > .rec.ts <<'TS'
import { readFile } from 'node:fs/promises';
import { SynthRunSession, createRunCandidate } from './synthrun';
const session = await SynthRunSession.launch({ concurrency: 1 });
try {
  const report = await createRunCandidate(session)(await readFile('fixtures/water-counter.app.tsx', 'utf8'));
  console.log(JSON.stringify(report, null, 2));
} finally { await session.close(); }
TS
npx esbuild .rec.ts --bundle --platform=node --format=esm --tsconfig-raw='{}' \
  --external:esbuild --external:playwright --external:typescript --outfile=.rec.tmp.mjs \
  && node .rec.tmp.mjs; rm -f .rec.ts .rec.tmp.mjs
```

## Found by the batch 4 launcher rewrite (2026-09-21)

The rendered LauncherRoot tests reached code paths the source greps never did. None of these is
fixed in the cleanup; each was reproduced in the rendered suite unless marked otherwise.

1. **Two runs at once lose the newer run's controls (real bug).** `LauncherRoot.tsx` `runAttempt`
   sets `liveRef.current = { id: attemptId, … }` on every stage event (around L1239) and when
   delivery starts (around L1297), without checking which attempt owns it. With two runs in
   flight, the older run's stage or result takes `liveRef`, and its release then clears it. After
   that the newer run's building ghost can't reattach ("no live run to reattach to"), and
   cancelling it deletes the record without aborting the stream, so the run can still deliver.
   The committed concurrency test uses a failing older run, so it doesn't encode the bug.
2. **A detached run that fails takes the user off their screen.** `showStreamFailure` and the
   throw path call `setScreen(failure)` even after "Leave it running"; delivery checks
   `ctl.detached`, these paths don't. The spec says nothing either way.
3. **No boot surface after Retry.** MiniAppView shows none between Retry and the new WebView's
   `onLoadEnd`, because `paintMs` is reset only in `bind()`.
4. **A corrupt run journal crashes the failure screen.** A terminal entry whose `diagnostics`
   isn't a list throws in `run-timeline-view.ts` (`(failure.diagnostics ?? []).entries()`); the
   screen boundary recovers it.
5. **app-link's URL-independence test has scheme-host's old weakness.** Its throwing `URL` stub
   doesn't catch a URL-with-fallback parser; scheme-host's stand-in now answers wrongly instead.
6. **`useMiniAppHost` acts on `error` frames without checking `trusted`.** A frame the bundle
   makes up could raise the fatal app-error surface. Not reproduced; check against the trust
   model (CLAUDE.md: only nonce-authenticated frames are trusted).
7. **Some negative checks settle for a fixed number of `setImmediate` rounds** (prompt-flow-ui,
   "a late response cannot move the screen"). A slower path would make them pass vacuously rather
   than flake.

## Parked from batch 4

- **native-network-deny checker body.** The mutation tests are now a table and the
  exact-message rule is gone (7378d22), but the ~400-line Kotlin/ObjC lexer inside the test still
  matches whole statements (`'wrapper.webView.settings.blockNetworkLoads = true'`) and still
  checks `WhimTonePackage` registration, which has nothing to do with network deny. The rewrite to
  invariant-bearing tokens was not attempted: it is the only automated guard for native network
  deny, and there was no independent way to show a new lexer kept its coverage. An instrumented
  Android test and an XCTest (tooling.md) would replace most of it.
