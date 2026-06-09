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
//   • drives the realm-reset seam (constraint #5 / task 6.3) and the F4 negative control
//     (task 8.3) by calling the page's window.__whimControl over injectJavaScript.
// The host holds NO capability the bundle can reach: the only crossing is this one-way string
// transport. The native logs go to logcat (tag ReactNativeJS); the full probe JSON also
// renders ON-SCREEN inside the WebView (logcat truncates ~4 KB) — design D9 / task 8.1.
import React, { useCallback, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { RUNTIME_HTML } from '../runtime/generated/runtime-html';

interface HostState {
  contained: boolean | null;
  probesFrac: string;
  paintMs: number | null;
  generation: number | null;
  lastTap: string | null;
  rejectedForgeries: number;
  t7AnyPoison: boolean | null;
  lastError: string | null;
}

const INITIAL: HostState = {
  contained: null, probesFrac: '—', paintMs: null, generation: null,
  lastTap: null, rejectedForgeries: 0, t7AnyPoison: null, lastError: null,
};

export default function WebViewHost() {
  const webRef = useRef<WebView>(null);
  const [s, setS] = useState<HostState>(INITIAL);

  // The host→page control surface (constraint #5 seam + F4 negative control). injectJavaScript
  // runs in the OUTER page only; it cannot reach into the cross-origin iframe.
  const control = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`try{${js}}catch(e){};true;`);
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    // UNTRUSTED DATA. Parse defensively; act on nothing; never trust a frame by its `kind`.
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.__whimHostLog === true) { console.log('[whim:page]', m.line); return; }

    switch (m.kind) {
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
  }, []);

  const verdictColor = s.contained === null ? '#94a3b8' : s.contained ? '#16a34a' : '#dc2626';
  const verdictText = s.contained === null ? 'running…' : s.contained ? 'CONTAINED ✓' : 'LEAK ✗';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>Whim v0.1 — WebView sandbox runtime</Text>
        <View style={styles.statusRow}>
          <Text style={[styles.badge, { color: verdictColor }]}>{verdictText} {s.probesFrac}</Text>
          <Text style={styles.meta}>paint {s.paintMs != null ? s.paintMs + 'ms' : '—'} · gen {s.generation ?? '—'}</Text>
        </View>
        <Text style={styles.meta}>
          last tap: {s.lastTap ?? '—'} · forged-frames rejected: {s.rejectedForgeries}
          {s.t7AnyPoison != null ? ` · T7 anyPoison: ${s.t7AnyPoison}` : ''}
          {s.lastError ? ` · err: ${s.lastError}` : ''}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={() => control("window.__whimControl.reinject({reset:true,bundle:'tip-splitter'})")}>
            <Text style={styles.btnText}>Reset realm</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => control("window.__whimControl.deliver('evil')")}>
            <Text style={styles.btnText}>Deliver evil (F4)</Text>
          </TouchableOpacity>
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
