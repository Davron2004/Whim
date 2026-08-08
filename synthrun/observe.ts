/**
 * Trusted-vantage observation + watchdog (design D2; `handoff/observe-api.md`).
 *
 * Every signal here comes from a vantage point the candidate cannot overwrite (spec
 * §Observation is trusted-vantage only): the nonce-authenticated `delivery`/`paint`/`error`/
 * `probes` frames (relayed by the UNMODIFIED outer container page's own `toRN()` — `RunContext`
 * is that outer page; `window.ReactNativeWebView` here is ITS global, never the sandboxed
 * iframe's own same-named stub) plus CDP-level `Runtime.exceptionThrown` (covers both uncaught
 * throws and unhandled promise rejections). The candidate's own console output / self-reports
 * are read ONLY as an activity heartbeat for the quiet-window heuristic below — never as a
 * diagnostic or verdict source.
 */
import type { BrowserContext, CDPSession, Page } from 'playwright';
import type { RunBudgets, RunOptions } from './contract';
import type { RunContext, SynthRunSession } from './session';

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics this collector owns (spec §Diagnostics extend the central vocabulary additively).
// Chain 5 (task 5.1) is the ONE place that adds these exact kind strings to the closed
// `DiagnosticKind` union in `checks/contract.ts` — until then this module cannot import that
// union for them, so it declares its OWN scoped literal type with the identical field shape as
// `contract.ts`'s `RuntimeDiagnostic`. Structurally assignable to `RuntimeDiagnostic` the moment
// chain 5 lands (every member here becomes a valid `DiagnosticKind`); never minted ad hoc beyond
// this fixed set.
// ─────────────────────────────────────────────────────────────────────────────
export const RUNTIME_OBSERVED_KINDS = [
  'runtime_throw',
  'unhandled_rejection',
  'mount_timeout',
  'run_truncated',
  'containment_failure',
] as const;
export type RuntimeObservedKind = (typeof RUNTIME_OBSERVED_KINDS)[number];

