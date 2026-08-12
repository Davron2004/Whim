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
import type { BrowserContext, CDPSession, Frame, Page } from 'playwright';
import { REJECTED_FORGERY_CAP } from './contract';
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
  'containment_unobserved',
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
  /** ms since the observation relay was installed — i.e. since `attachObserversEarly` ran,
   *  immediately before navigation. NOT `RunContext.startedAt`: a frame can now legitimately
   *  arrive before `finish(ctx)` has been called (that is the point of installing the relay
   *  pre-navigation), so `ctx` is not guaranteed to exist when the first frame lands; one
   *  attach-time anchor keeps every frame in a run mutually comparable. */
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
   *  other source (spec §Observation is trusted-vantage only, "Forged verdict attempt").
   *  Three-valued and never collapsed (design D2): `true` held, `false` breach, `null` no
   *  authenticated verdict was ever observed — either no authenticated probes frame arrived, or
   *  the one that did carried no boolean verdict. */
  contained: boolean | null;
  /** How many frame-forgery rejections were observed — the outer page's `rejected-forgery`
   *  events plus the host's own provenance refusals folded into the same tally (see
   *  `hostProvenanceRefusals`), SATURATING at `REJECTED_FORGERY_CAP` — a fixed-size signal no
   *  matter how many frames a candidate posts (design D5). The count only; a forged frame's
   *  attacker-chosen payload is never read, never echoed into a diagnostic, and never carried
   *  onto the report. */
  rejectedForgeries: number;
  /** How many of those rejections the HOST itself made on provenance: a frame that arrived on the
   *  relay binding from a frame other than `page.mainFrame()` — i.e. straight from the candidate's
   *  own realm, never through the outer page's nonce check (spec §Host observation channels are
   *  unreachable from the candidate realm). A strict subset of `rejectedForgeries`, saturating at
   *  the same `REJECTED_FORGERY_CAP` and payload-free for the same reason: the frame is refused
   *  BEFORE it is parsed, so not one attacker-chosen byte is ever read.
   *
   *  Optional only so that a hand-built `ObservationState` literal stays valid;
   *  `attachObserversEarly` always initialises it to `0`, so `undefined` means "this state did not
   *  come from the collector", never "no refusal happened". */
  hostProvenanceRefusals?: number;
  /** ms (on `FrameEvent.atMs`'s attach-time clock) the nonce-authenticated `paint` frame
   *  arrived, else `null`. */
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
  /** Live from the moment `attachObserversEarly` resolves — EVERY collector (CDP exceptions, the
   *  nonce-authenticated frame relay, the console heartbeat) is already attached, so a mount-time
   *  throw, a `delivery`/`paint`/`probes` frame or a console line recorded before `finish()` is
   *  called still lands here (same object, mutated in place). */
  state: ObservationState;
  /** Supplies the one value that cannot exist before navigation — `ctx.sourceMap`, which
   *  `SynthRunSession.openRun` only hands back on return — and yields the attached collectors.
   *  Attachment itself is already complete; this call installs NOTHING. A CDP exception that
   *  arrived first is not left anchorless: its raw wrapped line was kept, and this call resolves
   *  it, so a diagnostic's `line` never depends on whether the throw or the map came first. Call
   *  it exactly once, immediately after `openRun` resolves. */
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

/** An authenticated breach has already been observed in this run. Read from the DIAGNOSTIC rather
 *  than from `state.contained`: the diagnostic is the permanent record of the observation, while
 *  `state.contained` is a cell — sourcing the fence below from the cell would make the fence only as
 *  durable as the last write to it, and any future path that could reset the cell would silently
 *  reopen the `false → … → true` route this fence exists to close. */
function breachAlreadyObserved(state: ObservationState): boolean {
  return state.diagnostics.some((d) => d.kind === 'containment_failure');
}

