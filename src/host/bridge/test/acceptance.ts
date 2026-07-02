/**
 * Node acceptance for the capability-bridge host core (Decision #41, D8 — TDD per §16.2). Pure
 * logic with a fake transport (we call `dispatcher.handle(frame)` directly and read the
 * returned `sysret`) and the REAL storage engine over a `:memory:` DB. Green here is the cheap
 * checkpoint; the invariant suite (browser, hostile bundle over the real sandbox→syscall path)
 * and the on-device run are the acceptance.
 *
 * Sections:
 *   §A  registry — append-only rules (D5)
 *   §B  gate — fixed order + every denial kind (D4), structured fix-hints
 *   §C  dispatcher — correlation, idempotent delivery, generation fences (D3)
 *   §D  channel-derived identity — the API admits no cross-app expression (D2)
 *   §E  storage round-trip + the "second capability is one row" proof
 *   §F  ★ END-TO-END INJECTION ★ — adversarial input over the bridge stays inert (D8; §16.4)
 *   §G  cues — syscall #2/#3 gated, fire-and-forget, at-most-once (effects-and-cues D5/D7)
 */

import { createEngine } from '../../storage-engine/engine';
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { SchemaArtifact, StorageEngine } from '../../storage-engine/contract';
import {
  AppRecord,
  CapabilityRegistry,
  createDefaultRegistry,
  CueBackend,
  Dispatcher,
  launchApp,
  RealmRecord,
  registerStorageRows,
  resetRealmGeneration,
  SyscallError,
  SyscallFrame,
  SysretFrame,
} from '../index';

// ── tiny harness (the storage:test idiom) ─────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failures.push(msg);
    console.error('  ✗ ' + msg);
  }
}
function eq(a: unknown, b: unknown, msg: string): void {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('• ' + name);
  } catch (err) {
    failures.push(`${name}: threw ${(err as Error).message}`);
    console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
  }
}

// ── fixtures ───────────────────────────────────────────────────────────────────

const notesSchema: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, n: { id: 'f2', type: 'int' } } },
  },
};

function storageApp(appId: string, capabilities: string[] = ['storage'], schema = notesSchema): AppRecord {
  return { appId, name: appId, manifest: { capabilities }, schemaArtifact: capabilities.includes('storage') ? schema : undefined };
}

/** A `:memory:` engine factory (the device passes createStorageEngine; tests pass this). */
const memFactory = (): StorageEngine => createEngine(createNodeSqlExecutor(':memory:'));

/** Launch an app to a realm (engine opened) + a dispatcher; throws if the launch is refused. */
function bring(app: AppRecord, registry: CapabilityRegistry, permissionHook?: Parameters<typeof Dispatcher.forRealm>[2]): { realm: RealmRecord; d: Dispatcher } {
  const launched = launchApp(app, memFactory);
  if (!launched.ok) throw new Error('launch refused: ' + launched.error.hint);
  return { realm: launched.realm, d: Dispatcher.forRealm(launched.realm, registry, permissionHook) };
}

/** A recording fake `CueBackend` (effects-and-cues D5/D9): every cue the host triggers is
 *  logged as `"<method>:<token>"`, so the deterministic suite asserts WHEN the backend is (and
 *  is not) invoked — no React Native loaded, no real device. */
function recordingBackend(): { backend: CueBackend; log: string[] } {
  const log: string[] = [];
  return {
    log,
    backend: {
      haptic: (kind) => { log.push('haptic:' + kind); },
      sound: (name) => { log.push('sound:' + name); },
    },
  };
}

let SEQ = 0;
function frame(method: string, params: Record<string, unknown>, gen = 1, id?: number, extra: Record<string, unknown> = {}): SyscallFrame {
  return { whim: 'syscall', v: 1, id: id ?? ++SEQ, gen, method, params, ...extra } as unknown as SyscallFrame;
}
async function send(d: Dispatcher, f: SyscallFrame | object): Promise<SysretFrame | null> {
  return d.handle(f);
}
async function callOk(d: Dispatcher, method: string, params: Record<string, unknown>): Promise<JsonValueLike> {
  const s = await send(d, frame(method, params));
  if (!s || !s.ok) throw new Error(`expected ok sysret for ${method}, got ${JSON.stringify(s)}`);
  return s.result as JsonValueLike;
}
async function callErr(d: Dispatcher, method: string, params: Record<string, unknown>): Promise<SyscallError> {
  const s = await send(d, frame(method, params));
  if (!s || s.ok) throw new Error(`expected error sysret for ${method}, got ${JSON.stringify(s)}`);
  return s.error as SyscallError;
}
type JsonValueLike = any;

