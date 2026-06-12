// ─────────────────────────────────────────────────────────────────────────────
// WebViewHost — the RN host end of the Whim runtime (the trusted host).
// ─────────────────────────────────────────────────────────────────────────────
// Renders ONE full-screen react-native-webview that loads the self-contained RUNTIME_HTML
// (a cross-origin sandboxed iframe under the locked #35 CSP; the tip-splitter is delivered
// over channel (b) and mounted React-to-DOM inside the iframe). The host:
//   • receives iframe→host frames relayed by the WebView page via `onMessage` (§5.6 / §1.5);
//   • treats EVERY inbound message as UNTRUSTED DATA (constraint #4) — it only logs/displays,
//     it executes nothing, and it trusts a containment verdict only when the page already
//     authenticated it (msg.trusted === true, the per-realm nonce check in the page);
//   • drives the realm-reset seam (constraint #5) and the F4 negative control by calling the
//     page's window.__whimControl over injectJavaScript;
//   • is the capability-bridge HOST (Decision #41): for an app that declares capabilities it
//     launches the per-app storage engine, opens the schema, binds a realm + dispatcher, and
//     answers each inbound syscall frame by injecting __whimRelaySysret back into the page.
// The host holds NO capability the bundle can reach: the only crossing is this one-way string
// transport, and identity is channel-derived (one WebView == one realm == one app — D2).
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { RUNTIME_HTML } from '../runtime/generated/runtime-html';
import { APP_RECORDS } from '../runtime/generated/app-records';
import {
  createDefaultRegistry,
  Dispatcher,
  launchApp,
  tearDownRealm,
  type RealmRecord,
} from './bridge';
import { createStorageEngine } from './storage-engine';

// The append-only capability table (storage + diag), built once for the host (D5).
const REGISTRY = createDefaultRegistry();

// The bridge apps the host can deliver on-device (each has a host-held record extracted at
// build time). tip-splitter is the Tier-0 default the runtime autostarts.
const DELIVERABLE = ['water-counter', 'latency-probe', 'sql-injector', 'cap-intruder', 'evil'] as const;

interface HostState {
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
}

const INITIAL: HostState = {
  contained: null, probesFrac: '—', paintMs: null, generation: null,
  lastTap: null, rejectedForgeries: 0, t7AnyPoison: null, lastError: null,
  currentApp: 'tip-splitter', syscalls: 0, lastSyscall: null,
};

/** The live bridge realm the host is serving (one at a time — one WebView == one realm). */
interface LiveRealm {
  app: string;
  realm: RealmRecord;
  dispatcher: Dispatcher;
}

