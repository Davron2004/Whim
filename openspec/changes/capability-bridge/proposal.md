# capability-bridge — Proposal

## Why

The storage engine (`mini-app-storage-engine`) gives mini-apps something worth reaching for, but no mini-app can reach it: there is no syscall boundary between the sandboxed bundle and host-side capabilities. This change builds that boundary — the v0.2 milestone proper (spec §15.2): **transport envelope + RPC dispatcher + append-only capability registry + manifest gate**, with storage wired as syscall #1 and an end-to-end acceptance that turns a v0.1 in-memory shell into a real app (a water counter whose count survives killing the app, per §15.3).

The bridge is the project's core porting abstraction (§5.6): once this machinery exists, every future native-backed capability (haptics, audio, notifications, sensors) is one registry row plus one thin client stub — capability #15 costs the same as capability #2. Getting the seam right once is the milestone; storage is its first, real customer.

**Depends on:** `mini-app-storage-engine` (implemented; this change imports its `contract.ts` types and binds its engine instances into registry handlers).

## What Changes

- **Syscall transport envelope** over the existing two-hop string pipe (iframe `postMessage` → trusted outer document relay → `ReactNativeWebView.postMessage` → RN host, and the reverse): `{id, method, params}` requests, `{id, ok, result|error}` responses, versioned, JSON-only. Syscall frames are a distinct frame family from the existing nonce-authenticated control frames — neither is ever interpreted as the other.
- **Realm registry + channel-derived identity**: the host binds each realm at creation to `{appId, manifest, schema, engine handle, generation}`. No syscall carries an app identifier — identity comes from which channel the frame arrived on, never from message content (the isolation design's confused-deputy defense, now as code).
- **RPC dispatcher** with per-realm-generation request-ID dedup (idempotent delivery — a retried syscall cannot double-append) and stale-generation drop (in-flight syscalls from a torn-down realm never resolve into its successor; the spike-2 constraint-#5 seam extended to the bridge).
- **Append-only capability registry + gate**: method registered → capability declared in the host-held manifest → params shape-valid → dispatch. Violations return structured fix-hint errors (`{kind: 'undeclared_capability', hint: …}`) — the §8.1 diagnostics discipline, feeding the future repair loop.
- **Manifest is host-held**: gating reads the manifest from the host's app record (today: fixture config; later: harness-validated and version-store-tracked). A bundle's runtime self-description is never consulted for gating.
- **`vc-sdk` storage facade**: typed client stubs implementing the engine's `contract.ts` verb types, Promise-per-call, holding nothing stronger than the one-way transport (spike-2 constraint #2). Delivered through the existing H1b host-injected `vc-sdk` external — no new module-resolution surface, no CSP change.
- **Storage as syscall #1**: registry rows for `storage.kv.*` / `storage.records.*` binding to the per-app engine instance opened at app launch (host-side `engine.open(schema)` before bundle delivery).
- **Fixtures + acceptance**: a hand-written `water-counter.app.tsx` (the §15.3 "becomes a genuine app at v0.2" candidate) persisting across kill+relaunch on-device; adversarial fixture extensions attempting undeclared-capability calls and cross-app addressing; a new `sql-injector.app.tsx` evil fixture that declares storage and drives the real verbs with injection payloads (proving the engine's parameterization holds end-to-end through a hostile bundle); bridge cases added to the invariant suite with a negative control.

**Not in this change:** capabilities #2+ (haptics/audio are v0.3), `delay`/`interval` effects (web-side, v0.3), runtime permission prompts (the gate has the hook; Tier-0 storage needs no prompt), synthetic-event smoke testing (Spike 3, harness phase), generation-time manifest/schema extraction (harness phase), and any widening of the sandbox CSP or module allowlist (locked).

## Capabilities

### New Capabilities

- `capability-bridge`: the syscall boundary between sandboxed mini-apps and host capabilities — frame families and envelope, channel-derived identity, append-only registry, manifest gating with structured errors, idempotent delivery, realm-generation lifecycle, and the no-ambient-authority rule for in-sandbox stubs. Includes the end-to-end storage-reachability requirements (syscall #1).

### Modified Capabilities

*None.* `sandbox-isolation`'s requirements hold verbatim — the bridge adds no reachable reference path to the host (stubs hold only the one-way transport that v0.1's event round-trip already used), and the CSP/global-strip/module-allowlist are untouched. `sandbox-rendering` and the version-store specs are unaffected. The storage specs land with `mini-app-storage-engine`; this change consumes them as-built rather than modifying them.

## Impact

- **New code**: `src/host/bridge/` (realm registry, dispatcher, gate, capability registry, storage handler rows); `src/sdk/` gains the `storage` facade + `defineApp` schema/capability typing; `src/runtime/web/loader.js` (or a sibling) gains the syscall marshalling on the iframe side; `WebViewHost.tsx` gains the relay + realm binding.
- **New fixtures**: `fixtures/water-counter.app.tsx`; adversarial additions under `fixtures/adversarial/`.
- **Tests**: a Node suite for the pure host-side logic (dispatcher/gate/registry — §16.2 says TDD the bridge); new invariant-suite scenarios (gate denial, stub-authority probe, stale-generation drop) with a negative control; on-device acceptance via the probe-screen pattern.
- **Build**: `build/build.mjs` bundles the new fixture; runtime artifacts regenerate. No CSP, sandbox-attribute, or external-module changes.
- **Dependencies**: none new (transport, JSON, and the engine already exist).
- **Docs**: decision-log entry for the bridge contract; `DEVLOG` capture for the on-device run.
