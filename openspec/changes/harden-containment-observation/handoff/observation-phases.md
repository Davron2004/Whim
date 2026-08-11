# Contract — observation phases after D1 (chain-2)

`synthrun/observe.ts`. Read this before writing anything that attaches to, asserts on, or times
a run's observation. Supersedes `handoff/observe-api.md`'s two-phase description.

## Signatures (verbatim)

```ts
export const RELAY_BINDING_NAME = '__whimSynthRelay';

export async function attachObserversEarly(page: Page, context: BrowserContext): Promise<EarlyObservers>;

export interface EarlyObservers {
  state: ObservationState;                              // live from attach, mutated in place
  finish(ctx: RunContext): Promise<AttachedObservers>;  // installs NOTHING (see below)
}

export interface AttachedObservers {
  state: ObservationState;
  detach(): void;                                       // idempotent; does not close page/context
}
```

Unchanged: `ObservationState`, `FrameEvent`, `ObservedDiagnostic`, `openObservedRun`,
`awaitMount`, `awaitQuiet`, `withTotalBudget`, `mergeBudgets`, `resolveOriginalLine`.

## The phase split

`attachObserversEarly` — the PRE-NAVIGATION phase, reached through `RunOptions.beforeNavigate`.
Installs, in this order, everything the run is observed with:

1. CDP session on `page` + `Runtime.enable` + `Runtime.exceptionThrown` (throws and unhandled
   rejections);
2. `page.exposeFunction(RELAY_BINDING_NAME, cb)` — the host-side relay sink;
3. `page.addInitScript(installRelayShim, RELAY_BINDING_NAME)` — the transport shim (below);
4. `page.on('console')` — the activity heartbeat, and with it `rnLog()`'s console fallback and
   any `{__whimHostLog:true,line}` frame emitted before `load`.

`EarlyObservers.finish(ctx)` — the POST-NAVIGATION phase. Assigns `ctx.sourceMap` into the
mutable slot the CDP exception handler closes over (that value cannot exist before navigation:
`openRun` only hands `ctx` back on return) and returns the already-attached `AttachedObservers`.
**It installs nothing, attaches no listener, and performs no browser round-trip.** Calling it
late costs only the resolved `line` on exceptions observed before it; frames, diagnostics and
the console heartbeat are unaffected.

Both compositions (`openObservedRun` in `observe.ts`, `createRunCandidate` in `report.ts`) have
the same shape: attach inside `beforeNavigate`, then `await early.finish(ctx)` once `openRun`
returns.

## Invariant: main-frame confinement (enforce it, don't assume it)

The shim runs as the FIRST script of EVERY document, and in every realm it:

- reads the exposed binding off the global and **deletes it**, then
- returns immediately unless `globalThis.top === globalThis`; only the main frame goes on to
  define `ReactNativeWebView = { postMessage }` closing over the captured reference.

So after this chain, **`RELAY_BINDING_NAME` is `undefined` in every realm, the main frame
included** — the transport reaches the host only through the closure. Measured facts behind that
shape, each verified in a real Chromium against the production page:

- `page.exposeFunction` defines its wrapper in **every frame of the page, the opaque-origin
  sandboxed iframe included** (`typeof __whimSynthRelay === 'function'` there). The scrub is what
  makes the containment invariant true; without it, exposing the relay at all — before OR after
  navigation, as the pre-D1 code did — leaks the host relay into the candidate's realm.
- `page.addInitScript` likewise runs in every frame; the `top` guard, not the mechanism, is the
  confinement.
- A pre-navigation `page.evaluate` global does **not** survive navigation (it belongs to the
  `about:blank` document), so it cannot carry the shim across the commit.
- The sandbox realm keeps `loader.js`'s own same-named `ReactNativeWebView` stub, untouched. Any
  assertion about confinement must therefore name `RELAY_BINDING_NAME`, **not**
  `ReactNativeWebView` — the latter is defined in the sandbox realm by design and proves nothing.

Import `RELAY_BINDING_NAME` rather than re-typing the string.

Authentication is untouched: the nonce check happens in the outer page before any
`toRN({trusted:true})`; this module consumes `msg.trusted` verbatim and never re-derives it.

## Timing basis (changed)

`FrameEvent.atMs` and `ObservationState.paintAtMs` are now measured from **attach time**
(`attachObserversEarly`, immediately pre-navigation), not from `RunContext.startedAt`. A frame
can arrive before `finish(ctx)` runs, so `ctx.startedAt` is not available when the first frame
lands; one attach-time anchor keeps every frame in a run mutually comparable. Consequence:
`RunReport.timings.mountToPaintMs` (fed by `paintAtMs`) no longer includes page assembly, temp
file write, `newContext`/`newPage` — it shrinks by that amount (tens of ms). Spec determinism is
"timings aside"; nothing else in the report shifts.

## `waitUntil` (settled, unchanged)

`session.ts` keeps `page.goto(..., { waitUntil: 'load', timeout: 20000 })`. Measured: against a
candidate that hangs synchronously and unboundedly, `goto` still resolves in ~30ms — the outer
page's `load` fires once the sandboxed iframe's srcdoc has loaded, and the candidate bundle is
only delivered afterwards over postMessage. `awaitMount` is therefore reachable for a
never-painting candidate (verified end-to-end: `mount_timeout`, `paintAtMs === null`, no events,
`dispose()` returns in ~4ms with the renderer wedged). No weaker mode is needed.

## What a run now observes that it previously raced

Every frame the outer page emits arrives AFTER `openRun` returns — measured on a healthy
candidate: `delivery@33ms`, `nav-depth@35ms`, `paint@57ms`, `rejected-forgery@57ms`,
`probes@58ms`, with zero events present at the moment `openObservedRun` resolved. Pre-D1 all of
them were racing the relay install; a lost one was dropped at the source by `toRN()`, never
buffered. Suites that previously saw `paintAtMs === null` or `contained === null` from a *lost*
frame will now see the real value.