// Split out of `EarlyObservers.finish`'s relay callback (cognitive-complexity budget) — the two
// authenticated frame kinds that produce a diagnostic, `probes` and `error`.
function recordProbesOutcome(state: ObservationState, payload: RelayPayload): void {
  const contained = payload && typeof payload.contained === 'boolean' ? payload.contained : null;
  // Monotonic and fail-closed (spec "An authenticated containment verdict, once observed, SHALL NOT
  // be silently replaceable by a later frame"). Assigning unconditionally was last-writer-wins,
  // which turns any writable channel into a verdict override. Refusing EVERY later write would be
  // wrong in the opposite direction — a breach observed after the first probes frame is still a
  // breach — so the asymmetry follows the threat: the only dangerous direction is the one that
  // ships an unsafe app, i.e. back up to `contained: true`. Once a breach has been observed it is
  // this run's verdict; `null → true|false` and `true → false|null` still pass straight through.
  if (breachAlreadyObserved(state)) {
    if (contained === true) {
      // "Not silently" is discharged by RECORDING the refusal, not by dropping it quietly, so a
      // suppressed override reads off the report instead of being inferred from its absence. The
      // breach's own kind, because that is still exactly what this run observed — never softened to
      // `containment_unobserved` (`handoff/diagnostic-kind.md`, the no-substitution rule).
      state.diagnostics.push({
        kind: 'containment_failure',
        severity: 'error',
        message: 'a later probes frame claimed containment held after an authenticated breach — refused, the breach verdict stands',
        hint: genericHint('containment_failure'),
      });
    }
    // Anything else here is a no-op: an equal `false` is already recorded, and a malformed payload
    // must not soften an authenticated breach to `containment_unobserved` (same no-substitution
    // rule) — which also denies the `false → null → true` laundering route through this seam.
    return;
  }
  state.contained = contained;
  if (contained === false) {
    // An authenticated verdict that reported a breach — evidence, and the only OBSERVATION that
    // earns this kind (`handoff/diagnostic-kind.md`, the no-substitution rule; the refusal above
    // records this same breach a second time, never a different finding).
    state.diagnostics.push({
      kind: 'containment_failure',
      severity: 'error',
      message: 'trusted-vantage containment probes reported a breach',
      hint: genericHint('containment_failure'),
    });
  } else if (contained === null) {
    // An authenticated frame arrived but carried no boolean verdict: absence of evidence in
    // either direction, so NOT a `containment_failure` (spec "A malformed verdict payload is
    // unobserved, not a breach"). The malformed payload itself is never read or echoed.
    pushContainmentUnobserved(state, 'a nonce-authenticated probes frame carried no boolean containment verdict');
  }
}

/** The one place this kind is minted, so the accompanying-diagnostic invariant ("`null` never
 *  travels without its diagnostic") holds from a single site — and so it can never be pushed
 *  twice for one run. */
function pushContainmentUnobserved(state: ObservationState, message: string): ObservedDiagnostic | null {
  if (state.diagnostics.some((d) => d.kind === 'containment_unobserved')) return null;
  const diagnostic: ObservedDiagnostic = {
    kind: 'containment_unobserved',
    severity: 'error',
    message,
    hint: genericHint('containment_unobserved'),
  };
  state.diagnostics.push(diagnostic);
  return diagnostic;
}

/**
 * Report-composition close-out (spec "An unobserved verdict is not a negative one"): a run that
 * ends with `state.contained === null` never saw an authenticated verdict at all, so it carries
 * `containment_unobserved` — appended to `state.diagnostics` before the caller copies them, never
 * silent, and never a substitute for `mount_timeout` or `containment_failure` (both of which may
 * legitimately sit beside it when their own conditions independently held).
 *
 * Idempotent: a malformed-payload frame already recorded the kind, and this returns `null` rather
 * than duplicating it. Returns the diagnostic it appended, `null` when it appended none.
 */
export function finalizeContainmentVerdict(state: ObservationState): ObservedDiagnostic | null {
  if (state.contained !== null) return null;
  return pushContainmentUnobserved(state, 'the run ended with no nonce-authenticated probes frame — containment was never verified');
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
    case 'containment_unobserved':
      return 'no authenticated containment verdict was observed — this run proves nothing about containment; re-run it and treat the candidate as unverified, not as escaped';
  }
}

