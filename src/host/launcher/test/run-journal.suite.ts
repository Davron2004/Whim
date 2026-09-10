/**
 * run-journal Node suite (generation-observability chain-1, task 1.4; build-liveness B4), from
 * `generation-run-journal/spec.md`: creation alongside the pending record, the wire stage
 * vocabulary, unthrottled stage writes, the ~5s aggregate throttle, the always-immediate terminal
 * entry, the counts-and-hints-only content rule, the ~200 cap with aggregate-first eviction, the
 * move to `lastrun:<appId>`, survival on failure, deletion on dismiss, and the additive
 * `thinkingChars` count (omitted rather than a fabricated zero, so a journal written before this
 * change still parses unmodified).
 *
 * The store's clock is injected, so the throttle is exercised by advancing a number, never by
 * sleeping (a suite that sleeps is a suite that hangs).
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { RunJournalStore, JOURNAL_ENTRY_CAP, AGGREGATE_THROTTLE_MS } from '../run-journal';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import type { RunJournalEntry } from '../run-journal';

/** A store over a Map backend with a hand-driven clock. */
function makeStore(map = new Map<string, string>()) {
  let clock = 1_000;
  const store = new RunJournalStore(new MapKVBackend(map), () => clock);
  return {
    store,
    map,
    at(t: number) {
      clock = t;
    },
    advance(ms: number) {
      clock += ms;
    },
    get now() {
      return clock;
    },
  };
}

/** A `KVBackend` that counts reads, for the one property that is about COST rather than content:
 *  the aggregate throttle bounds how often the journal is WRITTEN, and it must bound how often the
 *  journal is READ too. On the device that read is a native MMKV call feeding a `JSON.parse` of the
 *  whole journal, and it used to run once per `token` AND once per `thinking` delta. */
class CountingKv implements KVBackend {
  reads = 0;
  constructor(private readonly inner: KVBackend) {}
  getString(key: string): string | undefined {
    this.reads++;
    return this.inner.getString(key);
  }
  set(key: string, value: string): void {
    this.inner.set(key, value);
  }
  delete(key: string): void {
    this.inner.delete(key);
  }
  getAllKeys(): string[] {
    return this.inner.getAllKeys();
  }
}

const kinds = (journal: readonly RunJournalEntry[] | null) => (journal ?? []).map((e) => e.kind);