export default function WebViewHost() {
  const webRef = useRef<WebView>(null);
  const [s, setS] = useState<HostState>(INITIAL);
  // Refs (not state) so the onMessage callback always sees the current realm without re-binding.
  const live = useRef<LiveRealm | null>(null);
  const genCounter = useRef(1);

  // The host→page control surface (constraint #5 seam + F4 negative control + sysret relay).
  // injectJavaScript runs in the OUTER page only; it cannot reach into the cross-origin iframe.
  const control = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`try{${js}}catch(e){};true;`);
  }, []);

  // Launch a bridge app: open its per-app engine + schema (D7), bind a fresh realm + dispatcher
  // at a NEW generation, then reset the iframe to deliver the bundle. A Tier-0 app (no declared
  // capabilities) needs no engine — it simply never syscalls.
  const deliverApp = useCallback((appName: string) => {
    if (live.current) {
      tearDownRealm(live.current.realm); // fence the old realm's late results
      try { live.current.realm.engine?.close(); } catch { /* best effort */ }
    }
    live.current = null;
    const record = APP_RECORDS[appName] ?? { appId: appName, name: appName, manifest: { capabilities: [] } };
    const generation = ++genCounter.current;
    setS((p) => ({ ...p, currentApp: appName, lastError: null }));

    // ALWAYS bind a realm + dispatcher — even for a zero-capability app — so a bundle that
    // syscalls anyway (the cap-intruder) is DENIED with a structured `undeclared_capability`,
    // not silently dropped into a timeout. launchApp opens an engine only if storage is declared
    // (a Tier-0 app gets engine:null and the gate refuses every verb at the capability step).
    const launched = launchApp(record, (appId) => createStorageEngine({ appId, mode: 'persistent' }), generation);
    if (!launched.ok) {
      // A conflict-class schema error surfaces BEFORE the bundle runs (D7).
      setS((p) => ({ ...p, lastError: `launch ${appName}: ${launched.error.kind} — ${launched.error.hint}` }));
      return;
    }
    live.current = { app: appName, realm: launched.realm, dispatcher: Dispatcher.forRealm(launched.realm, REGISTRY) };
    // Tell the page the generation this realm is bound at, recreate the iframe, deliver bundle.
    control(`window.__whimControl.reinject({reset:true,bundle:${JSON.stringify(appName)},generation:${generation}})`);
  }, [control]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    // UNTRUSTED DATA. Parse defensively; act on nothing; never trust a frame by its `kind`.
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.__whimHostLog === true) { console.log('[whim:page]', m.line); return; }

    switch (m.kind) {
      case 'syscall': {
        // A bridge syscall from the bundle (untrusted). The dispatcher gates it against THIS
        // realm's host-held manifest + bound engine (D2/D4) and answers; we relay the sysret
        // back into the iframe. No live realm → the app declared no capabilities → drop.
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
      case 'ui-event': // a tap round-tripped from the bundle (sandbox-rendering: "a tap reaches the host")
        console.log('[whim] ui-event', JSON.stringify(m.payload));
        setS((p) => ({ ...p, lastTap: `${m.payload?.type ?? '?'} "${m.payload?.label ?? ''}"` }));
        return;
      case 'paint':
        console.log('[whim] paint', JSON.stringify(m.payload));
        setS((p) => ({ ...p, paintMs: m.payload?.mountToFirstPaintMs ?? null, generation: m.payload?.generation ?? null }));
        return;
      case 'probes': {
        const r = m.payload || {};
        // Only an authenticated (page-nonce-verified) frame is trusted as the verdict.
        if (m.trusted !== true) { console.log('[whim] ignoring unauthenticated probes frame'); return; }
        console.log('[whim] CONTAINED=' + r.contained + ' ' + r.passed + '/' + r.total + (r.t7 ? ' T7anyPoison=' + r.t7.anyPoison : ''));
        setS((p) => ({
          ...p,
          contained: !!r.contained,
          probesFrac: (r.passed ?? '?') + '/' + (r.total ?? '?'),
          generation: r.generation ?? p.generation,
          t7AnyPoison: r.t7 ? !!r.t7.anyPoison : p.t7AnyPoison,
        }));
        return;
      }
      case 'rejected-forgery': // the host saw (and rejected) a forged/unauthenticated control frame (F4 / T6b)
        console.log('[whim] REJECTED forged frame kind=' + m.forgedKind);
        setS((p) => ({ ...p, rejectedForgeries: p.rejectedForgeries + 1 }));
        return;
      case 'delivery':
        console.log('[whim] delivery', JSON.stringify(m.payload));
        return;
      case 'error':
        console.log('[whim] error', JSON.stringify(m.payload));
        setS((p) => ({ ...p, lastError: m.payload?.message || m.payload?.name || 'error' }));
        return;
      default:
        return; // unknown kind → ignore (constraint #4: never act on a frame by its tag)
    }
  }, [control]);

  const verdictColor = s.contained === null ? '#94a3b8' : s.contained ? '#16a34a' : '#dc2626';
  const verdictText = s.contained === null ? 'running…' : s.contained ? 'CONTAINED ✓' : 'LEAK ✗';

  const deliverButtons = useMemo(() => DELIVERABLE.filter((n) => !!APP_RECORDS[n] || n === 'evil'), []);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>Whim v0.2 — capability bridge</Text>
        <View style={styles.statusRow}>
          <Text style={[styles.badge, { color: verdictColor }]}>{verdictText} {s.probesFrac}</Text>
          <Text style={styles.meta}>paint {s.paintMs != null ? s.paintMs + 'ms' : '—'} · gen {s.generation ?? '—'}</Text>
        </View>
        <Text style={styles.meta}>
          app: {s.currentApp} · syscalls: {s.syscalls}{s.lastSyscall ? ` · last: ${s.lastSyscall}` : ''}
        </Text>
        <Text style={styles.meta}>
          last tap: {s.lastTap ?? '—'} · forged rejected: {s.rejectedForgeries}
          {s.t7AnyPoison != null ? ` · T7: ${s.t7AnyPoison}` : ''}
          {s.lastError ? ` · err: ${s.lastError}` : ''}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={() => deliverApp('tip-splitter')}>
            <Text style={styles.btnText}>Tip splitter</Text>
          </TouchableOpacity>
          {deliverButtons.map((name) => (
            <TouchableOpacity key={name} style={styles.btn} onPress={() => deliverApp(name)}>
              <Text style={styles.btnText}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <WebView
        ref={webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: RUNTIME_HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        // RUNTIME_HTML is a static, app-bundled document — no remote navigation should occur.
        setSupportMultipleWindows={false}
        onError={(ev) => console.log('[whim] webview error', JSON.stringify(ev.nativeEvent))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020' },
  bar: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0b1020' },
  title: { color: '#e5e7eb', fontWeight: '700', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  badge: { fontWeight: '800', fontSize: 16 },
  meta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  btnRow: { gap: 8, paddingVertical: 6 },
  btn: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  btnText: { color: '#bfdbfe', fontSize: 12, fontWeight: '600' },
  web: { flex: 1, backgroundColor: '#0b1020' },
});