/** The host relay binding `installRelayShim` below reads and then scrubs. Exported so a caller
 *  (the suite's confinement assertion) names the SAME string this module installs rather than a
 *  second copy that could drift. */
export const RELAY_BINDING_NAME = '__whimSynthRelay';

/**
 * The main-frame-confined transport install (spec §Observation is trusted-vantage only, "That
 * installation SHALL be confined to the main frame"). Registered pre-navigation so it is already
 * in place when the delivered page's inline scripts run, and it runs FIRST in every document —
 * which is exactly what makes the confinement enforceable rather than merely intended:
 *
 *  - in EVERY realm it deletes the exposed relay binding from the global. Playwright's
 *    `page.exposeBinding` defines its wrapper in every frame of the page, the opaque-origin
 *    sandboxed iframe included (measured) — so scrubbing it here removes the NAME from the realm
 *    `loader.js`/`probes.js` rely on being free of it (#35/#37, F4). Defence in depth only, and
 *    deliberately NOT load-bearing (design D4): the raw CDP binding underneath is installed on the
 *    global of every execution context of the target and can be re-minted inside the sandbox realm
 *    from Playwright's own binding controller. What makes the channel inert is the host-side
 *    provenance guard on the callback, below;
 *  - only in the MAIN frame does it define the `ReactNativeWebView` transport `assemble.mjs`'s
 *    `toRN()`/`rnLog()` post through, closing over the captured reference. The sandbox realm
 *    keeps `loader.js`'s own same-named stub, untouched.
 *
 * A pre-navigation `page.evaluate` cannot serve here: its global belongs to the pre-navigation
 * `about:blank` document and is gone the moment the candidate page commits (measured).
 */
