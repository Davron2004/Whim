# capability-bridge — Tasks

## 1. Contract + envelope (D1, D8 latency probe)

- [ ] 1.1 Define the bridge contract types in `src/host/bridge/contract.ts`: syscall/sysret envelope (`whim` discriminator, `v`, `id`, `method`, `params` / `ok`, `result`, `error`), structured gate-error kinds, and the registry-row shape — importing verb/param types from the storage engine's `contract.ts`
- [ ] 1.2 Specify the frame-family rule in code: a single classifier function (`control | syscall | unknown`) shared by host and runtime sides, so neither handler can interpret the other's frames
- [ ] 1.3 Measure a raw round-trip latency baseline on-device (a no-op echo over the existing pipe, before any bridge machinery exists) to anchor the D8 numbers and the timeout default

## 2. Web side: marshalling + SDK storage facade (D6)

- [ ] 2.1 Add the iframe-side syscall marshaller (in `loader.js` or a sibling part assembled by `build/assemble.mjs`): id assignment per generation, Promise correlation map, timeout rejection, host-channel-only response acceptance (forged in-iframe `sysret` frames are inert)
- [ ] 2.2 Add the trusted outer-document relay: forward only `event.source`-verified, JSON-parseable frames between iframe and `ReactNativeWebView` — no handler logic, no new authority
- [ ] 2.3 Implement the `vc-sdk` `storage` facade as typed stubs over the engine contract types (kv + records verbs, Promise per call); audit that nothing reachable from the facade holds more than the transport (constraint #2)
- [ ] 2.4 Extend `defineApp` typing with `schema` and `capabilities`, and have the fixture build step extract both into the fixture's host-side app record (single source of truth — fixtures cannot drift from their declarations)

## 3. Host side: realm registry, dispatcher, gate, capability registry (D2–D5; TDD per §16.2 — tests in group 5 are written first)

- [ ] 3.1 Implement the realm registry: realm record `{appId, manifest, schemaArtifact, engineHandle, generation}` bound at creation, keyed by WebView/realm instance; no lookup path takes an app identifier from message content
- [ ] 3.2 Implement the dispatcher: envelope validation, request-ID dedup (bounded LRU per realm generation, outcome replay), generation fences (stale-frame drop, late-result discard on teardown)
- [ ] 3.3 Implement the gate in fixed order — registered → capability ∈ host-held manifest → permission hook (pass-through) → params shape — returning structured fix-hint errors for each failure class
- [ ] 3.4 Implement the append-only capability registry: `register(method, {capability, paramsSchema, handler})`, duplicate registration is a startup error, handlers receive `(params, realmRecord)` only

## 4. Storage as syscall #1 (D5, D7)

- [ ] 4.1 Register the storage rows: `storage.kv.get/set/remove`, `storage.records.append/list/update/remove`, each a thin binding onto the realm record's engine handle
- [ ] 4.2 Implement the launch sequence: read app record → `createStorageEngine({appId})` → `engine.open(schemaArtifact)` → bind realm + dispatcher → deliver bundle; a conflict-class schema error surfaces as a structured launch failure before the bundle executes
- [ ] 4.3 Write `fixtures/water-counter.app.tsx` (declares `storage`, uses kv for today's count + records for history) and add it to the build's APPS map
- [ ] 4.4 Extend the adversarial fixtures: an undeclared-capability storage attempt (expects the structured denial) and raw-frame forgeries attempting cross-app addressing and fake `sysret` injection
- [ ] 4.5 Add `fixtures/adversarial/sql-injector.app.tsx` — an evil mini-app alongside evil/poison/victim that *declares* storage and then drives the real verbs with adversarial input (SQL metacharacters in record values, kv keys/values, `where` values, and crafted collection/`where`/`orderBy` field names), reporting on-screen whether any injection landed; add it to the build's APPS map

## 5. Tests: Node suite + invariant scenarios (D8)

- [ ] 5.1 Write the gate/dispatcher Node suite FIRST (`npm run bridge:test`, fake transport + `:memory:` engine): gate order and each denial kind, dedup replay, generation fences, append-only registry rules, channel-derived identity (the API admits no cross-app expression)
- [ ] 5.2 Add invariant-suite scenario pages (simulated host shim built from the same gate/contract modules, over a `:memory:` engine): undeclared-capability denial, stub-authority probe over the storage facade, forged-`sysret` inertness, stale-generation drop, and the `sql-injector` fixture driven end-to-end (values inert, crafted identifiers rejected, only its own store touched) — so the end-to-end injection property is gated per-push alongside containment
- [ ] 5.3 Add the negative control: a deliberately misconfigured gate (grants undeclared capabilities) must be FLAGGED red — proving the new scenarios are not vacuously green
- [ ] 5.4 Run the full retained suite (`npm run build && npm run invariants`) and confirm all pre-existing isolation/rendering scenarios still pass untouched (no CSP/allowlist drift)

## 6. On-device acceptance + record the numbers (D7 pattern)

- [ ] 6.1 Wire the water counter through `WebViewHost` on the Android target (offline release bundle): tap to increment, kill the app process, relaunch, count intact — the §15.2 "trackers become real apps" acceptance
- [ ] 6.2 Run the adversarial fixtures on-device: undeclared-capability denial shown with its structured error; forged frames inert; the `sql-injector` fixture lands zero injections (values inert, crafted identifiers rejected, no collateral store touched); existing containment verdict still `contained:true`
- [ ] 6.3 Measure on-device syscall round-trip latency (per-verb, and the water counter's launch-to-interactive) against the task-1.3 baseline; set the timeout default from the data
- [ ] 6.4 Record results in `docs/decisions.md` (bridge contract decision entry) + `DEVLOG.md`; confirm every `capability-bridge` spec scenario passes; note the v0.3 readiness test — the haptics row must be addable without touching transport or dispatcher
