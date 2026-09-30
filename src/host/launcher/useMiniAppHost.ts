// ─────────────────────────────────────────────────────────────────────────────
// useMiniAppHost — the reusable mini-app realm loop (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// The realm loop that used to live inline in WebViewHost, extracted so BOTH the product
// MiniAppView (launch by host record + bundle source) and the DevProbeScreen (launch baked
// fixtures by name) drive the identical machinery. NOTHING about realm/dispatcher binding
// changes — the cap-intruder lesson (ALWAYS bind a realm + dispatcher, even for a zero-capability
// app) is preserved by construction because the loop moved verbatim (D6).
//
// It also owns the HOST half of the back-navigation seam (#5 D4): it tracks relayed nav-depth
// HINTS (never authority), forwards a nav-back request on a `forward` verdict, arms the
// unhandled-press window, and exits to the launcher on an `exit` verdict — all through the pure
// back-policy. The guaranteed-exit invariant lives here and in the floating affordance.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { WebView } from 'react-native-webview';
import { RUNTIME_HTML } from '../../runtime/generated/runtime-html';
import {
  createDefaultRegistry,
  Dispatcher,
  launchApp,
  tearDownRealm,
  type AppRecord,
  type RealmRecord,
} from '../bridge';
import { createStorageEngine } from '../storage-engine';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { BackPolicy, UNHANDLED_PRESS_WINDOW_MS } from './back-policy';
import { createStartupDeadline, type StartupDeadline } from './boot-state';
import { deliverBySourceJs } from './deliver';
import { createCueBackend } from '../cue-backend';
import { tearDownLiveRealm } from './teardown';

// The append-only capability table (storage + diag + cues), built once for the host (#41 D5). The
// cue backend (RN Vibration + the WhimTone ToneGenerator module) is injected here — the only
// place RN cue APIs meet the bridge; the rows themselves stay RN-free (effects-and-cues D5).
const REGISTRY = createDefaultRegistry({ cueBackend: createCueBackend() });

// The `error` frame's `where` values a bundle can never recover a paint from (loader.js: no
// AppSpec export, a mount throw, the delivery wrapper itself throwing before any script even
// runs, or a render error no boundary in the app caught, which unmounts the app before or after
// its first paint) -- distinct from post-paint diagnostics (e.g. `where: 'probes'`), which stay
// diagnostic-only and never escalate into the product's full-screen recovery surface.
function isFatalErrorWhere(where: unknown): boolean {
  return where === 'bundle' || where === 'mount' || where === 'deliver' || where === 'render';
}

/** Uncaught errors the loader reports from inside the running realm (a handler or timer throw,
 *  an unhandled rejection). Not fatal -- the app keeps its WebView -- but each one is a failure. */
function isRealmErrorWhere(where: unknown): boolean {
  return where === 'runtime' || where === 'rejection';
}

/** The error's class name from a loader `error` frame. Frames never carry message or stack; a
 *  frame without a name (loader.js's missing-AppSpec case) is a plain `Error`. */
function frameErrorClass(payload: any): string {
  return typeof payload?.name === 'string' && payload.name ? payload.name : 'Error';
}

/** An accepted delivery restarts the deadline so a normally delayed loader still receives the
 *  established full six-second paint allowance. A refused delivery has its fatal `error` frame. */
function handleDeliveryFrame(payload: any, startupDeadline: StartupDeadline): void {
  if (payload?.accepted === true) startupDeadline.begin();
}

/** A `paint` frame ends the container's boot state (`boot-state.ts`) and disarms the watchdog --
 *  but only when it is nonce-authenticated (`paintAccepted`), the same trust check `probes`
 *  applies. It is NOT generation-fenced like `nav-depth`: the outer page forwards `paint`
 *  verbatim, so its `payload.generation` is the iframe-local counter and means nothing here
 *  (`boot-state.ts` carries the full reasoning). `generation` on HostState is owned by the
 *  `probes` branch alone. */
