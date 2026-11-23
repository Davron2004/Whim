/**
 * runtime-message-auth — RN's half of the outer page → RN provenance check (webview-bridge-provenance
 * D1, D2, D5): the per-WebView token, the envelope verifier every consumer of a runtime-page
 * WebView runs first, the exposure canary, and the WebView's exposure record.
 *
 * Pure and RN-free, so the launcher's Node suites drive it directly. The secure random source (the
 * `WhimRandom` TurboModule) is a parameter: Hermes has no `crypto`, and the token has no fallback.
 *
 * The outer page signs every post as `W1.<token>.<JSON>` once RN has delivered the token through
 * `window.__whimControl.auth(token)`; RN compares the fixed 36-character prefix with the WebView's
 * token in constant time before anything reads the body, and drops (and counts) every other
 * message, whatever its kind.
 */

/** Bytes of OS randomness in one token: 128 bits, 32 lowercase hex characters. */
export const RUNTIME_TOKEN_BYTES = 16;

const TOKEN = /^[0-9a-f]{32}$/;
const ENVELOPE_TAG = 'W1.';
/** `W1.` + 32 hex + `.`: the envelope's fixed length, compared whole. */
const PREFIX_LENGTH = ENVELOPE_TAG.length + 2 * RUNTIME_TOKEN_BYTES + 1;

/** The `WhimRandom` module's one method (`src/native/NativeWhimRandom.ts`). */
export interface SecureRandomSource {
  randomHex(byteCount: number): string | null;
}

/**
 * A fresh token from `source`, or `null` when the module is missing, throws, or returns anything
 * but 16 bytes as lowercase hex. There is no fallback: a `null` token means the WebView's messages
 * are all dropped.
 */
export function mintRuntimeToken(source: SecureRandomSource | null | undefined): string | null {
  if (source == null || typeof source.randomHex !== 'function') return null;
  let hex: unknown;
  try {
    hex = source.randomHex(RUNTIME_TOKEN_BYTES);
    // eslint-disable-next-line no-restricted-syntax -- a throwing source is no source: the caller gets no token and reports that (`RuntimeChannelHooks.noToken`)
  } catch {
    return null;
  }
  return typeof hex === 'string' && TOKEN.test(hex) ? hex : null;
}

/** The script that hands `token` to the outer page's main frame (`injectJavaScript`). The page
 *  accepts the first well-formed token of each page load and ignores every later one. */
export function authControlJs(token: string): string {
  if (!TOKEN.test(token)) throw new Error('authControlJs: not a runtime token');
  return `window.__whimControl&&window.__whimControl.auth('${token}');true;`;
}

/** Why a message was dropped: no token for this WebView, no envelope, or another token. */
export type DropReason = 'no-token' | 'unsigned' | 'wrong-token';

export type RuntimeMessageVerdict =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: DropReason };

/**
 * The shared verifier: `raw`'s 36-character envelope compared, in constant time over its fixed
 * length, with the one `token` signs. Returns the JSON body (unparsed) or a drop reason. Nothing
 * past the prefix is read before the compare succeeds.
 */
export function acceptRuntimeMessage(raw: unknown, token: string | null): RuntimeMessageVerdict {
  if (token === null || !TOKEN.test(token)) return { ok: false, reason: 'no-token' };
  if (typeof raw !== 'string' || raw.length < PREFIX_LENGTH) return { ok: false, reason: 'unsigned' };
  const expected = ENVELOPE_TAG + token + '.';
  let diff = 0;
  // eslint-disable-next-line no-bitwise -- the constant-time compare: every character is read, whatever differs first
  for (let i = 0; i < PREFIX_LENGTH; i++) diff |= raw.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: raw.startsWith(ENVELOPE_TAG) ? 'wrong-token' : 'unsigned' };
  return { ok: true, body: raw.slice(PREFIX_LENGTH) };
}

/** The fixed string the exposure probe's navigated document posts straight to any native bridge it
 *  can see (`build/assemble.mjs`). */
export const EXPOSURE_CANARY = 'WHIM-EXPOSURE-CANARY-1';

/** Exact equality, checked before the token: a constant string reads no sender data. */
export function isExposureCanary(raw: unknown): boolean {
  return raw === EXPOSURE_CANARY;
}

export type ExposureOutcome = 'navigated' | 'refused' | 'timedOut';
/** The engine the page reported, within the `device-diagnostics` grammar. */
export type ExposureWebview = `chrome-${number}` | 'webkit';

