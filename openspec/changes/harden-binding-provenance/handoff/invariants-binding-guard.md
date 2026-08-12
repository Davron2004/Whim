# Contract: chain B — `invariants/` binding provenance (HUMAN-BOOTSTRAP)

Class-2 file, subagent-denied. A human applies the three edits below to
`invariants/sandbox-isolation/bridge/runner.mjs` verbatim — plain `.mjs`, no TS annotations.
Engine read-back call used: `host.realm.engine.kv.get(key)` — `Host.realm: RealmRecord`
(`host-shim.ts:47`) → `RealmRecord.engine: StorageEngine | null` (`src/host/bridge/contract.ts:283`)
→ `kv.get(key): JsonValue | undefined`, sync (`src/host/storage-engine/contract.ts:117`).

## Edit 1 + 2 — `scenario()` (`runner.mjs:65-82`): exposeBinding guard + refusal counter

BEFORE (lines 68-72, unchanged context above and below):

```js
  const host = makeHost(app, opts.manifestOverride);
  const page = await chromiumBrowser.newPage();
  const console_ = [];
  page.on('console', (m) => console_.push(m.text()));
  await page.exposeFunction('whimHostDispatch', host.dispatch);
```

AFTER:

```js
  const host = makeHost(app, opts.manifestOverride);
  const page = await chromiumBrowser.newPage();
  const console_ = [];
  page.on('console', (m) => console_.push(m.text()));
  // `exposeBinding`, never `exposeFunction`: only the former keeps the `{page, frame}` source the
  // browser resolves per call, and only the caller's frame identity separates the ONE legitimate
  // caller — the outer page's relay, which source-verifies `ev.source === iframe.contentWindow`
  // before it calls here — from a syscall frame hand-rolled inside the sandboxed app realm. The
  // NAME is reachable there either way (the raw CDP binding lands on every execution context of
  // the target) and the generation fence cannot help: a hand-rolled `gen:1` frame MATCHES it.
  // Frame identity is browser-derived, so a bundle cannot forge it. A silent `null` is
  // indistinguishable from a no-op, so refusals are COUNTED — else scenario 9 passes vacuously.
  let hostProvenanceRefusals = 0;
  await page.exposeBinding('whimHostDispatch', (source, raw) => {
    // FIRST statement, before any parse or dispatch: no capability runs for an unauthenticated
    // caller. `source.page.mainFrame()` because this exposure is page-level, not context-level.
    // The refusal returns the dispatcher's own "no result" shape (null), never an error string:
    // `deliverBindingResult` evaluates the returned expression back inside the CALLER's realm, so
    // the return value must carry nothing about the guard.
    if (source.frame !== source.page.mainFrame()) { hostProvenanceRefusals += 1; return null; }
    return host.dispatch(raw);
  });
```

BEFORE (line 81, the `scenario()` return):

```js
  return { text, console: console_, extra, host };
```

AFTER (snapshot taken after `opts.evaluate` has run, so scenario 9 sees its own refusals):

```js
  return { text, console: console_, extra, host, hostProvenanceRefusals };
```

## Edit 3 — new scenario 9, inserted after the scenario-8 block (after `runner.mjs:271`) and before `await chromiumBrowser.close();` (`runner.mjs:273`)

```js
// 9. HOST-DISPATCH PROVENANCE — the sandboxed app realm can NAME `whimHostDispatch` (the raw CDP
//    binding lands on every execution context), so the guard must make that name INERT, not
//    absent. A hand-rolled syscall frame from the app frame is refused before dispatch: no sysret,
//    and the write is absent when READ BACK FROM THE REAL ENGINE, not merely absent from a trace.
//    The positive control on the SAME wiring proves the engine and the method are live.
{
  const r = await scenario('host-dispatch-provenance', 'water-counter', {
    evaluate: async (page) => {
      const f = await appFrame(page);
      const hostile = f ? await f.evaluate(async () => {
        const g = globalThis;
        const reachable = typeof g.whimHostDispatch;
        const raw = JSON.stringify({ whim: 'syscall', v: 1, id: 9201, gen: 1, method: 'storage.kv.set', params: { key: 'pwned-by-frame', value: 'yes' } });
        const sysret = reachable === 'function' ? await g.whimHostDispatch(raw) : 'NAME NOT REACHABLE';
        return { isSubordinateRealm: g.top !== g, shimKind: typeof g.__whimSyscall?.call, reachable, sysret };
      }) : null;
      // POSITIVE CONTROL, same wiring, from the MAIN frame — the one legitimate vantage.
      const control = await page.evaluate(async () => globalThis.whimHostDispatch(JSON.stringify({ whim: 'syscall', v: 1, id: 9202, gen: 1, method: 'storage.kv.set', params: { key: 'host-write', value: 'ok' } })));
      return { hostile, control };
    },
  });
  const h = r.extra?.hostile || {};
  const engine = r.host.realm.engine;
  // Non-vacuity triad FIRST: it really is the subordinate realm, the shim being bypassed really is
  // installed, and the name really is reachable — so this tests capability, not naming.
  const nonVacuous = h.isSubordinateRealm === true && h.shimKind === 'function' && h.reachable === 'function';
  const refused = h.sysret === null;
  const notWritten = engine?.kv.get('pwned-by-frame') === undefined;
  const counted = r.hostProvenanceRefusals === 1;
  const controlOk = /"whim":"sysret"/.test(String(r.extra?.control)) && engine?.kv.get('host-write') === 'ok';
  record(nonVacuous && refused && notWritten && counted && controlOk,
    'host-dispatch provenance (sandbox-realm caller inert, main frame still dispatches)',
    `subordinate=${h.isSubordinateRealm} shim-installed=${h.shimKind === 'function'} name-reachable=${h.reachable === 'function'} ` +
    `sysret=${JSON.stringify(h.sysret)} engine-write-absent=${notWritten} refusals=${r.hostProvenanceRefusals} positive-control=${controlOk}`);
}
```

## Verification (both required before this chain is done)

- **Red-check (decision #28 — the suite's non-vacuity is load-bearing).** Neuter only the guard to
  `if (false) { ... }`, re-run `npm run build && npm run bridge:invariants`. Scenario 9 MUST go red
  with a REAL sysret, `engine-write-absent=false` (`kv.get('pwned-by-frame') === 'yes'`) and
  `refusals=0`. A red-check that only flips `refusals` is insufficient — the landing write is the
  vulnerability. Restore the guard.
- **Behaviour preservation.** Scenarios 1, 2, 6, 7, 8 reach the host only via the outer page's relay
  (main frame) — unaffected. Scenario 5 (`runner.mjs:200-213`) calls
  `globalThis.whimHostDispatch` from a bare `page.evaluate` (`:204-208`), which targets the MAIN
  frame and therefore passes the guard; its `stale === null` still means a generation drop rather
  than a provenance refusal, because its `fresh` companion is answered. Scenarios 3, 3b, 4 evaluate
  inside `appFrame` but never touch the binding. Expect: existing checks unchanged, one new PASS.

## Invariants this chain must not break

- The refusal returns `null` — the dispatcher's existing no-result shape. Never an error string,
  never a throw: `deliverBindingResult` evaluates the return expression back inside the caller's
  realm, so any payload is a channel to the sandbox.
- The counter is per-`scenario()` (per page + host), never module-global.
- `invariants/` stays owner-authored (#28): no feature-implementing agent applies this.
