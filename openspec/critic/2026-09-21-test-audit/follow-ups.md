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