function installRelayShim(name: string): void {
  const g = globalThis as unknown as Record<string, unknown> & { top?: unknown };
  const relay = g[name] as ((s: string) => void) | undefined;
  try {
    delete g[name];
  // eslint-disable-next-line no-restricted-syntax -- intentional: a non-configurable binding just stays visible; nothing here can recover from that, and throwing would abort the document's first script.
  } catch {
    /* non-configurable — nothing further this script can do */
  }
  if (g.top !== g) return; // every non-main frame (the sandbox realm included) installs NOTHING
  if (typeof relay !== 'function') return;
  (g as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView = {
    postMessage(s: string) {
      try {
        relay(s);
      // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort transport stub, mirrors the loader's own postMessage swallow.
      } catch {
        /* best-effort, matches the loader's own transport-stub swallow */
      }
    },
  };
}

/**
 * Attach EVERY trusted-vantage collector onto the FRESH `page`/`context` — BEFORE navigation,
 * via `RunOptions.beforeNavigate`. All three halves are load-bearing here, not defensive style:
 *
 *  - CDP `Runtime.exceptionThrown`: a candidate can throw near-instantly once its module code
 *    starts running, well before the nonce-authenticated `toRN()` frame handshake (hello→
 *    hostInit→ready→deliver→mount→paint→probes, many event-loop turns) would ever catch it;
 *  - the nonce-authenticated frame relay: the outer page emits `delivery` ~3ms and `paint`/
 *    `probes` ~20ms after `page.goto`'s `load` resolves (measured), so a relay opened after
 *    `openRun` returns races those frames and drops the ones it loses — `toRN()` discards a
 *    frame at the source when no transport exists, so there is nothing to replay (spec: "no
 *    frame the outer page emits between document commit and load is dropped");
 *  - `page.on('console')`: `rnLog()`'s console fallback fires on that same pre-`load` timeline.
 *
 * Opening the transport earlier does NOT widen what is trusted: the nonce check happens in the
 * outer page before any `toRN({trusted:true})`, and this collector consumes `msg.trusted`
 * verbatim. `ctx.sourceMap` (needed for `line` resolution) doesn't exist yet at this point — the
 * build already completed inside `openRun`, but `ctx` itself is only handed back on return — so
 * the exception handler closes over a mutable slot `finish()` fills in, and resolves each
 * exception's anchor against that slot's eventual value rather than its value on arrival (see
 * `anchorOriginalLine` below).
 */
export async function attachObserversEarly(page: Page, context: BrowserContext): Promise<EarlyObservers> {
  const state: ObservationState = {
    events: [],
    diagnostics: [],
    contained: null,
    rejectedForgeries: 0,
    hostProvenanceRefusals: 0,
    paintAtMs: null,
    lastActivityAtMs: Date.now(),
  };
  let sourceMap = '';
  // A CDP exception can legitimately land BEFORE `finish(ctx)` fills the slot above: `openRun`'s
  // navigation awaits the OUTER page's `load`, and the candidate's own deliver→mount→throw races
  // it — with four concurrent contexts the throw wins ~37% of runs (measured). Resolving the
  // anchor from whatever the slot happened to hold on arrival therefore dropped `line` at random.
  // Instead the raw wrapped line is retained and the anchor is resolved once, whenever the map
  // becomes available — so a diagnostic's `line` is a function of the evidence, never of arrival
  // order. Nothing is retried and no window is widened: `finish()` drains this exactly once.
  const unanchored: { diagnostic: ObservedDiagnostic; wrappedLine: number }[] = [];
  const anchorOriginalLine = (diagnostic: ObservedDiagnostic, wrappedLine: number): void => {
    if (!sourceMap) {
      unanchored.push({ diagnostic, wrappedLine });
      return;
    }
    const origin = resolveOriginalLine(sourceMap, wrappedLine);
    if (origin) diagnostic.line = origin.line;
  };
  // The one clock every FrameEvent is stamped against (`FrameEvent.atMs`) — fixed at attach, i.e.
  // immediately pre-navigation, because a frame can now arrive before `finish(ctx)` supplies a
  // `RunContext` at all.
  const observationStartedAt = Date.now();
  let generation = 1;

  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');
  const onException = (e: { exceptionDetails: { text?: string; exception?: { description?: string }; stackTrace?: { callFrames?: Array<{ url: string; lineNumber: number }> } } }): void => {
    state.lastActivityAtMs = Date.now();
    const details = e.exceptionDetails;
    const kind: RuntimeObservedKind = (details.text || '').includes('(in promise)') ? 'unhandled_rejection' : 'runtime_throw';
    const description = details.exception?.description ?? details.text ?? 'uncaught exception';
    const message = description.split('\n')[0];
    const topFrame = details.stackTrace?.callFrames?.[0];
    const diagnostic: ObservedDiagnostic = { kind, severity: 'error', message, hint: genericHint(kind) };
    state.diagnostics.push(diagnostic);
    // Only the candidate's own dynamically-inserted script reports an empty `url` (an
    // "anonymous" script, distinct from the runtime parts' parser-inserted `about:srcdoc`
    // scripts) — resolving anything else would misattribute a host/runtime-internal frame to
    // the candidate's source.
    if (topFrame && topFrame.url === '') anchorOriginalLine(diagnostic, topFrame.lineNumber + 1);
  };
  cdp.on('Runtime.exceptionThrown', onException);

  // `exposeBinding`, never `exposeFunction`: only the former keeps the `{context, page, frame}`
  // source Playwright resolves for every call from the CALLING execution context's browser-supplied
  // `auxData` — `exposeFunction` is literally `exposeBinding` with a wrapper that throws that
  // argument away. It matters because the raw CDP binding underneath is installed on the global of
  // EVERY execution context of the target (the opaque-origin sandboxed srcdoc included) and can be
  // re-minted there from Playwright's own binding controller, so no amount of name-scrubbing makes
  // this channel unreachable. Provenance is what makes it INERT instead: frame identity is derived
  // by the browser and never from page-supplied data, so the candidate keeps the ability to CALL and
  // loses the ability to be BELIEVED (spec §Host observation channels are unreachable from the
  // candidate realm; design D1). This is an ADDITIONAL necessary condition, never a replacement for
  // `msg.trusted` — a frame must be BOTH main-frame-originated AND tagged trusted by the outer page.
  await page.exposeBinding(RELAY_BINDING_NAME, (source: { frame: Frame }, raw: string) => {
    if (source.frame !== page.mainFrame()) {
      // Refused BEFORE parsing and before anything else in `state` moves: no event, no verdict, no
      // diagnostic, no generation update — and deliberately not even `lastActivityAtMs`, or a
      // candidate could hold the quiet window open from a realm the harness does not trust. The two
      // saturating counters are the whole effect, so the attempt is visible in the report
      // (`RunReport.forgeries`) at fixed size, and payload-free because `raw` is never read.
      state.rejectedForgeries = Math.min(state.rejectedForgeries + 1, REJECTED_FORGERY_CAP);
      state.hostProvenanceRefusals = Math.min((state.hostProvenanceRefusals ?? 0) + 1, REJECTED_FORGERY_CAP);
      return;
    }
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
    state.events.push({ kind, trusted, atMs: Date.now() - observationStartedAt, generation, payload: msg.payload });

    // A frame the outer page REJECTED as a forgery (never trusted): record the fact via a count
    // that saturates at the declared cap, and nothing else — no payload is read, so a flood of
    // large attacker-chosen frames costs a fixed-size signal (design D5).
    if (kind === 'rejected-forgery' && state.rejectedForgeries < REJECTED_FORGERY_CAP) state.rejectedForgeries++;

    if (!trusted) return;
    if (kind === 'paint' && state.paintAtMs === null) state.paintAtMs = Date.now() - observationStartedAt;
    else if (kind === 'probes') recordProbesOutcome(state, payload);
    else if (kind === 'error') recordMountError(state, payload);
  });
  // ORDER IS LOAD-BEARING, and silently so (design D4). Each init script is registered with the
  // browser as it is added here, and the delivered document runs them in that registration order —
  // so `installRelayShim` can capture-then-scrub the relay only because the binding above was
  // exposed FIRST. Swap these two lines and the shim runs ahead of the binding script: it captures
  // nothing, so it installs no `ReactNativeWebView` transport and the outer page silently drops
  // every frame it emits, while the scrub deletes a name that does not exist yet and the relay's
  // own wrapper then lands in every realm unscrubbed. No type error and no fast-gate failure (the
  // scrub is defence in depth, not the guarantee); what catches it is the acceptance suite, whose
  // capability-reachability and pre-`load`-frame cases both need this transport live.
  await page.addInitScript(installRelayShim, RELAY_BINDING_NAME);

  const onConsole = (): void => {
    state.lastActivityAtMs = Date.now();
  };
  page.on('console', onConsole);

  const attached: AttachedObservers = {
    state,
    detach(): void {
      page.off('console', onConsole);
      cdp.off('Runtime.exceptionThrown', onException);
      cdp.detach().catch(() => {
        /* best-effort — the target may already be gone */
      });
    },
  };

  return {
    state,
    finish(ctx: RunContext): Promise<AttachedObservers> {
      sourceMap = ctx.sourceMap;
      // Every exception that beat the map to the collector gets its anchor now — the map is
      // certainly present from here on, so later exceptions resolve inline and this drains empty.
      for (const pending of unanchored.splice(0)) anchorOriginalLine(pending.diagnostic, pending.wrappedLine);
      return Promise.resolve(attached);
    },
  };
}

/**
 * Convenience composition of the two-phase attachment above for a caller that does NOT need to
 * combine `beforeNavigate` with another chain's hook (chain 3's `whimHostDispatch` exposure) —
 * this chain's own acceptance suite uses it. A composing caller (chain 5's assembly, `report.ts`)
 * instead calls `attachObserversEarly` directly from its OWN combined `beforeNavigate`.
 *
 * Both compositions have the same shape and the same contract: attach inside `beforeNavigate`
 * (every collector is live from there on), then call `finish(ctx)` once `openRun` returns purely
 * to hand over `ctx.sourceMap`.
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