function handlePaintFrame(frame: any, startupDeadline: StartupDeadline, setS: (fn: (p: HostState) => HostState) => void): void {
  if (!startupDeadline.acceptPaint(frame)) return;
  setS((p) => ({ ...p, paintMs: frame.payload?.mountToFirstPaintMs ?? null }));
}

/** An `error` frame only escalates to the recoverable-error surface for fatal `where`s -- a
 *  non-fatal diagnostic (e.g. a post-paint probes failure) never triggers a full-screen takeover
 *  on an otherwise-healthy running app. Fatal frames and uncaught realm errors (`runtime`,
 *  `rejection`) each emit an `error` record; `appId` stays on the device (the allowlist drops it). */
function handleErrorFrame(
  frame: any,
  appId: string | null,
  startupDeadline: StartupDeadline,
  setS: (fn: (p: HostState) => HostState) => void,
): void {
  // Only the outer page's nonce-authenticated forward counts (F4): an unauthenticated frame is
  // neither a failure screen nor an error record.
  if (frame.trusted !== true) return;
  const payload = frame.payload;
  if (isRealmErrorWhere(payload?.where)) {
    log.error(CHANNELS.page, 'mini-app error', { where: payload.where, errorClass: frameErrorClass(payload), appId });
    return;
  }
  if (!isFatalErrorWhere(payload?.where)) {
    // Record-don't-swallow (the same convention this file uses elsewhere): a non-fatal frame
    // never escalates to the product surface, but it must not vanish either -- DevProbeScreen's
    // own diagnostic display reads state.lastError, so a purely-dropped frame here would silently
    // stop showing up anywhere.
    log.debug(CHANNELS.page, 'non-fatal error frame from the realm', { where: payload?.where, detail: payload?.message ?? payload?.name });
    return;
  }
  startupDeadline.cancel();
  log.error(CHANNELS.page, 'mini-app failed', { where: payload.where, errorClass: frameErrorClass(payload), appId });
  setS((p) => ({ ...p, lastError: payload?.message || payload?.name || 'error' }));
}

export interface HostState {
  contained: boolean | null;
  probesFrac: string;
  /** Mount→first-paint for the CURRENTLY bound realm, or null when this realm has not painted yet
   *  (`bind()` resets it). Non-null is the "has painted" signal `boot-state.ts` derives from — the
   *  container's boot state needs no bridge message of its own. */
  paintMs: number | null;
  generation: number | null;
  lastTap: string | null;
  rejectedForgeries: number;
  t7AnyPoison: boolean | null;
  lastError: string | null;
  /** True exactly when the most recent bind() attempt was refused pre-delivery by launchApp
   *  (a structured launch failure, #41 D7) -- distinct from a later deliver/bundle error, so the
   *  product surface can show honest copy for this one case without misreading other errors. */
  launchFailed: boolean;
  currentApp: string;
  syscalls: number;
  lastSyscall: string | null;
  navDepth: number;
}

const INITIAL: HostState = {
  contained: null, probesFrac: '—', paintMs: null, generation: null,
  lastTap: null, rejectedForgeries: 0, t7AnyPoison: null, lastError: null, launchFailed: false,
  currentApp: '—', syscalls: 0, lastSyscall: null, navDepth: 0,
};

/** The live bridge realm the host is serving (one at a time — one WebView == one realm). */
interface LiveRealm {
  app: string;
  realm: RealmRecord;
  dispatcher: Dispatcher;
}

export interface UseMiniAppHostOptions {
  /** Called when the guaranteed-exit policy (or the floating affordance) decides to leave. */
  onExit?: () => void;
  /** True while a host-layer sheet (the report sheet) covers this realm — a back press then
   *  resolves to `close-overlay` instead of forwarding into the realm or counting toward the
   *  guaranteed-exit policy (mini-app-back-navigation delta, design D14). */
  overlayOpen?: boolean;
  /** Called when a back press resolves to `close-overlay` — the caller closes its own sheet. */
  onCloseOverlay?: () => void;
}