export async function runRunJournalTests(h: Harness): Promise<void> {
  // ── creation ────────────────────────────────────────────────────────────────
  await h.test('run-journal: create writes an empty journal at journal:<launcherId>', async () => {
    const { store, map } = makeStore();
    store.create('app-1');
    h.eq(store.get('app-1'), [], 'a fresh journal exists and is empty');
    h.ok(map.has('journal:app-1'), 'stored under the journal:<launcherId> key, a sibling of pending:<launcherId>');
    h.eq(store.get('app-2'), null, 'an id with no journal reads as null');
  });

  await h.test('run-journal: an unreadable journal reads as absent, not a throw', async () => {
    const map = new Map<string, string>([['journal:broken', '{not json']]);
    const { store } = makeStore(map);
    h.eq(store.get('broken'), null, 'corrupt JSON reads as no journal');
    store.appendStage('broken', 'plan'); // must not throw
    h.eq(kinds(store.get('broken')), ['stage'], 'and appending recovers rather than propagating the corruption');
  });

  // ── stage entries: wire vocabulary, written immediately ─────────────────────
  await h.test('run-journal: every stage transition appends one entry, in arrival order, unthrottled', async () => {
    const t = makeStore();
    t.store.create('a');
    t.at(1000);
    t.store.appendStage('a', 'plan');
    t.at(1010);
    t.store.appendStage('a', 'generate');
    t.at(1020);
    t.store.appendStage('a', 'check');
    const journal = t.store.get('a')!;
    h.eq(journal.length, 3, 'one entry per transition, none coalesced');
    h.eq(journal.map((e) => e.stage), ['plan', 'generate', 'check'], 'wire stage names, in arrival order');
    h.eq(journal.map((e) => e.t), [1000, 1010, 1020], 'each stamped at its own arrival time, 10ms apart — no throttle');
  });

  await h.test('run-journal: a stage entry carries the wire name, never a display step label', async () => {
    const t = makeStore();
    t.store.appendStage('a', 'generate');
    const entry = t.store.get('a')![0];
    h.eq(entry.kind, 'stage', 'kind is stage');
    h.eq(entry.stage, 'generate', 'the wire vocabulary value, not the "writing the code" display step');
    h.ok(entry.aggregates === undefined && entry.failure === undefined, 'a stage entry carries nothing else');
  });

  // ── aggregate throttling (~5s) ──────────────────────────────────────────────
  await h.test('run-journal: a burst of token arrivals inside the window produces exactly one aggregate entry', async () => {
    const t = makeStore();
    t.store.create('a');
    t.at(10_000);
    for (let i = 1; i <= 50; i++) {
      t.advance(40); // 50 arrivals spread over 2s — well inside the ~5s window
      t.store.appendAggregate('a', { chars: i * 6, tokens: i });
    }
    const aggregates = t.store.get('a')!.filter((e) => e.kind === 'aggregate');
    h.eq(aggregates.length, 1, '50 arrivals over a 2s window yield one entry, not one per token');
    h.eq(aggregates[0].aggregates, { chars: 6, tokens: 1 }, 'it carries the cumulative counts as of the moment it was written');
  });

  await h.test('run-journal: aggregate entries are bounded by elapsed time / ~5s, not by arrival count', async () => {
    const t = makeStore();
    t.at(0);
    // 400 arrivals, 50ms apart → 20s of stream. At most 20s/5s = 4 entries.
    for (let i = 1; i <= 400; i++) {
      t.advance(50);
      t.store.appendAggregate('a', { chars: i, tokens: i });
    }
    const aggregates = t.store.get('a')!.filter((e) => e.kind === 'aggregate');
    h.ok(aggregates.length <= 20_000 / AGGREGATE_THROTTLE_MS, `${aggregates.length} entries is within the elapsed/throttle bound`);
    h.ok(aggregates.length >= 3, `the throttle still lets the counter advance over a long stream (${aggregates.length} entries)`);
    for (let i = 1; i < aggregates.length; i++) {
      h.ok(aggregates[i].t - aggregates[i - 1].t >= AGGREGATE_THROTTLE_MS, 'consecutive aggregate entries are at least the throttle apart');
    }
  });

  await h.test('run-journal: the window reopens exactly at the throttle boundary and counts stay cumulative', async () => {
    const t = makeStore();
    t.at(0);
    t.store.appendAggregate('a', { chars: 10, tokens: 2 });
    t.at(AGGREGATE_THROTTLE_MS - 1);
    t.store.appendAggregate('a', { chars: 20, tokens: 4 });
    h.eq(t.store.get('a')!.length, 1, 'one millisecond short of the window is still throttled');
    t.at(AGGREGATE_THROTTLE_MS);
    t.store.appendAggregate('a', { chars: 30, tokens: 6 });
    const aggregates = t.store.get('a')!;
    h.eq(aggregates.length, 2, 'at the boundary the next entry is written');
    h.eq(aggregates[1].aggregates, { chars: 30, tokens: 6 }, 'carrying the latest running totals, not a per-tick delta');
  });

  await h.test(
    'run-journal: inside a throttle window the aggregate path reads storage ZERO times, however many events arrive',
    async () => {
      // A reasoning model emits thousands of `thinking` deltas a minute and every one of them
      // reaches `appendAggregate`. Throttling only the WRITE still left a full journal read +
      // JSON.parse per event on the JS thread.
      const kv = new CountingKv(new MapKVBackend());
      let clock = 1_000;
      const store = new RunJournalStore(kv, () => clock);
      store.create('a');
      store.appendStage('a', 'generate');

      kv.reads = 0;
      store.appendAggregate('a', { chars: 1, tokens: 1, thinkingChars: 3 });
      const readsForTheFirstEntry = kv.reads;
      h.ok(readsForTheFirstEntry > 0, 'the first aggregate of a window still consults the journal');

      kv.reads = 0;
      for (let i = 0; i < 4_000; i++) {
        clock += 1; // 4s of stream: 4,000 events, all inside the one 5s window
        store.appendAggregate('a', { chars: i, tokens: i, thinkingChars: i * 3 });
      }
      h.eq(kv.reads, 0, '4,000 throttled events later, storage has not been read once');
      h.eq(store.get('a')!.filter((e) => e.kind === 'aggregate').length, 1, 'and exactly one entry was written');

      clock += AGGREGATE_THROTTLE_MS;
      store.appendAggregate('a', { chars: 9_999, tokens: 99, thinkingChars: 12 });
      const aggregates = store.get('a')!.filter((e) => e.kind === 'aggregate');
      h.eq(aggregates.length, 2, 'the window still reopens on time — the skipped reads did not disable the throttle');
      h.eq(aggregates[1].aggregates, { chars: 9_999, tokens: 99, thinkingChars: 12 }, 'carrying the latest totals');
    },
  );

  await h.test('run-journal: an aggregate entry carries only numeric counts, never token text', async () => {
    const t = makeStore();
    t.store.appendAggregate('a', { chars: 42, tokens: 7 });
    const entry = t.store.get('a')![0];
    h.eq(Object.keys(entry.aggregates!).sort((a, b) => a.localeCompare(b)), ['chars', 'tokens'], 'no field beyond the two counts');
    h.eq(typeof entry.aggregates!.chars, 'number', 'chars is numeric');
    h.eq(typeof entry.aggregates!.tokens, 'number', 'tokens is numeric');
    h.ok(entry.stage === undefined && entry.failure === undefined, 'an aggregate entry carries nothing else');
  });

  // ── thinking counts (build-liveness B4) ─────────────────────────────────────
  await h.test('run-journal: an aggregate entry carries thinkingChars alongside chars/tokens when it is nonzero', async () => {
    const t = makeStore();
    t.store.appendAggregate('a', { chars: 10, tokens: 2, thinkingChars: 3_400 });
    const entry = t.store.get('a')![0];
    h.eq(entry.aggregates, { chars: 10, tokens: 2, thinkingChars: 3_400 }, 'all three counts are stored together');
  });

  await h.test('run-journal: thinkingChars is OMITTED, not written as a zero, when nothing was ever thought', async () => {
    const t = makeStore();
    t.store.appendAggregate('a', { chars: 10, tokens: 2 });
    h.eq(t.store.get('a')![0].aggregates, { chars: 10, tokens: 2 }, 'a run with no thinking event reads exactly as it did before this change');
    t.store.appendAggregate('b', { chars: 10, tokens: 2, thinkingChars: 0 });
    h.eq(t.store.get('b')![0].aggregates, { chars: 10, tokens: 2 }, 'an explicit zero is treated the same as absent — never written');
  });

  await h.test('run-journal: a journal written before build-liveness (no thinkingChars key at all) still parses', async () => {
    // Hand-crafted, the way a pre-existing on-device journal would actually look: no `thinkingChars`
    // key anywhere, because the field did not exist yet when it was written.
    const map = new Map<string, string>([
      ['journal:legacy', JSON.stringify([{ t: 1, kind: 'aggregate', aggregates: { chars: 40, tokens: 8 } }])],
    ]);
    const { store } = makeStore(map);
    const entries = store.get('legacy')!;
    h.eq(entries.length, 1, 'the legacy entry reads back at all');
    h.eq(entries[0].aggregates, { chars: 40, tokens: 8 }, 'exactly as it was written, with no field invented');
  });

  await h.test('run-journal: the terminal flush carries thinkingChars only when the run actually thought', async () => {
    const t = makeStore();
    t.store.appendTerminal('a', { aggregates: { chars: 500, tokens: 40, thinkingChars: 12_000 }, observedDiagnostics: 0 });
    h.eq(t.store.get('a')![0].aggregates, { chars: 500, tokens: 40, thinkingChars: 12_000 }, 'the flush carries all three counts');
    t.store.appendTerminal('b', { aggregates: { chars: 500, tokens: 40 }, observedDiagnostics: 0 });
    h.eq(t.store.get('b')![0].aggregates, { chars: 500, tokens: 40 }, 'and omits it entirely when the run never thought');
  });

  // ── terminal entries ────────────────────────────────────────────────────────
  await h.test('run-journal: a terminal entry is written immediately even inside the aggregate throttle window', async () => {
    const t = makeStore();
    t.at(0);
    t.store.appendAggregate('a', { chars: 10, tokens: 2 });
    t.at(200); // deep inside the ~5s window an aggregate would be dropped in
    t.store.appendTerminal('a', { failure: { reason: 'the code would not run' } });
    h.eq(kinds(t.store.get('a')), ['aggregate', 'terminal'], 'the terminal entry bypasses the throttle');
    h.eq(t.store.get('a')![1].t, 200, 'and is stamped at the instant the stream ended');
  });

  await h.test('run-journal: a success terminal entry carries no failure field', async () => {
    const t = makeStore();
    t.store.appendTerminal('a');
    const entry = t.store.get('a')![0];
    h.eq(entry.kind, 'terminal', 'kind is terminal');
    h.ok(entry.failure === undefined, 'no failure field on a result terminal');
  });

  await h.test('run-journal: a failure terminal entry keeps reason + hints and drops kind/symbol/message', async () => {
    const t = makeStore();
    // A caller handing over richer diagnostic objects must not be able to leak their internals.
    const leaky = [
      { hint: 'a name is used before it exists', kind: 'error', symbol: 'total', message: 'TS2304: Cannot find name' },
      { hint: 'the app never rendered', kind: 'runtime', symbol: 'App', message: 'undefined is not a function' },
    ] as unknown as readonly { hint: string }[];
    t.store.appendTerminal('a', { failure: { reason: 'the code would not run', diagnostics: leaky } });
    const failure = t.store.get('a')![0].failure!;
    h.eq(failure.reason, 'the code would not run', 'the reason is kept');
    h.eq(failure.diagnostics, [{ hint: 'a name is used before it exists' }, { hint: 'the app never rendered' }], 'only hints survive');
    const stored = JSON.stringify(t.store.get('a'));
    h.ok(!stored.includes('TS2304') && !stored.includes('undefined is not a function'), 'no raw message reaches storage');
    h.ok(!stored.includes('symbol') && !stored.includes('"kind":"error"'), 'no diagnostic kind or symbol reaches storage');
  });

  // ── the end-of-stream flush: no window goes unclosed (design D3) ────────────

  await h.test('run-journal: the entry that closes a window carries the LATEST counts observed in it', async () => {
    const t = makeStore();
    t.at(0);
    // A steady stream: one arrival every 500ms, cumulative counts growing 10 chars per arrival.
    for (let i = 1; i <= 24; i++) {
      t.at(i * 500);
      t.store.appendAggregate('a', { chars: i * 10, tokens: i });
    }
    const aggregates = t.store.get('a')!.filter((e) => e.kind === 'aggregate');
    h.eq(aggregates.map((e) => e.t), [500, 5_500, 10_500], 'one entry per ~5s window, not one per arrival');
    // Each entry's counts must be the newest ones seen up to its own instant, never an earlier
    // reading held over from the moment the window opened.
    for (const entry of aggregates) {
      h.eq(
        entry.aggregates,
        { chars: (entry.t / 500) * 10, tokens: entry.t / 500 },
        `the entry closing at ${entry.t} carries the counts as of ${entry.t}, not a stale earlier reading`,
      );
    }
  });

  await h.test('run-journal: the terminal entry closes the LAST window, so the final counts are never lost', async () => {
    const t = makeStore();
    t.at(0);
    // 12 seconds of stream: the last aggregate entry lands at 10s, and everything after it would
    // be silently unpersisted without the flush (the reviewer's 20020-vs-24000 case).
    for (let i = 1; i <= 24; i++) {
      t.at(i * 500);
      t.store.appendAggregate('a', { chars: i * 1000, tokens: i * 50 });
    }
    const lastAggregate = t.store.get('a')!.filter((e) => e.kind === 'aggregate').at(-1)!;
    h.eq(lastAggregate.aggregates, { chars: 21_000, tokens: 1_050 }, 'the newest aggregate entry is already stale by design');
    t.at(12_000);
    t.store.appendTerminal('a', { aggregates: { chars: 24_000, tokens: 1_200 }, observedDiagnostics: 0 });
    const entry = t.store.get('a')!.at(-1)!;
    h.eq(entry.kind, 'terminal', 'the flush rides on the terminal entry, not a second aggregate');
    h.eq(entry.aggregates, { chars: 24_000, tokens: 1_200 }, 'carrying the run’s TRUE final counts');
  });

  await h.test('run-journal: a run shorter than the throttle window still ends with its true final counts', async () => {
    const t = makeStore();
    t.at(0);
    t.store.create('a');
    for (let i = 1; i <= 30; i++) {
      t.at(i * 50); // 1.5s of stream — the throttle window never closes
      t.store.appendAggregate('a', { chars: i * 4, tokens: i });
    }
    t.at(1_600);
    t.store.appendTerminal('a', { aggregates: { chars: 120, tokens: 30 }, observedDiagnostics: 2 });
    const journal = t.store.get('a')!;
    h.eq(journal.filter((e) => e.kind === 'aggregate').length, 1, 'a sub-window run still writes no per-token entries');
    h.eq(journal.at(-1)!.aggregates, { chars: 120, tokens: 30 }, 'and the terminal entry carries everything the aggregate could not');
    h.eq(journal.at(-1)!.observedDiagnostics, 2, 'along with how many diagnostics went past');
  });

  await h.test('run-journal: the flush is still counts only — no token text, no diagnostic content', async () => {
    const t = makeStore();
    const leaky = {
      aggregates: { chars: 10, tokens: 2, text: 'const total = 1' },
      observedDiagnostics: 3,
    } as unknown as { aggregates: { chars: number; tokens: number }; observedDiagnostics: number };
    t.store.appendTerminal('a', leaky);
    const entry = t.store.get('a')![0];
    h.eq(
      Object.keys(entry.aggregates!).sort((a, b) => a.localeCompare(b)),
      ['chars', 'tokens'],
      'the flushed counts are re-projected to the two numbers, so a richer caller object cannot widen them',
    );
    h.eq(typeof entry.observedDiagnostics, 'number', 'the diagnostics figure is a count');
    h.ok(!JSON.stringify(t.store.get('a')).includes('const total'), 'no token text reaches storage through the flush');

    // All THREE figures are coerced, not just one: a caller handing over a stringy count must not
    // leave one field a number and its sibling a string for a consumer to trip over.
    const stringy = {
      aggregates: { chars: '120', tokens: '30' },
      observedDiagnostics: '2',
    } as unknown as { aggregates: { chars: number; tokens: number }; observedDiagnostics: number };
    t.store.appendTerminal('b', stringy);
    const coerced = t.store.get('b')![0];
    h.eq(typeof coerced.aggregates!.chars, 'number', 'chars is stored as a number');
    h.eq(typeof coerced.aggregates!.tokens, 'number', 'so is tokens');
    h.eq(typeof coerced.observedDiagnostics, 'number', 'and so is the diagnostics count');
    h.eq(coerced.aggregates, { chars: 120, tokens: 30 }, 'with their values intact');
  });

  await h.test('run-journal: a terminal entry with nothing to flush carries no counts at all', async () => {
    const t = makeStore();
    t.store.appendTerminal('a');
    const entry = t.store.get('a')![0];
    h.ok(entry.aggregates === undefined, 'no fabricated zero counts');
    h.ok(entry.observedDiagnostics === undefined, 'and no fabricated diagnostics figure');
  });

  // ── cap and eviction ────────────────────────────────────────────────────────
  await h.test('run-journal: the oldest aggregate is evicted to make room; the journal stays at the cap', async () => {
    const t = makeStore();
    t.at(0);
    // Fill to the cap with aggregates, one per window so none is throttled away.
    for (let i = 1; i <= JOURNAL_ENTRY_CAP; i++) {
      t.at(i * AGGREGATE_THROTTLE_MS);
      t.store.appendAggregate('a', { chars: i, tokens: i });
    }
    h.eq(t.store.get('a')!.length, JOURNAL_ENTRY_CAP, 'the journal fills exactly to the cap');
    const oldest = t.store.get('a')![0];
    t.at((JOURNAL_ENTRY_CAP + 1) * AGGREGATE_THROTTLE_MS);
    t.store.appendAggregate('a', { chars: 999, tokens: 999 });
    const after = t.store.get('a')!;
    h.eq(after.length, JOURNAL_ENTRY_CAP, 'size stays at the cap');
    h.ok(!after.some((e) => e.t === oldest.t), 'the OLDEST aggregate is the one dropped');
    h.eq(after[after.length - 1].aggregates, { chars: 999, tokens: 999 }, 'the new entry is appended');
  });

  await h.test('run-journal: a stage entry evicts an aggregate rather than the oldest entry outright', async () => {
    const t = makeStore();
    t.at(0);
    t.store.appendStage('a', 'plan');
    for (let i = 1; i < JOURNAL_ENTRY_CAP; i++) {
      t.at(i * AGGREGATE_THROTTLE_MS);
      t.store.appendAggregate('a', { chars: i, tokens: i });
    }
    h.eq(t.store.get('a')!.length, JOURNAL_ENTRY_CAP, 'at the cap, first entry a stage');
    t.store.appendStage('a', 'generate');
    const after = t.store.get('a')!;
    h.eq(after.length, JOURNAL_ENTRY_CAP, 'still at the cap');
    h.eq(after.filter((e) => e.kind === 'stage').map((e) => e.stage), ['plan', 'generate'], 'the leading stage entry survived; an aggregate went instead');
  });

  await h.test('run-journal: stage and terminal entries are never evicted, even at the cap', async () => {
    const t = makeStore();
    for (let i = 0; i < JOURNAL_ENTRY_CAP; i++) {
      t.at(i);
      t.store.appendStage('a', 'repair');
    }
    t.at(JOURNAL_ENTRY_CAP);
    t.store.appendStage('a', 'run');
    const after = t.store.get('a')!;
    h.eq(after.filter((e) => e.kind === 'stage').length, JOURNAL_ENTRY_CAP + 1, 'no stage entry was dropped to honour the cap');
    t.at(JOURNAL_ENTRY_CAP + 1);
    t.store.appendTerminal('a', { failure: { reason: 'gave up repairing' } });
    h.eq(t.store.get('a')!.filter((e) => e.kind === 'terminal').length, 1, 'and the terminal entry still lands');
  });

  // ── moveToLastRun ───────────────────────────────────────────────────────────
  await h.test('run-journal: moveToLastRun republishes the journal at lastrun:<appId> and drops the source key', async () => {
    const t = makeStore();
    t.at(5);
    t.store.appendStage('attempt-1', 'plan');
    t.at(6);
    t.store.appendTerminal('attempt-1');
    const before = t.store.get('attempt-1');
    t.store.moveToLastRun('attempt-1', 'attempt-1');
    h.eq(t.store.getLastRun('attempt-1'), before, 'the journal is readable at the last-run key, byte for byte');
    h.eq(t.store.get('attempt-1'), null, 'and journal:<launcherId> no longer exists');
    h.ok(!t.map.has('journal:attempt-1'), 'the source key is gone from the backend, not merely emptied');
  });

  await h.test('run-journal: a rebuild overwrites the previous last-run report', async () => {
    const t = makeStore();
    t.at(1);
    t.store.appendStage('app-1', 'plan');
    t.store.moveToLastRun('app-1', 'app-1');
    t.at(2);
    t.store.appendStage('app-1', 'generate');
    t.at(3);
    t.store.appendStage('app-1', 'check');
    t.store.moveToLastRun('app-1', 'app-1');
    const report = t.store.getLastRun('app-1')!;
    h.eq(report.map((e) => e.stage), ['generate', 'check'], 'only the newer run survives; the prior report is gone');
  });

  await h.test('run-journal: moving an absent journal leaves any prior report untouched', async () => {
    const t = makeStore();
    t.at(1);
    t.store.appendStage('app-1', 'plan');
    t.store.moveToLastRun('app-1', 'app-1');
    const kept = t.store.getLastRun('app-1');
    t.store.moveToLastRun('app-1', 'app-1'); // nothing at the source this time
    h.eq(t.store.getLastRun('app-1'), kept, 'the last-run report is neither emptied nor fabricated');
  });

  await h.test('run-journal: deleting an app reclaims its last-run report, and only its own', async () => {
    const t = makeStore();
    t.at(1);
    t.store.appendStage('app-1', 'plan');
    t.store.moveToLastRun('app-1', 'app-1');
    t.store.appendStage('app-2', 'generate');
    t.store.moveToLastRun('app-2', 'app-2');
    h.ok(t.map.has('lastrun:app-1'), 'the report exists before the deletion (the assertion is non-vacuous)');
    t.store.deleteLastRun('app-1');
    h.eq(t.store.getLastRun('app-1'), null, 'the deleted app’s report is gone');
    h.ok(!t.map.has('lastrun:app-1'), 'the key itself is reclaimed, not merely emptied');
    h.ok(t.store.getLastRun('app-2') !== null, 'another app’s report is untouched');
    t.store.deleteLastRun('app-1'); // must not throw
    h.eq(t.store.getLastRun('app-1'), null, 'deleting a report that was never there is a tolerated no-op');
  });

  // ── failure survival + delete ───────────────────────────────────────────────
  await h.test('run-journal: a failed run’s journal stays readable at journal:<launcherId>', async () => {
    const t = makeStore();
    t.store.create('ghost-1');
    t.store.appendStage('ghost-1', 'check');
    t.store.appendTerminal('ghost-1', { failure: { reason: 'it did not run' } });
    h.eq(kinds(t.store.get('ghost-1')), ['stage', 'terminal'], 'the journal survives the failure for the failure screen');
  });

  await h.test('run-journal: delete removes the journal; deleting an absent one is a tolerated no-op', async () => {
    const t = makeStore();
    t.store.create('ghost-1');
    t.store.appendStage('ghost-1', 'plan');
    t.store.delete('ghost-1');
    h.eq(t.store.get('ghost-1'), null, 'dismissing the ghost removes its journal');
    h.ok(!t.map.has('journal:ghost-1'), 'the key itself is gone');
    t.store.delete('ghost-1'); // must not throw
    h.eq(t.store.get('ghost-1'), null, 'deleting again changes nothing');
  });

  await h.test('run-journal: journals of different attempts are independent', async () => {
    const t = makeStore();
    t.store.appendStage('a', 'plan');
    t.store.appendStage('b', 'generate');
    t.store.delete('a');
    h.eq(t.store.get('b')!.map((e) => e.stage), ['generate'], 'one attempt’s delete never touches another’s journal');
  });

  await h.test('run-journal: a store re-instantiated mid-attempt keeps appending to the same journal', async () => {
    const map = new Map<string, string>();
    const first = makeStore(map);
    first.at(0);
    first.store.appendStage('a', 'plan');
    first.store.appendAggregate('a', { chars: 5, tokens: 1 });
    const second = makeStore(map);
    second.at(100); // still inside the throttle window the first store opened
    second.store.appendAggregate('a', { chars: 9, tokens: 2 });
    h.eq(kinds(second.store.get('a')), ['stage', 'aggregate'], 'the throttle is derived from the journal, so it survives re-instantiation');
    second.at(AGGREGATE_THROTTLE_MS + 1);
    second.store.appendAggregate('a', { chars: 12, tokens: 3 });
    h.eq(kinds(second.store.get('a')), ['stage', 'aggregate', 'aggregate'], 'and reopens on time');
  });
}