/** One page load's navigated-frame exposure result, as RN records it. */
export interface ExposureRecord {
  readonly outcome: ExposureOutcome;
  /** Which bridge objects the navigated document saw; both false unless `navigated`. */
  readonly visible: { readonly android: boolean; readonly ios: boolean };
  /** The canary reached RN from this WebView, before or after the report. */
  readonly canaryReachedNative: boolean;
  /** `null` when the page reported `unknown` (or anything outside the grammar): never uploaded. */
  readonly webview: ExposureWebview | null;
}

const OUTCOMES: ReadonlySet<unknown> = new Set<ExposureOutcome>(['navigated', 'refused', 'timedOut']);
const WEBVIEW = /^(?:chrome-\d{1,4}|webkit)$/;

/** A signed `bridge-exposure` payload as a record, or `null` if its outcome is not one of the three. */
function exposureFrom(payload: unknown, canaryReachedNative: boolean): ExposureRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { outcome?: unknown; visible?: { android?: unknown; ios?: unknown } | null; webview?: unknown };
  if (!OUTCOMES.has(p.outcome)) return null;
  const navigated = p.outcome === 'navigated';
  return {
    outcome: p.outcome as ExposureOutcome,
    visible: { android: navigated && p.visible?.android === true, ios: navigated && p.visible?.ios === true },
    canaryReachedNative,
    webview: typeof p.webview === 'string' && WEBVIEW.test(p.webview) ? (p.webview as ExposureWebview) : null,
  };
}

export type ExposureVisible = 'none' | 'android' | 'ios' | 'android+ios';
/** The `device-diagnostics` `exposure` grammar. */
export type ExposureCode = 'refused' | 'timed-out' | `navigated:${ExposureVisible}` | `navigated:${ExposureVisible}+canary`;

/** `record` in the `exposure` grammar: `refused` | `timed-out` | `navigated:<visible>[+canary]`. The
 *  grammar carries the canary on `navigated` only. */
export function exposureCode(record: ExposureRecord): ExposureCode {
  if (record.outcome === 'refused') return 'refused';
  if (record.outcome === 'timedOut') return 'timed-out';
  const { android, ios } = record.visible;
  let visible: ExposureVisible = 'none';
  if (android && ios) visible = 'android+ios';
  else if (android) visible = 'android';
  else if (ios) visible = 'ios';
  return record.canaryReachedNative ? `navigated:${visible}+canary` : `navigated:${visible}`;
}

/** The prefix of the signed body the outer page sends for its exposure report, exactly as its
 *  `toRN({kind:'bridge-exposure',payload:…})` serializes it: no `trusted` field, so no relayed frame
 *  can be read as one. */
const EXPOSURE_BODY = '{"kind":"bridge-exposure","payload":';

/** What a runtime WebView's channel shows: its drops, its canary and its exposure record. */
export interface RuntimeChannelSnapshot {
  /** Messages dropped by this WebView's channel, over its whole life (canary included). */
  readonly dropped: number;
  /** The WebView's token was delivered to its page. */
  readonly authorized: boolean;
  /** The canary reached RN from this WebView. */
  readonly canary: boolean;
  /** The WebView's latest exposure record; `null` until its page's report arrives. */
  readonly exposure: ExposureRecord | null;
}

export interface RuntimeChannelHooks {
  /** The WebView's page loaded and no token could be minted (once per WebView). */
  noToken?: () => void;
  /** The exposure record was set, or changed (a canary after the report). */
  exposure?: (record: ExposureRecord) => void;
}

/**
 * One runtime-page WebView's end of the provenance check: its token, the verifier every message
 * goes through first, the drop counter, the canary and the exposure record. One per WebView
 * instance, for its whole life: a new instance gets a new channel, so a new token.
 *
 * The token is minted at the WebView's first load end and handed over again, unchanged, at every
 * later one. Load starts are never an input: react-native-webview 14 reports them for sub-frames
 * on iOS (an `about:blank` iframe in a page loaded with no base URL counts as the top frame) and for
 * history updates on Android, and a load end can repeat for one page (Android) or be posted by any
 * frame through iOS's history shim. None of these may change the token: the page keeps the first
 * one it is handed, and a token RN changed under it would drop everything it sends.
 */