export interface MiniAppHost {
  runtimeHtml: string;
  webRef: React.RefObject<WebView | null>;
  state: HostState;
  onMessage: (data: string) => void;
  /** Launch a host record by bundle SOURCE (#5 D3) — the product path, and (review fix F3) the
   *  dev probe's fixture buttons too, both reading the same real bundle text rather than a
   *  page-side deliver-by-name lookup. */
  deliverBySource: (record: AppRecord, source: string, engineAppId?: string, theme?: object) => void;
  /** The host→realm control surface (injectJavaScript into the OUTER page only). */
  control: (js: string) => void;
  /** Tap the floating affordance / explicit leave (bypasses the realm entirely). */
  exit: () => void;
  /** Clear a post-delivery `lastError` WITHOUT tearing down or rebinding the realm -- paired with
   *  a WebView remount (a fresh `key`) by the caller so Retry falls through the error branch into
   *  a normal render, whose `onLoadEnd` re-runs `deliverBySource` → `bind()` into a fresh realm. */
  clearLastError: () => void;
}

export function useMiniAppHost(opts: UseMiniAppHostOptions = {}): MiniAppHost {
  const webRef = useRef<WebView | null>(null);
  const [s, setS] = useState<HostState>(INITIAL);
  // Refs (not state) so onMessage / the back handler always see the current values w/o re-binding.
  const live = useRef<LiveRealm | null>(null);
  const genCounter = useRef(1);
  const policy = useRef(new BackPolicy());
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The runtime engine appId for the live realm (the launcher id, #5 D8 — a fork's own data).
  const engineId = useRef<string | null>(null);
  const startupDeadline = useRef(createStartupDeadline(() => {
    log.error(CHANNELS.page, 'mini-app failed', { where: 'paint-timeout', errorClass: 'StartupDeadline', appId: engineId.current });
    setS((p) => (
      p.lastError || p.paintMs !== null
        ? p
        : { ...p, lastError: 'app never became visible' }
    ));
  }));
  const onExitRef = useRef<(() => void) | undefined>(opts.onExit);
  onExitRef.current = opts.onExit;
  // Read fresh on every render (never re-subscribes the BackHandler listener below) — the same
  // ref idiom onExitRef uses.
  const overlayOpenRef = useRef(opts.overlayOpen ?? false);
  overlayOpenRef.current = opts.overlayOpen ?? false;
  const onCloseOverlayRef = useRef<(() => void) | undefined>(opts.onCloseOverlay);
  onCloseOverlayRef.current = opts.onCloseOverlay;

  // The host→page control surface (#41 seam + F4 negative control + sysret relay + nav-back).
  // injectJavaScript runs in the OUTER page only; it cannot reach into the cross-origin iframe.
  const control = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`try{${js}}catch(e){};true;`);
  }, []);

  // Bind a fresh realm + dispatcher at a NEW generation, then reset the iframe and deliver. The
  // engine appId is the LAUNCHER id (#5 D8) so a fork gets its own user data even when it shares
  // a version-store repo; `record` carries the manifest + schema the gate enforces (#41 D4).
  const bind = useCallback(
    (record: AppRecord, displayName: string, engineAppId: string): RealmRecord | null => {
      if (live.current) {
        tearDownRealm(live.current.realm); // fence the old realm's late results
        // Best effort: the old realm is already fenced, so a failed close costs the user nothing
        // — but it is a real defect (a leaked handle) and is recorded rather than swallowed.
        try {
          live.current.realm.engine?.close();
        } catch (e) {
          log.warn(CHANNELS.app, 'storage engine close failed', {
            operation: 'rebind',
            errorClass: e instanceof Error ? e.constructor.name : typeof e,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      live.current = null;
      if (popTimer.current) { clearTimeout(popTimer.current); popTimer.current = null; }
      startupDeadline.current.cancel();
      const generation = ++genCounter.current;
      engineId.current = engineAppId;
      // paintMs is reset with the rest: it is the "has painted" signal the container's boot state
      // reads (`boot-state.ts`), so a PREVIOUS realm's paint must never make the next launch look
      // already-up and skip the boot state.
      setS((p) => ({ ...p, currentApp: displayName, lastError: null, launchFailed: false, navDepth: 0, paintMs: null }));

      // ALWAYS bind a realm + dispatcher — even for a zero-capability app — so a bundle that
      // syscalls anyway (the cap-intruder) is DENIED with a structured error, not dropped into a
      // timeout. launchApp opens an engine only if storage is declared. The engine is opened
      // under the LAUNCHER id (engineAppId), not the bundle's appId.
      const launched = launchApp(
        { ...record, appId: engineAppId },
        (appId) => createStorageEngine({ appId, mode: 'persistent' }),
        generation,
      );
      if (!launched.ok) {
        log.error(CHANNELS.page, 'mini-app failed', { where: 'launch', errorClass: launched.error.kind, appId: engineAppId });
        setS((p) => ({ ...p, lastError: `launch ${displayName}: ${launched.error.kind} — ${launched.error.hint}`, launchFailed: true }));
        return null;
      }
      live.current = { app: displayName, realm: launched.realm, dispatcher: Dispatcher.forRealm(launched.realm, REGISTRY) };
      // A fresh realm starts at depth 0 — the back-policy fences any stale nav-depth (D4).
      policy.current.reset(generation);
      return launched.realm;
    },
    [],
  );

  const deliverBySource = useCallback((record: AppRecord, source: string, engineAppId?: string, theme?: object) => {
    const id = engineAppId ?? record.appId;
    const realm = bind(record, record.name, id);
    if (!realm) return;
    let js: string;
    try {
      js = deliverBySourceJs({ name: record.name, source, generation: realm.generation, theme });
    } catch (e) {
      log.error(CHANNELS.page, 'mini-app failed', { where: 'launch', errorClass: e instanceof Error ? e.name : typeof e, appId: id });
      setS((p) => ({ ...p, lastError: `deliver ${record.name}: ${(e as Error).message}` }));
      return;
    }
    // Start before page control: native loader/rule-list failure can suppress every page frame.
    startupDeadline.current.begin();
    control(js);
  }, [bind, control]);

  const onMessage = useCallback((data: string) => {
    // UNTRUSTED DATA. Parse defensively; act on nothing; never trust a frame by its `kind`.
    let m: any;
    try {
      m = JSON.parse(data);
    } catch (e) {
      // The frame is dropped either way — nothing is acted on — but a page that cannot even
      // produce JSON is a defect worth seeing, so it is recorded at debug rather than returned on.
      log.debug(CHANNELS.page, 'frame from the sandboxed page is not JSON', {
        detail: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    if (!m || typeof m !== 'object') return;

    if (m.__whimHostLog === true) { log.debug(CHANNELS.page, 'relayed page log', { line: m.line }); return; }

    switch (m.kind) {
      case 'syscall': {
        const lr = live.current;
        if (!lr) return;
        lr.dispatcher.handle(m.payload).then((sysret) => {
          if (!sysret) return; // dropped (stale generation / torn-down realm)
          control(`window.__whimRelaySysret(${JSON.stringify(JSON.stringify(sysret))})`);
          setS((p) => ({
            ...p,
            syscalls: p.syscalls + 1,
            lastSyscall: `${m.payload?.method ?? '?'} → ${sysret.ok ? 'ok' : 'err:' + (sysret.error?.kind ?? '?')}`,
          }));
        });
        return;
      }
      case 'nav-depth': {
        // An SDK nav-depth HINT (#5 D4). Already source-checked + generation-stamped by the outer
        // page; the back-policy treats it as a hint and fences stale generations.
        const depth = typeof m.payload?.depth === 'number' ? m.payload.depth : 0;
        const generation = typeof m.payload?.generation === 'number' ? m.payload.generation : -1;
        policy.current.navDepth(depth, generation);
        setS((p) => ({ ...p, navDepth: policy.current.snapshot.depth }));
        return;
      }
      case 'ui-event':
        setS((p) => ({ ...p, lastTap: `${m.payload?.type ?? '?'} "${m.payload?.label ?? ''}"` }));
        return;
      case 'paint':
        handlePaintFrame(m, startupDeadline.current, setS);
        return;
      case 'probes': {
        const r = m.payload || {};
        if (m.trusted !== true) { log.warn(CHANNELS.app, 'ignoring unauthenticated probes frame', {}); return; }
        setS((p) => ({
          ...p,
          contained: !!r.contained,
          probesFrac: (r.passed ?? '?') + '/' + (r.total ?? '?'),
          generation: r.generation ?? p.generation,
          t7AnyPoison: r.t7 ? !!r.t7.anyPoison : p.t7AnyPoison,
        }));
        return;
      }
      case 'rejected-forgery':
        setS((p) => ({ ...p, rejectedForgeries: p.rejectedForgeries + 1 }));
        return;
      case 'delivery':
        handleDeliveryFrame(m.payload, startupDeadline.current);
        return;
      case 'error':
        handleErrorFrame(m, engineId.current, startupDeadline.current, setS);
        return;
      default:
        return; // unknown kind → ignore (never act on a frame by its tag)
    }
  }, [control]);

  const exit = useCallback(() => {
    startupDeadline.current.cancel();
    tearDownLiveRealm(live, popTimer);
    onExitRef.current?.();
  }, []);

  const clearLastError = useCallback(() => {
    // Disarm the paint watchdog too -- otherwise an accepted delivery whose watchdog is still
    // ticking (fatal error landed before paint) can fire AFTER Retry clears lastError but before
    // the new WebView's onLoadEnd re-delivers into a fresh realm, re-setting lastError for an
    // invisible reason.
    startupDeadline.current.cancel();
    setS((p) => ({ ...p, lastError: null }));
  }, []);

  // ── Android system back (#5 D4 — the guaranteed-exit wiring) ────────────────
  // The pure policy decides; the host acts. `forward` posts a nav-back and arms the unhandled-
  // press window; `exit` leaves to the launcher; `ignore` (no realm) lets the OS handle back.
  useEffect(() => {
    const onBack = (): boolean => {
      const action = policy.current.backPress(overlayOpenRef.current);
      if (action === 'close-overlay') { onCloseOverlayRef.current?.(); return true; }
      if (action === 'forward') {
        control('window.__whimControl.navBack()');
        if (popTimer.current) clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => { policy.current.timeout(); }, UNHANDLED_PRESS_WINDOW_MS);
        return true; // handled — do not exit
      }
      if (action === 'exit') { exit(); return true; }
      return false; // ignore → default back (no realm bound)
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => {
      sub.remove();
      if (popTimer.current) { clearTimeout(popTimer.current); popTimer.current = null; }
    };
  }, [control, exit]);

  // ── Unmount teardown (E2 — self-enforcing realm cleanup) ─────────────────────
  // Runs ONLY on unmount (empty deps). Reads `live` and `popTimer` as refs so the closure is
  // never stale. Does NOT call onExit — unmount already means leaving; onExit is the exit()-path
  // caller's responsibility (explicit user-initiated leave only).
  useEffect(() => () => { tearDownLiveRealm(live, popTimer); startupDeadline.current.cancel(); }, []);

  return {
    runtimeHtml: RUNTIME_HTML,
    webRef,
    state: s,
    onMessage,
    deliverBySource,
    control,
    exit,
    clearLastError,
  };
}
