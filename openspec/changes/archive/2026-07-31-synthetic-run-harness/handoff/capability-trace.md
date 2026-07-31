# Handoff: capability-trace (chain 3 — capability-wiring)

Module: `synthrun/capability.ts`. Wires the REAL production capability gate/dispatcher/registry
(`src/host/bridge`) against an ephemeral per-run Node `:memory:` storage engine — the
bridge-invariants recipe (`invariants/sandbox-isolation/bridge/host-shim.ts`) transplanted
verbatim: `launchApp` → `Dispatcher.forRealm` → `context.exposeFunction('whimHostDispatch', …)`.
Nothing here reimplements or approximates authorization — every recorded `errorKind` is the
production gate's own `BridgeErrorKind`/`StorageErrorKind`, never re-derived.

## The trace shape (`CapabilityTraceEntry`)

```ts
export type CapabilityTraceEntry =
  | { kind: 'syscall'; method: string; atMs: number }
  | { kind: 'cue'; method: string; atMs: number; params: Record<string, unknown> }
  | { kind: 'denial'; method: string; atMs: number; errorKind: string; capability?: string; hint: string };
```
`kind` mirrors `contract.ts`'s `TraceEntry` base union (`'syscall' | 'cue' | 'denial'`) verbatim —
structurally assignable straight into `RunReport.trace` once chain 5 wires it in (the same
"own kind union, structurally assignable" pattern as chain 2's `ObservedDiagnostic`; **never**
mint a `kind` beyond these three).

- `'denial'` — every gate refusal, ANY method, recorded HOST-SIDE at the dispatch function —
  the only vantage that sees it even when the candidate `.catch`es and swallows the rejected
  promise (a candidate's own handling of the promise is irrelevant; the host computes and
  records the outcome before the candidate ever sees it). `errorKind` is `BridgeErrorKind`
  (`malformed_envelope`, `unknown_method`, `undeclared_capability`, `permission_denied`,
  `invalid_params`, `handler_error`, `syscall_timeout`, `transport_unavailable`) or a
  `StorageErrorKind` (surfaced verbatim through a storage handler's throw), or `'unknown'` only
  when the raw frame could not be parsed and the sysret's own `error.method`/`.kind` were absent
  too (defensive — has not been observed).
- `'cue'` — a `cues.*`/`diag.*` call that validated through the real gate (capability declared,
  params valid) and then was RECORDED instead of acting: no device, no hardware server-side.
  `params` holds the token/payload that would have fired (e.g. `{kind:'double'}` for
  `cues.haptic`, `{}` for `diag.echo`).
- `'syscall'` — any OTHER successful call (today: `storage.*`) — a plain arrival record; the
  real effect is the storage engine's own state, not this trace.

## Entry point (`wireCapabilityBridge`)

```ts
export interface CapabilityWiringOptions {
  engineFactory?: EngineFactory; // default: fresh Node `:memory:` per call (D3) — appId ignored
}
export interface CapabilityWiring {
  realm: RealmRecord | null;                       // null iff launch was refused
  launchError: { kind: string; hint: string } | null; // launchApp's own LaunchResult.error, verbatim
  trace: CapabilityTraceEntry[];
  dispatch: (frameString: string) => Promise<string | null>; // directly callable, no browser needed
  beforeNavigate: (page: Page, context: BrowserContext) => Promise<void>;
}
export function wireCapabilityBridge(appRecord: AppRecord, opts?: CapabilityWiringOptions): CapabilityWiring;
```

Call **once per run** — each call launches its own realm over its own fresh engine (never share
one `CapabilityWiring` across runs; that is what gives "no candidate state survives into another
run" for free, by construction, not by an explicit reset step). `beforeNavigate` is
`RunOptions.beforeNavigate`-compatible (`contract.ts`, chain 1/2) and binds
`context.exposeFunction('whimHostDispatch', dispatch)` — it does nothing else and never touches
navigation. A composing caller (chain 5) wraps it alongside chain 2's `attachObserversEarly`:

```ts
beforeNavigate: async (page, context) => {
  await attachObserversEarly(page, context); // chain 2
  await wiring.beforeNavigate(page, context); // chain 3
}
```

## Launch failure ("failure-as-diagnostic", task 3.2)

When `launchApp` refuses (today: `missing_schema` when a `storage`-declaring app has no
`schemaArtifact`; a storage-engine `open()` failure otherwise), `wireCapabilityBridge` returns
`realm: null` and `launchError` set to `launchApp`'s own `LaunchResult.error` verbatim.
`beforeNavigate` is then a no-op — no `whimHostDispatch` is ever exposed, so the runtime's own
`syscallSink:'exposed'` fallback (`relaySyscall` in `build/assemble.mjs`) silently drops any
syscall the candidate attempts (its promise never resolves). The caller MUST surface
`launchError` as a diagnostic itself — this module never invents a `RuntimeDiagnostic`.

## What is NOT reimplemented here

The gate (`runGate`), the dispatcher (`Dispatcher.handle` — envelope validation, generation
fence, idempotent delivery), and the registry (`CapabilityRegistry`, append-only) are the exact
production modules from `src/host/bridge`, unmodified, imported directly. The ONLY injected seam
is the `CueBackend` (recording, not device-backed) passed to `createDefaultRegistry`.

## Non-obvious fact for chain 5

Two independent `wireCapabilityBridge(appRecord)` calls over the SAME `appId` do not share any
state — cross-candidate isolation is a structural consequence of a fresh `:memory:` engine per
call, not an explicit teardown chain 5 needs to invoke.