// ═══════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  // ── §A registry append-only (D5) ───────────────────────────────────────────
  await test('§A duplicate registration is a startup error (append-only, no override)', () => {
    const reg = new CapabilityRegistry();
    registerStorageRows(reg);
    let threw = false;
    try { reg.register('storage.kv.get', { capability: 'storage', paramsSchema: () => null, handler: () => ({}) }); } catch { threw = true; }
    ok(threw, 'registering an existing method must throw');
    ok(reg.has('storage.records.append'), 'rows are registered');
    eq(reg.methods().filter(m => m.startsWith('storage.')).sort((a, b) => a.localeCompare(b)), [
      'storage.kv.get', 'storage.kv.remove', 'storage.kv.set',
      'storage.records.append', 'storage.records.list', 'storage.records.remove', 'storage.records.update',
    ], 'the storage rows are exactly the seven verbs');
  });

  // ── §B gate — fixed order + every denial kind (D4) ──────────────────────────
  await test('§B unknown method → unknown_method with a hint', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    const e = await callErr(d, 'storage.kv.nope', { key: 'k' });
    eq(e.kind, 'unknown_method', 'kind');
    ok(typeof e.hint === 'string' && e.hint.length > 0, 'carries a hint');
  });

  await test('§B undeclared capability → undeclared_capability, before any handler runs', async () => {
    const reg = createDefaultRegistry();
    const { realm, d } = bring(storageApp('a', []), reg); // declares nothing
    ok(realm.engine === null, 'a no-storage app opens no engine');
    const e = await callErr(d, 'storage.kv.set', { key: 'k', value: 1 });
    eq(e.kind, 'undeclared_capability', 'kind');
    eq((e as { capability?: string }).capability, 'storage', 'names the missing capability');
    ok(/defineApp/.test(e.hint), 'hint points at the defineApp declaration');
  });

  await test('§B a self-declared manifest gates nothing — only the host-held manifest counts', async () => {
    const reg = createDefaultRegistry();
    // Host-held manifest = [] even though a hostile bundle might "claim" storage at runtime.
    const { d } = bring(storageApp('a', []), reg);
    // A frame cannot carry capabilities; even if it did, the gate reads realm.manifest only.
    const e = await callErr(d, 'storage.kv.set', { key: 'k', value: 1, capabilities: ['storage'] } as Record<string, unknown>);
    eq(e.kind, 'undeclared_capability', 'a bundle-side capability claim does not move the gate');
  });

  await test('§B permission hook denial → permission_denied (the seam for later capabilities)', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg, () => false);
    const e = await callErr(d, 'storage.kv.set', { key: 'k', value: 1 });
    eq(e.kind, 'permission_denied', 'kind');
  });

  await test('§B bad params → invalid_params (gate step 4, after cap + permission)', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    const e1 = await callErr(d, 'storage.kv.set', { key: 'k' }); // missing value
    eq(e1.kind, 'invalid_params', 'missing value');
    const e2 = await callErr(d, 'storage.records.append', { collection: 'Notes' }); // missing record
    eq(e2.kind, 'invalid_params', 'missing record');
  });

  await test('§B gate ORDER: an undeclared cap on an unregistered method still reports unknown_method first', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a', []), reg);
    const e = await callErr(d, 'no.such.method', {});
    eq(e.kind, 'unknown_method', 'registration is checked before capability');
  });

  // ── §C dispatcher — correlation, dedup, generation fences (D3) ──────────────
  await test('§C correlation: the sysret echoes the request id', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    const s = await send(d, frame('storage.kv.set', { key: 'k', value: 1 }, 1, 4242));
    ok(!!s && s.id === 4242 && s.ok === true, 'id echoed, ok=true');
  });

  await test('§C idempotent delivery: a retried append (same id+gen) does not double-append', async () => {
    const reg = createDefaultRegistry();
    const { realm, d } = bring(storageApp('a'), reg);
    const f = frame('storage.records.append', { collection: 'Notes', record: { body: 'once', n: 1 } }, 1, 7001);
    const s1 = await send(d, f);
    const s2 = await send(d, f); // same frame again
    eq(s1, s2, 'both deliveries observe the identical recorded outcome');
    eq(realm.engine!.records.list('Notes').length, 1, 'exactly one record exists');
  });

  await test('§C a stale-generation frame is dropped (no sysret)', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg); // realm.generation = 1
    const s = await send(d, frame('storage.kv.set', { key: 'k', value: 1 }, 0)); // gen 0 ≠ 1
    eq(s, null, 'a frame stamped with a prior generation is dropped');
  });

  await test('§C a late result completing after realm reset is discarded (not delivered)', async () => {
    const reg = createDefaultRegistry();
    let release: (() => void) | null = null;
    reg.register('test.slow', {
      capability: 'test',
      paramsSchema: () => null,
      handler: () => new Promise<Record<string, never>>((res) => { release = () => res({}); }),
    });
    const { realm, d } = bring(storageApp('a', ['test']), reg);
    const inflight = send(d, frame('test.slow', {}, 1, 9001)); // gen 1, do not await yet
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 0)); // until the handler is entered
    ok(!!release, 'the slow handler started');
    resetRealmGeneration(realm); // generation → 2 while the handler is in flight
    release!();
    const s = await inflight;
    eq(s, null, 'the old generation’s late result is discarded, never delivered into the successor');
  });

  await test('§C malformed envelope (correlatable) → malformed_envelope; control frames are ignored', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    const bad = await send(d, { whim: 'syscall', v: 1, id: 5, gen: 1 }); // no method
    ok(!!bad && !bad.ok && (bad.error as SyscallError).kind === 'malformed_envelope', 'missing method → malformed_envelope');
    const control = await send(d, { __whimHarness: true, kind: 'probes' });
    eq(control, null, 'a control frame is not the dispatcher’s family → dropped');
    const sysret = await send(d, { whim: 'sysret', v: 1, id: 1, ok: true });
    eq(sysret, null, 'a sysret frame is not a syscall → dropped');
  });

  // ── §D channel-derived identity (D2) ────────────────────────────────────────
  await test('§D a cross-app request is inexpressible — extra fields hit only the bound store', async () => {
    const reg = createDefaultRegistry();
    const A = bring(storageApp('app-a'), reg);
    const B = bring(storageApp('app-b'), reg);
    // Dispatcher A gets a frame with forged cross-app addressing fields naming app-b.
    const f = frame('storage.records.append', { collection: 'Notes', record: { body: 'A-write', n: 1 } }, 1, undefined, {
      appId: 'app-b', dbPath: 'storage/app-b.db', realm: 'app-b',
    });
    const s = await send(A.d, f);
    ok(!!s && s.ok, 'the call executes (against A’s own bound engine)');
    eq(A.realm.engine!.records.list('Notes').map(r => r.body), ['A-write'], 'A’s store got the write');
    eq(B.realm.engine!.records.list('Notes').length, 0, 'B’s store is untouched — the extra fields had no effect');
  });

  await test('§D the SyscallFrame surface carries no app addressing field', async () => {
    // A compile-time guarantee (SyscallFrame = {whim,v,id,gen,method,params}) restated at runtime:
    const f = frame('storage.kv.get', { key: 'k' });
    eq(Object.keys(f).sort((a, b) => a.localeCompare(b)), ['gen', 'id', 'method', 'params', 'v', 'whim'], 'the envelope has no appId/store/realm field');
  });

  // ── §E storage round-trip + the second-capability proof ─────────────────────
  await test('§E storage verbs round-trip through the bridge', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    eq(await callOk(d, 'storage.kv.get', { key: 'missing' }), { found: false, value: null }, 'absent key');
    await callOk(d, 'storage.kv.set', { key: 'theme', value: 'dark' });
    eq(await callOk(d, 'storage.kv.get', { key: 'theme' }), { found: true, value: 'dark' }, 'kv round-trip');
    const appended = await callOk(d, 'storage.records.append', { collection: 'Notes', record: { body: 'hi', n: 2 } });
    ok(typeof appended.id === 'number' && appended.id > 0, 'append returns an id');
    const listed = await callOk(d, 'storage.records.list', { collection: 'Notes' });
    eq(listed.records.map((r: JsonValueLike) => r.body), ['hi'], 'list round-trip');
  });

  await test('§E a second capability is one row + one stub — diag.echo is callable through the same pipe', async () => {
    const reg = createDefaultRegistry(); // already includes diag (the second-row proof)
    const { d } = bring(storageApp('a', ['storage', 'diag']), reg);
    eq(await callOk(d, 'diag.echo', { payload: { hi: 1 } }), { echo: { hi: 1 } }, 'diag dispatches with no transport/dispatcher change');
    // … and it is gated like any capability: an app that does not declare `diag` is denied.
    const { d: d2 } = bring(storageApp('b', ['storage']), reg);
    eq((await callErr(d2, 'diag.echo', {})).kind, 'undeclared_capability', 'diag is gated like storage');
  });

  await test('§E launch refuses a conflict-class schema BEFORE the bundle would run (D7)', async () => {
    // Open v1 on a persistent-shaped engine, then re-launch with a type-changed schema.
    const sharedEngine = createEngine(createNodeSqlExecutor(':memory:'));
    sharedEngine.open(notesSchema);
    const conflict: SchemaArtifact = {
      schemaVersion: 1,
      collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'int' }, n: { id: 'f2', type: 'int' } } } },
    };
    const launched = launchApp({ appId: 'a', name: 'a', manifest: { capabilities: ['storage'] }, schemaArtifact: conflict }, () => sharedEngine);
    ok(!launched.ok, 'a conflicting open is a structured launch failure');
    if (!launched.ok) eq(launched.error.kind, 'type_change', 'the engine’s structured conflict surfaces as the launch error');
  });

  // ── §F end-to-end injection over the bridge (D8/§16.4) ──────────────────────
  const ADVERSARIAL = [`'); DROP TABLE c1;--`, `" OR "1"="1`, `'; DELETE FROM kv; --`, `Robert'); DROP TABLE students;--`];

  await test('§F adversarial VALUES round-trip byte-identical through the syscall path', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    for (const evil of ADVERSARIAL) {
      const { id } = await callOk(d, 'storage.records.append', { collection: 'Notes', record: { body: evil, n: 1 } });
      const back = await callOk(d, 'storage.records.list', { collection: 'Notes', query: { where: { body: evil } } });
      eq(back.records.length, 1, `the literal matches itself (${JSON.stringify(evil)})`);
      eq(back.records[0].body, evil, 'value round-trips byte-identical');
      await callOk(d, 'storage.records.remove', { collection: 'Notes', id });
      await callOk(d, 'storage.kv.set', { key: evil, value: evil });
      eq((await callOk(d, 'storage.kv.get', { key: evil })).value, evil, 'adversarial kv key+value round-trips');
    }
  });

  await test('§F crafted IDENTIFIERS are rejected as structured errors over the bridge', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a'), reg);
    for (const evil of ADVERSARIAL) {
      eq((await callErr(d, 'storage.records.append', { collection: evil, record: { body: 'x' } })).kind, 'unknown_collection', 'crafted collection');
      eq((await callErr(d, 'storage.records.append', { collection: 'Notes', record: { [evil]: 1 } })).kind, 'unknown_field', 'crafted append field');
      eq((await callErr(d, 'storage.records.list', { collection: 'Notes', query: { where: { [evil]: 1 } } })).kind, 'unknown_field', 'crafted where field');
      eq((await callErr(d, 'storage.records.list', { collection: 'Notes', query: { orderBy: { field: evil, direction: 'asc' } } })).kind, 'unknown_field', 'crafted orderBy field');
    }
  });

  // ── §G cues — syscall #2/#3 against a recording fake (effects-and-cues D5/D7/D9) ──
  // The append-only readiness test: haptics + sound are two rows + two stubs, gate-denied like
  // any capability, fire-and-forget, at-most-once. Maps 1:1 to test-spec.md §1 (G1–G9).

  await test('§G1 cue rows are exactly two appended rows; registry stays append-only', () => {
    const { backend } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    ok(reg.has('cues.haptic') && reg.has('cues.sound'), 'both cue rows registered');
    eq(reg.methods().filter((m) => m.startsWith('cues.')).sort((a, b) => a.localeCompare(b)), ['cues.haptic', 'cues.sound'], 'exactly the two cue rows, nothing else new');
    let threw = false;
    try { reg.register('cues.haptic', { capability: 'cues', paramsSchema: () => null, handler: () => ({}) }); } catch { threw = true; }
    ok(threw, 'a duplicate cue registration throws at startup (append-only — no override)');
  });

  await test('§G2 an undeclared `cues` is denied with a fix hint; the backend never fires', async () => {
    const { backend, log } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    const { d } = bring(storageApp('a', []), reg); // declares no cues
    const e = await callErr(d, 'cues.haptic', { kind: 'double' });
    eq(e.kind, 'undeclared_capability', 'kind');
    eq((e as { capability?: string }).capability, 'cues', 'names the missing capability');
    ok(/defineApp/.test(e.hint), 'hint points at the defineApp declaration');
    eq(log.length, 0, 'a denied cue never reaches the backend');
  });

  await test('§G3 an off-set token → invalid_params whose hint enumerates the valid tokens', async () => {
    const { backend, log } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    const { d } = bring(storageApp('a', ['cues']), reg);
    const eSound = await callErr(d, 'cues.sound', { name: 'boom' });
    eq(eSound.kind, 'invalid_params', 'an off-set sound name is invalid_params');
    for (const tok of ['tick', 'chime', 'alarm']) ok(eSound.hint.includes(tok), `the sound hint lists "${tok}"`);
    const eHaptic = await callErr(d, 'cues.haptic', { kind: 'wiggle' });
    eq(eHaptic.kind, 'invalid_params', 'an off-set haptic kind is invalid_params');
    for (const tok of ['tap', 'double', 'heavy']) ok(eHaptic.hint.includes(tok), `the haptic hint lists "${tok}"`);
    const eMissing = await callErr(d, 'cues.haptic', {});
    eq(eMissing.kind, 'invalid_params', 'a missing token is invalid_params too');
    eq(log.length, 0, 'no backend call on invalid params');
  });

  await test('§G4 a valid cue invokes the backend exactly once and resolves {} (fire-and-forget)', async () => {
    const { backend, log } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    const { d } = bring(storageApp('a', ['cues']), reg);
    eq(await callOk(d, 'cues.haptic', { kind: 'double' }), {}, 'haptic resolves an empty result — nothing observable');
    eq(await callOk(d, 'cues.sound', { name: 'chime' }), {}, 'sound resolves an empty result');
    eq(log, ['haptic:double', 'sound:chime'], 'the backend was invoked once each, with the requested tokens');
  });

  await test('§G5 a deduped retry does not double-buzz (backend invoked exactly once)', async () => {
    const { backend, log } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    const { d } = bring(storageApp('a', ['cues']), reg);
    const f = frame('cues.haptic', { kind: 'heavy' }, 1, 8800);
    const s1 = await send(d, f);
    const s2 = await send(d, f); // same id+gen
    eq(s1, s2, 'both deliveries observe the identical recorded outcome');
    eq(log, ['haptic:heavy'], 'the cue fired exactly once across the retry (at-most-once per request id)');
  });

  await test('§G6 a stale-generation cue frame is dropped and fires nothing', async () => {
    const { backend, log } = recordingBackend();
    const reg = createDefaultRegistry({ cueBackend: backend });
    const { d } = bring(storageApp('a', ['cues']), reg); // realm.generation = 1
    const s = await send(d, frame('cues.sound', { name: 'alarm' }, 0)); // gen 0 ≠ 1
    eq(s, null, 'a cue stamped with a prior generation is dropped');
    eq(log.length, 0, 'a cue from a torn-down/old realm never reaches the device');
  });

  await test('§G7 a declared cue with NO backend → structured handler_error, not a crash', async () => {
    const reg = createDefaultRegistry(); // no cueBackend injected
    ok(reg.has('cues.haptic'), 'cue rows register even backend-less (so denials stay testable)');
    const { d } = bring(storageApp('a', ['cues']), reg);
    const e = await callErr(d, 'cues.haptic', { kind: 'tap' });
    eq(e.kind, 'handler_error', 'a missing backend is a structured handler error, never an unshaped throw');
    ok(/backend|unavailable/i.test(e.hint), 'the hint explains the cue backend is unavailable');
  });

  await test('§G8 gate ORDER holds: an unregistered cue-ish method reports unknown_method first', async () => {
    const reg = createDefaultRegistry();
    const { d } = bring(storageApp('a', []), reg); // no cues declared
    const e = await callErr(d, 'cues.flash', {}); // not a registered method
    eq(e.kind, 'unknown_method', 'registration is checked before capability, same fixed order as storage');
  });

  // §G9 (the #41 review rule — cues touch only contract.ts + rows.ts + index.ts, never
  // dispatcher/gate/registry/launch) is a review/`git diff` assertion, recorded in close-out 9.2.

  // ── verdict ────────────────────────────────────────────────────────────────
  console.log('');
  if (failures.length === 0) {
    console.log(`✓ capability-bridge acceptance: ${passed} checks passed`);
  } else {
    console.error(`✗ capability-bridge acceptance: ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
}

main();
