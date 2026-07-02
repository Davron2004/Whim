# capability-bridge — Design

## Context

v0.1 proved the contained runtime: a hostile bundle renders, taps round-trip, and the five spike-2 carry-forward constraints are enforced as code (window-level strip, loader ≤ `parent.postMessage`, trusted-vantage verdicts, per-realm nonce auth on control frames, realm reset per generation). `mini-app-storage-engine` provides per-app SQLite engines behind `contract.ts` types. What's missing is the governed path between them. Spec §5.6 fixes the mental model: **the WebView is a sandboxed process; the bridge is its syscall interface** — transport written once, dispatcher written once, an append-only syscall table, and a gate that is `seccomp` + `capabilities(7)` with the manifest as the declared capability set.

The threat model is inherited, not new: the bundle shares the iframe scope with the SDK stubs (constraint #2), can forge any frame shape (constraint #4 / F4), and a previous generation can poison a reused realm (constraint #5). The bridge must be correct *under those assumptions*, not despite them.

## Goals / Non-Goals

**Goals:**

- The four-layer machinery: transport envelope, RPC dispatcher, append-only capability registry, manifest gate — each written once, with adding capability #N+1 reduced to one registry row + one client stub.
- Storage reachable as syscall #1, end-to-end on-device: a hand-written mini-app persists data across an app kill.
- Channel-derived identity throughout: no message content ever names an app or selects a store.
- Idempotent delivery (request-ID dedup) and realm-generation hygiene (stale frames drop) at the transport layer, for every present and future capability.
- Structured, fix-hint-carrying gate errors (the §8.1 diagnostics shape) so the future repair loop consumes bridge denials directly.

**Non-Goals:**

- More capabilities (haptics/audio are v0.3 — they exist here only as the "second row" thought experiment validating the registry shape).
- Web-resident SDK effects (`delay`/`interval`), runtime permission prompts (hook only), Spike-3 synthetic driving, generation-time static extraction of manifest/schema (harness phase).
- Multiple simultaneously-running mini-apps (the launcher era); the realm registry's design must merely not preclude it.
- Any change to the CSP, iframe sandbox attributes, or the H1b module allowlist — locked by #35/#37.

## Decisions

### D1 — Two frame families, and syscalls are never authenticated — they're gated

All iframe→host traffic remains untrusted data (constraint #4). Within it, two disjoint families:

- **Control frames** (existing): loader/runtime lifecycle + verdicts, authenticated by the per-realm nonce. Unchanged.
- **Syscall frames** (new): `{whim: 'syscall', v: 1, id, method, params}` → `{whim: 'sysret', v: 1, id, ok, result | error}`. **Deliberately not nonce-authenticated**: the legitimate sender *is* the untrusted bundle (via the SDK stub), so there is no honest-sender property to authenticate. Authority comes entirely from the gate on the host side. What matters is the families never cross: the control handler ignores syscall-shaped frames and vice versa, keyed on the `whim` discriminator, so a bundle forging control frames gains nothing new (F4 already covers it) and a forged "sysret" from the bundle to itself is a no-op (responses flow host→iframe only; the stub correlation map only resolves ids it issued).

*Alternative rejected:* nonce-authenticating syscalls — security theater that would imply the syscall channel is trusted, inviting exactly the mistake constraint #4 warns against.

### D2 — Identity from the channel: the realm registry

At app launch the host creates a **realm record**: `{appId, manifest, schemaArtifact, engineHandle, generation, webViewRef}`. The dispatcher for that realm closes over that record — it physically holds one app's engine handle and one manifest (the #39 D2 constructor-guard pattern, third application). The envelope has no app field; the outer trusted document relays only frames whose `event.source` is its own iframe's `contentWindow`, and the RN host keys the realm record off which WebView instance delivered the message. A confused-deputy read is not "denied" — it is inexpressible at every hop.

One realm == one bundle == one app (the v0.1 invariant) keeps channel⇒identity sound. The registry is a map keyed by WebView/realm instance, so the future launcher (N apps, N realms) is a loop, not a redesign.

### D3 — Dispatcher semantics: correlation, dedup, generation fences

- **Correlation**: stub assigns monotonically increasing ids per realm-generation; dispatcher echoes them on `sysret`; the stub resolves its Promise map. Timeout (config, ~10 s) rejects with a structured `{kind: 'syscall_timeout'}`.
- **Idempotent delivery**: the dispatcher keeps a bounded per-realm-generation LRU of `id → outcome`; a duplicate id replays the recorded outcome without re-executing the handler. This is the storage-design requirement ("a retried syscall cannot double-append") implemented once, transport-level, for every capability.
- **Generation fences** (constraint #5 extended): every realm reset increments `generation`; frames stamped with a stale generation are dropped, and handler results that complete after their realm was torn down are discarded, never delivered into the successor realm. A new generation starts with an empty dedup map and a fresh id space — no cross-generation replay.

### D4 — The gate runs in fixed order and fails structured

For each syscall frame: (1) envelope shape-valid → (2) `method` exists in the registry → (3) the registry row's required capability ∈ the realm's **host-held** manifest → (4) permission hook (pass-through for Tier-0 storage; the seam exists so notifications/sensors slot in later) → (5) params validate against the row's schema → dispatch to the handler bound to this realm's record. Each failure returns `{kind, method?, capability?, hint}` — e.g. `{kind: 'undeclared_capability', capability: 'storage', hint: "declare 'storage' in defineApp capabilities"}`. Denials are normal data, not exceptions: the bundle sees a rejected Promise; the host logs the denial for the future telemetry/repair loop.

*Why host-held manifests (not the bundle's runtime self-description):* the bundle is hostile; a self-declared manifest gates nothing. Today the app record comes from fixture config; in the product it is harness-validated at generation time and version-store-tracked (#39 already tracks `manifest.json` as a code artifact). The gate code is identical in both worlds — only the record's provenance changes.

### D5 — The registry is an append-only table, and rows are dumb

`register(method, {capability, paramsSchema, handler})` at host startup; no unregister, no override (a duplicate method name is a startup error). Handlers receive `(params, realmRecord)` and must derive everything from those two arguments. Storage contributes rows binding `storage.kv.get/set/remove` and `storage.records.append/list/update/remove` straight onto the realm's engine handle — each row is a few lines, which is the point: the v0.3 haptics row must be writable in minutes, and if adding a capability ever requires touching transport or dispatcher, the abstraction has leaked (§5.6's smell test, adopted as a review rule).

### D6 — The SDK facade holds nothing and knows nothing

`vc-sdk`'s `storage` module is typed client stubs over the engine's `contract.ts` types: build envelope → `transport.send(string)` → await correlated `sysret`. The stub layer's only capability is the same one-way transport the loader already holds (constraint #2 — audited by the existing stub-authority probes, extended to the new module). No caching, no validation beyond types, no fallback behavior — the host is the sole interpreter of effects (§5.6's effect-interpreter framing). `defineApp` gains `schema` and `capabilities` typing so hand-written fixtures (and later the agent) declare them in-bundle; the runtime gate, however, reads only the host-held copy (D4).

### D7 — Schema travels host-side; the engine opens before the bundle runs

At launch: host reads the app record `{bundle, manifest, schemaArtifact}` → `createStorageEngine({appId})` → `engine.open(schemaArtifact)` (validate/diff/DDL per the engine change) → create realm + dispatcher bound to the opened engine → deliver the bundle. A conflict-class schema failure surfaces *before* the bundle executes, as a structured launch error — old code never runs against a store it can't open.

### D8 — Test strategy: TDD the host core, probe the seams, accept on-device

- **Node suite** (`npm run bridge:test`, the `vstore:test`/`storage:test` idiom): dispatcher, gate order, dedup, generation fences, registry append-only rules — pure logic with a fake transport and a `:memory:` engine; written test-first (§16.2: TDD the bridge; gate/dispatcher tests authored before handlers, and the security-shaped assertions kept apart from feature tests).
- **Invariant-suite additions** (headless Chromium, the per-push gate): scenario pages with a simulated host shim asserting (a) an undeclared-capability syscall is denied with the structured error, (b) the stub layer exposes nothing stronger than the transport (T3-probe extension over the `storage` facade), (c) a forged `sysret` from bundle scope cannot resolve a stub promise it didn't own, (d) a stale-generation frame is dropped after realm reset — plus a negative control (a deliberately-misconfigured gate that grants undeclared capabilities is FLAGGED red).
- **On-device acceptance** (D7 pattern): the water counter as a *real app* — count taps, kill the app, relaunch, count intact; the `evil` fixture extended to attempt storage without declaring it (denied, structured error on-screen) and to attempt cross-app addressing (inexpressible — asserted by API shape in the Node suite, and by an attempted raw-frame forgery on-device); a new `sql-injector` fixture that *declares* storage and drives the real verbs with adversarial values and crafted identifiers, asserting zero injections land. Numbers (syscall round-trip latency, water-counter cold start) recorded in the decision log.

The end-to-end injection coverage here complements — does not duplicate — the engine change's gate. The authoritative parameterization/identifier-mapping property lives in `mini-app-storage-engine`'s `storage:test` (engine-direct, per-push CI). This change proves the same property holds when the input arrives through a genuinely hostile *bundle* over the real sandbox→syscall path, in the invariant suite (also per-push) and on-device.

## Risks / Trade-offs

- [Per-syscall postMessage latency makes chatty apps feel slow] → measure round-trip on-device early (task-group 1 carries a latency probe); Tier-0 apps are low-frequency (a tap → one append). Batching is a known, deferred optimization that the envelope's `v` field leaves room for — not built speculatively.
- [The outer-document relay is new attack surface] → the relay forwards only `event.source`-verified, JSON-parseable frames and holds no capability beyond what it already had (the RN postMessage pipe); it gains no handler logic. Invariant (b) covers it.
- [Two sources of manifest/schema truth (in-bundle declaration vs host-held record) drift in fixtures] → the build step that bundles fixtures also extracts their declared `schema`/`capabilities` into the fixture app record, so fixtures can't drift; the harness inherits this extraction job later.
- [Dedup/generation maps leak memory across long sessions] → bounded LRU per realm, whole map dropped on realm teardown; sized in config.
- [Gate or dispatcher grows capability-specific branches over time] → review rule from §5.6: any capability needing transport/dispatcher edits means the abstraction leaked; the haptics row (v0.3) is the immediate test.
- [The invariant suite's simulated host shim diverges from the real RN host] → the shim implements the same `contract.ts` + gate module (shared code, not a re-implementation); the on-device run remains authoritative (D7 pattern, as ever).

## Migration Plan

No data, no users, no API consumers yet — the change is additive runtime machinery. v0.1 fixtures (tip splitter) run unchanged: an app with no `capabilities` simply never passes the gate's threshold and never syscalls. Rollback is removing the bridge wiring; the storage engine library is untouched by rollback (it has no other consumers yet). The contract seam (`contract.ts`) is consumed read-only — any change to it during implementation goes through the `mini-app-storage-engine` change's artifacts, not ad-hoc edits.

## Open Questions

- Syscall timeout default (10 s placeholder) and whether timeouts should auto-retry once given dedup makes retries safe — decide from the on-device latency numbers.
- Whether the launch-time schema-conflict error surfaces to the user now (an error screen) or only to the log until the launcher era — UX-level, decide in task 5.
- Exact home of the iframe-side marshalling (inside `loader.js` vs a sibling `syscall.js` part assembled by the build) — implementation detail, decide in task 2.
