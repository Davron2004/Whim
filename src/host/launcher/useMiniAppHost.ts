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
import { BackPolicy, UNHANDLED_PRESS_WINDOW_MS } from './back-policy';
import { deliverBySourceJs } from './deliver';
import { createCueBackend } from '../cue-backend';

// The append-only capability table (storage + diag + cues), built once for the host (#41 D5). The
// cue backend (RN Vibration + the WhimTone ToneGenerator module) is injected here — the only
// place RN cue APIs meet the bridge; the rows themselves stay RN-free (effects-and-cues D5).
const REGISTRY = createDefaultRegistry({ cueBackend: createCueBackend() });

export interface HostState {
  contained: boolean | null;
  probesFrac: string;
  paintMs: number | null;
  generation: number | null;
  lastTap: string | null;
  rejectedForgeries: number;
  t7AnyPoison: boolean | null;
  lastError: string | null;
  currentApp: string;
  syscalls: number;
  lastSyscall: string | null;
  navDepth: number;
}

const INITIAL: HostState = {
  contained: null, probesFrac: '—', paintMs: null, generation: null,
  lastTap: null, rejectedForgeries: 0, t7AnyPoison: null, lastError: null,
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
}

export interface MiniAppHost {
  runtimeHtml: string;
  webRef: React.RefObject<WebView | null>;
  state: HostState;
  onMessage: (data: string) => void;
  /** Product path: launch an installed app by host record + bundle SOURCE (#5 D3). */
  deliverBySource: (record: AppRecord, source: string, engineAppId?: string) => void;
  /** Dev/probe path: launch a baked fixture by its host record + display name. */
  deliverByRecord: (record: AppRecord, bundleName: string) => void;
  /** The host→realm control surface (injectJavaScript into the OUTER page only). */
  control: (js: string) => void;
  /** Tap the floating affordance / explicit leave (bypasses the realm entirely). */
  exit: () => void;
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
  const onExitRef = useRef<(() => void) | undefined>(opts.onExit);
  onExitRef.current = opts.onExit;

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
        try { live.current.realm.engine?.close(); } catch { /* best effort */ }
      }
      live.current = null;
      if (popTimer.current) { clearTimeout(popTimer.current); popTimer.current = null; }
      const generation = ++genCounter.current;
      engineId.current = engineAppId;
      setS((p) => ({ ...p, currentApp: displayName, lastError: null, navDepth: 0 }));

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
        setS((p) => ({ ...p, lastError: `launch ${displayName}: ${launched.error.kind} — ${launched.error.hint}` }));
        return null;
      }
      live.current = { app: displayName, realm: launched.realm, dispatcher: Dispatcher.forRealm(launched.realm, REGISTRY) };
      // A fresh realm starts at depth 0 — the back-policy fences any stale nav-depth (D4).
      policy.current.reset(generation);
      return launched.realm;
    },
    [],
  );

  const deliverByRecord = useCallback((record: AppRecord, bundleName: string) => {
    const realm = bind(record, bundleName, record.appId);
    if (!realm) return;
    control(`window.__whimControl.reinject({reset:true,bundle:${JSON.stringify(bundleName)},generation:${realm.generation}})`);
  }, [bind, control]);

  const deliverBySource = useCallback((record: AppRecord, source: string, engineAppId?: string) => {
    const id = engineAppId ?? record.appId;
    const realm = bind(record, record.name, id);
    if (!realm) return;
    let js: string;
    try {
      js = deliverBySourceJs({ name: record.name, source, generation: realm.generation });
    } catch (e) {
      setS((p) => ({ ...p, lastError: `deliver ${record.name}: ${(e as Error).message}` }));
      return;
    }
    control(js);
  }, [bind, control]);

  const onMessage = useCallback((data: string) => {
    // UNTRUSTED DATA. Parse defensively; act on nothing; never trust a frame by its `kind`.
    let m: any;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.__whimHostLog === true) { console.log('[whim:page]', m.line); return; }

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
        setS((p) => ({ ...p, paintMs: m.payload?.mountToFirstPaintMs ?? null, generation: m.payload?.generation ?? null }));
        return;
      case 'probes': {
        const r = m.payload || {};
        if (m.trusted !== true) { console.log('[whim] ignoring unauthenticated probes frame'); return; }
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
        return;
      case 'error':
        setS((p) => ({ ...p, lastError: m.payload?.message || m.payload?.name || 'error' }));
        return;
      default:
        return; // unknown kind → ignore (never act on a frame by its tag)
    }
  }, [control]);

  const exit = useCallback(() => {
    if (popTimer.current) { clearTimeout(popTimer.current); popTimer.current = null; }
    if (live.current) {
      tearDownRealm(live.current.realm);
      try { live.current.realm.engine?.close(); } catch { /* best effort */ }
      live.current = null;
    }
    onExitRef.current?.();
  }, []);

  // ── Android system back (#5 D4 — the guaranteed-exit wiring) ────────────────
  // The pure policy decides; the host acts. `forward` posts a nav-back and arms the unhandled-
  // press window; `exit` leaves to the launcher; `ignore` (no realm) lets the OS handle back.
  useEffect(() => {
    const onBack = (): boolean => {
      const action = policy.current.backPress();
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

  return {
    runtimeHtml: RUNTIME_HTML,
    webRef,
    state: s,
    onMessage,
    deliverBySource,
    deliverByRecord,
    control,
    exit,
  };
}