export interface ObservedDiagnostic {
  kind: RuntimeObservedKind;
  severity: 'error' | 'warning';
  message: string;
  /** Mandatory, non-empty (spec req 1 — every diagnostic carries a hint). */
  hint: string;
  /** Populated only when a `pageerror`/CDP stack maps through `RunContext.sourceMap` to an
   *  original-source anchor; omitted otherwise (spec §Diagnostics, the runtime-producer clause). */
  line?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// The nonce-authenticated frame vocabulary (verbatim the shapes `build/assemble.mjs`'s
// `toRN(obj)` posts — `{kind, trusted, payload}`, `trusted` set BY THE OUTER PAGE ITSELF: true
// only for the four frames it dispatches after its own nonce check passes (delivery/paint/
// error/probes); false for `rejected-forgery` (a REJECTED forgery, not trusted data) and for
// syscall/ui-event/nav-depth (unauthenticated by design — source-verified elsewhere, never
// nonce). This collector trusts the outer page's OWN `trusted` tag; it never re-derives it.
// ─────────────────────────────────────────────────────────────────────────────
export type ObservedFrameKind =
  | 'delivery'
  | 'paint'
  | 'error'
  | 'probes'
  | 'rejected-forgery'
  | 'syscall'
  | 'ui-event'
  | 'nav-depth';

export interface FrameEvent {
  kind: ObservedFrameKind;
  trusted: boolean;
  /** ms since `RunContext.startedAt`. */
  atMs: number;
  /** The generation this event's payload claims, when present; else the last-seen one
   *  (starts at 1 — the loader's own `__whimGeneration` starting point). */
  generation: number;
  payload: unknown;
}

export interface ObservationState {
  events: FrameEvent[];
  diagnostics: ObservedDiagnostic[];
  /** Set ONLY from the nonce-authenticated `probes` frame's `payload.contained` — never any
   *  other source (spec §Observation is trusted-vantage only, "Forged verdict attempt"). `null`
   *  until one authenticated probes frame has arrived. */
  contained: boolean | null;
  /** ms (since `startedAt`) the nonce-authenticated `paint` frame arrived, else `null`. */
  paintAtMs: number | null;
  /** `Date.now()` of the most recent FrameEvent, CDP exception, or console message — the
   *  quiet-window heuristic's activity clock (design D2: "no new paint/console/telemetry
   *  activity"). Never itself inspected for diagnostic content. */
  lastActivityAtMs: number;
}

export interface AttachedObservers {
  state: ObservationState;
  /** Removes this collector's listeners. Idempotent; does NOT close `ctx.page`/`ctx.context` —
   *  that stays the caller's `dispose()`. Safe to call even after the page has already closed. */
  detach(): void;
}

export interface EarlyObservers {
  /** Live from the moment `attachObserversEarly` resolves — a mount-time throw recorded before
   *  `finish()` is called still lands here (same object, mutated in place). */
  state: ObservationState;
  /** Completes attachment once `SynthRunSession.openRun` has returned (i.e. after navigation):
   *  wires the nonce-authenticated frame relay (`window.ReactNativeWebView` override) and the
   *  console activity heartbeat onto the now-navigated `ctx.page`. Call this exactly once,
   *  immediately after `openRun` resolves — see `RunOptions.beforeNavigate`'s doc comment for
   *  why the CDP half above cannot wait until then. */
  finish(ctx: RunContext): Promise<AttachedObservers>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-map resolution (task 2.3; spec §Diagnostics, the runtime-producer `line` clause).
// ─────────────────────────────────────────────────────────────────────────────

// The candidate script the browser actually executes is the RAW esbuild IIFE (`RunContext.
// sourceMap`'s subject) wrapped by `src/runtime/web/loader.js`'s `wrappedBundleSource()` —
// EIGHT fixed preamble lines (the value-strip `var` block + the require/module/exports shim)
// before the bundle text begins. Read-only production runtime file, never forked; this constant
// is pinned by the end-to-end "throws-on-mount" acceptance test (`test/acceptance.ts`) asserting
// the EXACT resolved original line for a known fixture — that test is the drift tripwire: if
// loader.js's wrapping ever changes, the resolved line stops matching and the test goes red.
const LOADER_WRAP_PREAMBLE_LINES = 8;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const d = B64.indexOf(ch);
    if (d < 0) continue;
    const cont = d >= 32;
    const digit = d % 32;
    value += digit * 2 ** shift;
    if (cont) {
      shift += 5;
    } else {
      const neg = value % 2;
      value = Math.floor(value / 2);
      out.push(neg ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

interface DecodedSourceMap {
  version: number;
  sources: string[];
  mappings: string;
}

// Mirrors `build/build.mjs`'s `originForGeneratedLine` (the D4 round-trip check's own minimal
// VLQ consumer) — same algorithm, read-only production precedent, not forked in behavior.
function originForGeneratedLine(map: DecodedSourceMap, genLine0: number): { source: string; line: number } | undefined {
  const groups = map.mappings.split(';');
  let srcIdx = 0;
  let srcLine = 0;
  for (let gl = 0; gl < groups.length; gl++) {
    const segs = groups[gl].split(',').filter(Boolean);
    for (const seg of segs) {
      const f = decodeVlq(seg);
      if (f.length >= 4) {
        srcIdx += f[1];
        srcLine += f[2];
        if (gl === genLine0) return { source: map.sources[srcIdx], line: srcLine + 1 };
      }
    }
  }
  return undefined;
}

/**
 * Map a 1-based line number FROM THE DELIVERED (loader-wrapped) script — as reported by a CDP
 * `Runtime.exceptionThrown` stack frame — back to the original TS source line, via `mapText`
 * (`RunContext.sourceMap`). Returns `undefined` (never throws) whenever the line falls outside
 * the candidate bundle, the map can't be parsed, or no mapping covers it — the caller then
 * omits `line` (spec: "omitted otherwise").
 */
export function resolveOriginalLine(mapText: string, wrappedLine1Based: number): { source: string; line: number } | undefined {
  if (!mapText || wrappedLine1Based <= LOADER_WRAP_PREAMBLE_LINES) return undefined;
  let map: DecodedSourceMap;
  try {
    map = JSON.parse(mapText) as DecodedSourceMap;
  // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable source map just means no `line` resolution, per the doc comment above.
  } catch {
    return undefined;
  }
  if (map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== 'string') return undefined;
  const genLine0 = wrappedLine1Based - LOADER_WRAP_PREAMBLE_LINES - 1;
  if (genLine0 < 0) return undefined;
  try {
    return originForGeneratedLine(map, genLine0);
  // eslint-disable-next-line no-restricted-syntax -- intentional: per the doc comment above, this resolver never throws — an unmapped line silently yields no `line`.
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Collector attachment.
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RelayPayload = { generation?: unknown; contained?: unknown; message?: unknown; where?: unknown } | undefined;

// Split out of `EarlyObservers.finish`'s relay callback (cognitive-complexity budget) — the two
// authenticated frame kinds that produce a diagnostic, `probes` and `error`.
function recordProbesOutcome(state: ObservationState, payload: RelayPayload): void {
  const contained = payload && typeof payload.contained === 'boolean' ? payload.contained : null;
  state.contained = contained;
  if (contained === false) {
    state.diagnostics.push({
      kind: 'containment_failure',
      severity: 'error',
      message: 'trusted-vantage containment probes reported a breach',
      hint: genericHint('containment_failure'),
    });
  }
}

function recordMountError(state: ObservationState, payload: RelayPayload): void {
  const where = payload && typeof payload.where === 'string' ? payload.where : 'unknown';
  const message = payload && typeof payload.message === 'string' ? payload.message : 'runtime error (no message)';
  state.diagnostics.push({
    kind: 'runtime_throw',
    severity: 'error',
    message: `[${where}] ${message}`,
    hint: genericHint('runtime_throw'),
    // no `.stack` on this channel (loader.js's caught-error frames carry name/message only) —
    // `line` is left unset; a matching CDP `Runtime.exceptionThrown` (below), when the same
    // failure was ALSO uncaught at the JS level, is what supplies it.
  });
}

function genericHint(kind: RuntimeObservedKind): string {
  switch (kind) {
    case 'runtime_throw':
      return 'an uncaught exception escaped the candidate — wrap the risky call or fix the bug it exposes';
    case 'unhandled_rejection':
      return 'a rejected Promise had no .catch — handle the rejection or await it inside a try/catch';
    case 'mount_timeout':
      return 'the candidate likely blocks its first render — check for a synchronous hang or an unresolved dependency before mount';
    case 'run_truncated':
      return 'raise totalBudgetMs or investigate a stuck interaction; the page was hard-killed to bound harness cost';
    case 'containment_failure':
      return 'the sandbox containment probes reported a breach — see the probes payload for which check failed';
  }
}

/**
 * Phase 1 (task 2.1): wire the CDP `Runtime.exceptionThrown` collector onto the FRESH
 * `page`/`context` — BEFORE navigation, via `RunOptions.beforeNavigate`. This is load-bearing,
 * not defensive style: a candidate can throw near-instantly once its module code starts
 * running, well before the nonce-authenticated `toRN()` frame handshake (hello→hostInit→ready→
 * deliver→mount→paint→probes, many event-loop turns) would ever catch it — attaching CDP AFTER
 * `SynthRunSession.openRun` returns (i.e. after navigation) measurably loses that race
 * intermittently. `ctx.sourceMap` (needed for `line` resolution) doesn't exist yet at this
 * point — the build already completed inside `openRun`, but `ctx` itself is only handed back on
 * return — so the exception handler closes over a mutable slot `finish()` fills in.
 */
export async function attachObserversEarly(page: Page, context: BrowserContext): Promise<EarlyObservers> {
  const state: ObservationState = {
    events: [],
    diagnostics: [],
    contained: null,
    paintAtMs: null,
    lastActivityAtMs: Date.now(),
  };
  let sourceMap = '';

  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');
  const onException = (e: { exceptionDetails: { text?: string; exception?: { description?: string }; stackTrace?: { callFrames?: Array<{ url: string; lineNumber: number }> } } }): void => {
    state.lastActivityAtMs = Date.now();
    const details = e.exceptionDetails;
    const kind: RuntimeObservedKind = (details.text || '').includes('(in promise)') ? 'unhandled_rejection' : 'runtime_throw';
    const description = details.exception?.description ?? details.text ?? 'uncaught exception';
    const message = description.split('\n')[0];
    const topFrame = details.stackTrace?.callFrames?.[0];
    let line: number | undefined;
    // Only the candidate's own dynamically-inserted script reports an empty `url` (an
    // "anonymous" script, distinct from the runtime parts' parser-inserted `about:srcdoc`
    // scripts) — resolving anything else would misattribute a host/runtime-internal frame to
    // the candidate's source.
    if (topFrame && topFrame.url === '' && sourceMap) {
      const origin = resolveOriginalLine(sourceMap, topFrame.lineNumber + 1);
      if (origin) line = origin.line;
    }
    state.diagnostics.push({ kind, severity: 'error', message, hint: genericHint(kind), line });
  };
  cdp.on('Runtime.exceptionThrown', onException);

  return {
    state,
    async finish(ctx: RunContext): Promise<AttachedObservers> {
      sourceMap = ctx.sourceMap;
      let generation = 1;

      const relayName = '__whimSynthRelay';
      await ctx.page.exposeFunction(relayName, (raw: string) => {
        state.lastActivityAtMs = Date.now();
        type RelayFrame = { kind?: string; trusted?: boolean; payload?: unknown };
        let msg: RelayFrame | null = null;
        try {
          msg = JSON.parse(raw) as RelayFrame;
        // eslint-disable-next-line no-restricted-syntax -- intentional: a malformed relay frame is dropped, not fatal to the observation session.
        } catch {
          return;
        }
        if (!msg || typeof msg.kind !== 'string') return;
        const kind = msg.kind as ObservedFrameKind;
        const payload = msg.payload as RelayPayload;
        if (payload && typeof payload.generation === 'number') generation = payload.generation;
        const trusted = msg.trusted === true;
        state.events.push({ kind, trusted, atMs: Date.now() - ctx.startedAt, generation, payload: msg.payload });

        if (!trusted) return;
        if (kind === 'paint' && state.paintAtMs === null) state.paintAtMs = Date.now() - ctx.startedAt;
        else if (kind === 'probes') recordProbesOutcome(state, payload);
        else if (kind === 'error') recordMountError(state, payload);
      });

      await ctx.page.evaluate((fnName: string) => {
        const relay = (globalThis as unknown as Record<string, (s: string) => void>)[fnName];
        (globalThis as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView = {
          postMessage(s: string) {
            try {
              relay(s);
            // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort transport stub, mirrors the loader's own postMessage swallow.
            } catch {
              /* best-effort, matches the loader's own transport-stub swallow */
            }
          },
        };
      }, relayName);

      const onConsole = (): void => {
        state.lastActivityAtMs = Date.now();
      };
      ctx.page.on('console', onConsole);

      return {
        state,
        detach(): void {
          ctx.page.off('console', onConsole);
          cdp.off('Runtime.exceptionThrown', onException);
          cdp.detach().catch(() => {
            /* best-effort — the target may already be gone */
          });
        },
      };
    },
  };
}

/**
 * Convenience composition of the two-phase attachment above for a caller that does NOT need to
 * combine `beforeNavigate` with another chain's hook (chain 3's `whimHostDispatch` exposure) —
 * this chain's own acceptance suite uses it. A composing caller (chain 5's assembly) instead
 * calls `attachObserversEarly` directly from its OWN combined `beforeNavigate`.
 */
export async function openObservedRun(
  session: SynthRunSession,
  source: string,
  opts: RunOptions = {},
): Promise<{ ctx: RunContext; obs: AttachedObservers; dispose: () => Promise<void> }> {
  let early: EarlyObservers | undefined;
  const { ctx, dispose } = await session.openRun(source, {
    ...opts,
    beforeNavigate: async (page, context) => {
      early = await attachObserversEarly(page, context);
      if (opts.beforeNavigate) await opts.beforeNavigate(page, context);
    },
  });
  const obs = await early!.finish(ctx);
  return { ctx, obs, dispose };
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog (task 2.2; design D2). Three independently-callable layers so chain 4 (per-action
// quiet windows, called many times during the sweep) and chain 5 (the mount gate + total-budget
// wrapper around the whole run) each call only the layer they own.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RUN_BUDGETS: RunBudgets = {
  mountBudgetMs: 8000,
  actionQuietMs: 300,
  actionHardCapMs: 4000,
  totalBudgetMs: 45000,
};

/** Session/run defaults merged with the caller's overrides (`RunOptions.budgets`) — the merged
 *  result is what `RunReport.budgets` records verbatim (spec: "recorded verbatim"). */
export function mergeBudgets(overrides?: Partial<RunBudgets>): RunBudgets {
  return { ...DEFAULT_RUN_BUDGETS, ...overrides };
}

/**
 * Layer 1 (D2): wait for the nonce-authenticated `paint` frame, up to `budgets.mountBudgetMs`.
 * Also stops early on any diagnostic recorded before paint (a mount-time throw already IS a
 * named outcome; no reason to burn the rest of the budget waiting for a paint that throw
 * prevented). Returns the `mount_timeout` diagnostic when the budget fires with no paint and no
 * prior diagnostic — appended to `obs.state.diagnostics` before returning (never silent) — or
 * `null` when mount succeeded (or already failed) within budget.
 */
export async function awaitMount(obs: AttachedObservers, budgets: RunBudgets): Promise<ObservedDiagnostic | null> {
  const deadline = Date.now() + budgets.mountBudgetMs;
  const POLL_MS = 15;
  while (Date.now() < deadline) {
    if (obs.state.paintAtMs !== null || obs.state.diagnostics.length > 0) return null;
    await sleep(POLL_MS);
  }
  if (obs.state.paintAtMs !== null || obs.state.diagnostics.length > 0) return null;
  const diagnostic: ObservedDiagnostic = {
    kind: 'mount_timeout',
    severity: 'error',
    message: `no nonce-authenticated paint frame within the ${budgets.mountBudgetMs}ms mount budget`,
    hint: genericHint('mount_timeout'),
  };
  obs.state.diagnostics.push(diagnostic);
  return diagnostic;
}

/**
 * Layer 2 (D2): wait for a quiet window (no new FrameEvent/console/CDP activity) of
 * `budgets.actionQuietMs`, hard-capped at `budgets.actionHardCapMs`. NEVER a diagnostic —
 * steady background activity (a legal `interval`) simply rides out the hard cap in silence.
 */
export async function awaitQuiet(obs: AttachedObservers, budgets: RunBudgets): Promise<void> {
  const deadline = Date.now() + budgets.actionHardCapMs;
  const POLL_MS = 15;
  while (Date.now() < deadline) {
    if (Date.now() - obs.state.lastActivityAtMs >= budgets.actionQuietMs) return;
    await sleep(POLL_MS);
  }
}

const TOTAL_BUDGET_TIMEOUT = Symbol('synthrun-total-budget-timeout');
const ABORTED = Symbol('synthrun-total-budget-aborted');

/**
 * Layer 3 (D2): races `work()` against `budgets.totalBudgetMs` and, when supplied, `signal`
 * (chain 6, design D8 — "threaded into `withTotalBudget`", `contract.ts`'s `RunOptions.signal`
 * doc). On overrun, hard-kills `ctx.page` (the runtime page itself stays watchdog-free — ending
 * an overrun run is the harness's job, never the page's own), appends a `run_truncated`
 * diagnostic, and returns `truncated:true`. An abort hard-kills the page THE SAME WAY but never
 * appends a diagnostic and returns `aborted:true` instead — a cancelled run is not a truncated
 * one, and its `RunReport` is discarded by the caller regardless (the machine checks
 * `signal.aborted` itself and never inspects a stage's return value on that path). `work()`'s own
 * eventual settlement (if any) is discarded on either exit.
 */
export async function withTotalBudget<T>(
  ctx: RunContext,
  obs: AttachedObservers,
  budgets: RunBudgets,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<{ truncated: boolean; aborted?: boolean; result?: T }> {
  const raced: Promise<T | typeof TOTAL_BUDGET_TIMEOUT | typeof ABORTED>[] = [
    work(),
    new Promise<typeof TOTAL_BUDGET_TIMEOUT>((resolve) => {
      setTimeout(() => resolve(TOTAL_BUDGET_TIMEOUT), budgets.totalBudgetMs);
    }),
  ];
  if (signal) {
    raced.push(
      new Promise<typeof ABORTED>((resolve) => {
        if (signal.aborted) {
          resolve(ABORTED);
          return;
        }
        signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
      }),
    );
  }
  const outcome = await Promise.race(raced);
  if (outcome === TOTAL_BUDGET_TIMEOUT) {
    obs.state.diagnostics.push({
      kind: 'run_truncated',
      severity: 'error',
      message: `total wall-clock budget (${budgets.totalBudgetMs}ms) exceeded — run killed mid-flight`,
      hint: genericHint('run_truncated'),
    });
    await ctx.page.close().catch(() => {
      /* best-effort — may already be gone */
    });
    return { truncated: true };
  }
  if (outcome === ABORTED) {
    await ctx.page.close().catch(() => {
      /* best-effort — may already be gone */
    });
    return { truncated: false, aborted: true };
  }
  return { truncated: false, result: outcome };
}