export class RuntimeChannel {
  private token: string | null = null;
  private minted = false;
  private snap: RuntimeChannelSnapshot = { dropped: 0, authorized: false, canary: false, exposure: null };
  private readonly listeners = new Set<() => void>();
  private readonly settledListeners = new Set<(authorized: boolean) => void>();

  constructor(
    private readonly source: SecureRandomSource | null | undefined,
    private readonly hooks: RuntimeChannelHooks = {},
  ) {}

  /** Hand the WebView's token to its loaded page (`onLoadEnd`) through `inject`, minting it at the
   *  first call. Returns whether a token was delivered; with none (no secure source), nothing is
   *  injected, now or at any later load end. The first call settles the token (`whenSettled`), after
   *  the handover: whatever waited for it reaches a page that holds it. */
  deliver(inject: (js: string) => void): boolean {
    if (!this.minted) {
      this.minted = true;
      this.token = mintRuntimeToken(this.source);
      if (this.token === null) {
        this.hooks.noToken?.();
        this.settle(false);
      }
    }
    if (this.token === null) return false;
    inject(authControlJs(this.token));
    if (!this.snap.authorized) {
      this.set({ authorized: true });
      this.settle(true);
    }
    return true;
  }

  /** The WebView's token was delivered: a launch may be sent to its page. */
  get authorized(): boolean {
    return this.snap.authorized;
  }

  /** The WebView's page loaded and no token could be minted for it (no secure source): none ever
   *  will be, and nothing may be sent to it. */
  get tokenAbsent(): boolean {
    return this.minted && this.token === null;
  }

  /**
   * Calls `settled` once, when the WebView's first load end decides its token: `true` once the
   * token is in its page (`authorized`), `false` when none could be minted (`tokenAbsent`). At once
   * when that is already decided. Until the page loads, nothing can be delivered to it: a launch
   * asked for earlier waits here rather than failing. Returns a cancel.
   */
  whenSettled(settled: (authorized: boolean) => void): () => void {
    if (this.snap.authorized || this.tokenAbsent) {
      settled(this.snap.authorized);
      return () => undefined;
    }
    // A registration of its own, so the same callback asked for twice is cancelled one at a time.
    const waiter = (authorized: boolean) => settled(authorized);
    this.settledListeners.add(waiter);
    return () => {
      this.settledListeners.delete(waiter);
    };
  }

  /**
   * The head of every consumer: the canary is recorded and dropped, anything not signed with the
   * WebView's token is dropped, and the page's exposure report is recorded here. Returns the verified
   * JSON body for the consumer's own branches, or `null` when there is nothing more to do.
   */
  receive(raw: unknown): string | null {
    if (isExposureCanary(raw)) {
      // Usually ahead of the report (the navigated document posts it first); a canary after the
      // report changes the recorded result, which is then reported again.
      const before = this.snap.exposure;
      const exposure = before !== null && !before.canaryReachedNative ? { ...before, canaryReachedNative: true } : before;
      this.set({ dropped: this.snap.dropped + 1, canary: true, exposure });
      if (exposure !== null && exposure !== before) this.hooks.exposure?.(exposure);
      return null;
    }
    const verdict = acceptRuntimeMessage(raw, this.token);
    if (!verdict.ok) {
      this.set({ dropped: this.snap.dropped + 1 });
      return null;
    }
    if (!verdict.body.startsWith(EXPOSURE_BODY)) return verdict.body;
    let frame: { kind?: unknown; payload?: unknown };
    try {
      frame = JSON.parse(verdict.body);
      // eslint-disable-next-line no-restricted-syntax -- the consumer's own parse reports a body that is not JSON
    } catch {
      return verdict.body;
    }
    // Exactly the page's two fields: a body that also carries `trusted` (or anything else) after the
    // payload is some other frame, handed on like any non-report.
    if (Object.keys(frame).length !== 2) return verdict.body;
    const exposure = exposureFrom(frame.payload, this.snap.canary);
    if (exposure !== null) {
      this.set({ exposure });
      this.hooks.exposure?.(exposure);
    }
    return null;
  }

  snapshot(): RuntimeChannelSnapshot {
    return this.snap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: Partial<RuntimeChannelSnapshot>): void {
    this.snap = { ...this.snap, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  private settle(authorized: boolean): void {
    const waiting = [...this.settledListeners];
    this.settledListeners.clear();
    for (const settled of waiting) settled(authorized);
  }
}
