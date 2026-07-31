# Handoff: observe-api (chain 2 — observers-watchdog)

Module: `synthrun/observe.ts`. Every signal is trusted-vantage (spec §Observation is
trusted-vantage only): the nonce-authenticated `delivery`/`paint`/`error`/`probes` frames
(`build/assemble.mjs`'s `toRN(obj)`, relayed via a `window.ReactNativeWebView` override on the
OUTER container page — never the sandboxed iframe's same-named stub) plus CDP-level
`Runtime.exceptionThrown` (covers uncaught throws AND unhandled rejections). Console output is
read ONLY as an activity heartbeat, never for diagnostic content — a candidate cannot forge it.

## Diagnostics + events (`ObservedDiagnostic`, `FrameEvent`)

```ts
export const RUNTIME_OBSERVED_KINDS = ['runtime_throw', 'unhandled_rejection', 'mount_timeout', 'run_truncated', 'containment_failure'] as const;
export type RuntimeObservedKind = (typeof RUNTIME_OBSERVED_KINDS)[number];
export interface ObservedDiagnostic { kind: RuntimeObservedKind; severity: 'error'|'warning'; message: string; hint: string; line?: number; }
```
Same field shape as `contract.ts`'s `RuntimeDiagnostic`, deliberately typed with its OWN kind
union: `checks/contract.ts`'s closed `DiagnosticKind` doesn't have these strings yet (chain 5,
task 5.1, adds them additively) — `ObservedDiagnostic` becomes structurally assignable to
`RuntimeDiagnostic` the moment it does. **Never mint a kind beyond this fixed set.**

```ts
export type ObservedFrameKind = 'delivery'|'paint'|'error'|'probes'|'rejected-forgery'|'syscall'|'ui-event'|'nav-depth';
export interface FrameEvent { kind: ObservedFrameKind; trusted: boolean; atMs: number; generation: number; payload: unknown; }
```
`trusted` is copied VERBATIM from the outer page's own `toRN()` payload — true only for the four
authenticated kinds; never re-derived here. `syscall` frames never actually arrive (`page.ts` sets
`syscallSink:'exposed'`, routing them to chain 3's `whimHostDispatch` instead).

## State + handles

```ts
export interface ObservationState {
  events: FrameEvent[]; diagnostics: ObservedDiagnostic[];
  contained: boolean | null;   // set ONLY from an authenticated `probes` frame's payload.contained
  paintAtMs: number | null;    // ms since RunContext.startedAt the authenticated `paint` frame arrived
  lastActivityAtMs: number;    // quiet-window activity clock (frame events + CDP exceptions + console)
}
export interface AttachedObservers { state: ObservationState; detach(): void; }
```

## Two-phase attachment (load-bearing — see below, not stylistic)

```ts
export interface EarlyObservers { state: ObservationState; finish(ctx: RunContext): Promise<AttachedObservers>; }
export function attachObserversEarly(page: Page, context: BrowserContext): Promise<EarlyObservers>;
export function openObservedRun(session: SynthRunSession, source: string, opts?: RunOptions):
  Promise<{ ctx: RunContext; obs: AttachedObservers; dispose: () => Promise<void> }>;
```
`attachObserversEarly` wires the CDP `Runtime.exceptionThrown` collector and MUST be called from
`RunOptions.beforeNavigate` (chain 1's `session.ts`, extended this chain — see below), i.e.
BEFORE navigation. **Measured, not defensive style**: a candidate can throw near-instantly once
its module code starts running — well before the nonce-authenticated `toRN()` handshake (hello→
hostInit→ready→deliver→mount→paint→probes, many event-loop turns) would ever catch it — and
attaching CDP *after* `openRun` returns intermittently loses that race. `EarlyObservers.finish(ctx)`
completes attachment (the `window.ReactNativeWebView` relay override + console heartbeat) once
`ctx` exists (post-navigation) — call it exactly once, immediately after `openRun` resolves.

`openObservedRun` is the ready-made composition for a caller that does NOT also need chain 3's
`beforeNavigate` hook (this chain's own acceptance suite uses it). A composing caller (chain 5)
instead calls `attachObserversEarly` itself from a combined `beforeNavigate` that also does
chain 3's `context.exposeFunction('whimHostDispatch', ...)`.

## `RunOptions.beforeNavigate` (extends `contract.ts`, chain 1's file)

```ts
export interface RunOptions {
  budgets?: Partial<RunBudgets>; appId?: string;
  beforeNavigate?: (page: Page, context: BrowserContext) => Promise<void>;
}
```
`session.ts`'s `openRun` calls this once, after `context.newPage()` and before `page.goto(...)`.
Chain 3 uses the SAME hook for its `whimHostDispatch` exposure — compose by wrapping both calls.

## Source-map resolution (task 2.3)

```ts
export function resolveOriginalLine(mapText: string, wrappedLine1Based: number): { source: string; line: number } | undefined;
```
`wrappedLine1Based` is the 1-based line from a CDP stack frame whose `url === ''` (the
candidate's own dynamically-inserted `<script>` — distinct from the runtime parts' `about:srcdoc`
scripts; only THAT frame is ever resolved, never a host/runtime-internal one). Internally
subtracts `loader.js`'s fixed 8-line `wrappedBundleSource()` preamble, then VLQ-decodes
`RunContext.sourceMap` (mirrors `build/build.mjs`'s own minimal consumer). Returns `undefined`
on any failure — the caller omits `line` (spec: "omitted otherwise"). Pinned end-to-end by
`test/acceptance.ts`'s throws-on-mount test (asserts the exact resolved line) — the drift
tripwire if `loader.js`'s wrapping ever changes.

## Watchdog (task 2.2, design D2) — three independent layers, own budgets

```ts
export const DEFAULT_RUN_BUDGETS: RunBudgets; // mountBudgetMs:8000 actionQuietMs:300 actionHardCapMs:4000 totalBudgetMs:45000
export function mergeBudgets(overrides?: Partial<RunBudgets>): RunBudgets;
export function awaitMount(obs: AttachedObservers, budgets: RunBudgets): Promise<ObservedDiagnostic | null>;
export function awaitQuiet(obs: AttachedObservers, budgets: RunBudgets): Promise<void>;
export function withTotalBudget<T>(ctx: RunContext, obs: AttachedObservers, budgets: RunBudgets, work: () => Promise<T>): Promise<{ truncated: boolean; result?: T }>;
```
- `awaitMount`: waits for `state.paintAtMs` OR any pre-existing diagnostic (a mount-time throw
  already IS a named outcome — no reason to burn the rest of the budget). On budget expiry with
  neither, appends+returns a `mount_timeout` diagnostic (never silent, per caller — `null` = ok).
- `awaitQuiet`: waits for `budgets.actionQuietMs` of no `lastActivityAtMs` change, hard-capped at
  `actionHardCapMs`. NEVER produces a diagnostic — a legal `interval` just rides out the cap.
- `withTotalBudget`: races `work()` against `totalBudgetMs`; on overrun, hard-kills `ctx.page`
  (`page.close()`), appends `run_truncated`, returns `{truncated:true}` (`work()`'s eventual
  settlement, if any, is discarded).

## Non-obvious runtime fact chain 4/5 should know

Under the CURRENT `loader.js`, the `paint` frame's double-`requestAnimationFrame` measurement
fires unconditionally as soon as `ReactDOM.createRoot(...).render(...)` is *called* — NOT gated
on React actually committing content. An async-only hang (e.g. the SDK's `delay(Infinity)`) does
**not** produce `mount_timeout`; only a synchronous hang before that call does. `mount_timeout`'s
own contract (no paint within budget) is unaffected — this is a fact about what candidate
behavior can trigger it, not a gap in the diagnostic itself.
