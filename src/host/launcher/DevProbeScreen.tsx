// ─────────────────────────────────────────────────────────────────────────────
// DevProbeScreen — the standing containment/bridge acceptance harness (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// The probe surface that used to BE WebViewHost: the verdict bar, syscall counters, and the
// deliver-by-name buttons over the baked fixture set (incl. the adversarial ones — evil/
// cap-intruder/sql-injector/latency-probe). It is NOT legacy UI — it is the on-device bridge +
// containment harness (D6), reachable from the launcher via a __DEV__ entry. It drives the
// SAME useMiniAppHost loop the product MiniAppView uses, so realm + dispatcher are always bound
// (the cap-intruder lesson) by construction.
import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import type { AppRecord } from '../bridge';
import { useMiniAppHost } from './useMiniAppHost';

// The baked fixtures the host can deliver by name on-device (records extracted at build time).
const DELIVERABLE = ['tip-splitter', 'water-counter', 'latency-probe', 'pour-over-timer', 'sql-injector', 'cap-intruder', 'evil'] as const;

function recordFor(name: string): AppRecord {
  return APP_RECORDS[name] ?? { appId: name, name, manifest: { capabilities: [] } };
}

export interface DevProbeScreenProps {
  onExit: () => void;
}

export default function DevProbeScreen({ onExit }: DevProbeScreenProps) {
  const host = useMiniAppHost({ onExit });
  const s = host.state;

  const verdictColor = s.contained === null ? '#94a3b8' : s.contained ? '#16a34a' : '#dc2626';
  const verdictText = s.contained === null ? 'running…' : s.contained ? 'CONTAINED ✓' : 'LEAK ✗';
  const buttons = useMemo(() => DELIVERABLE, []);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.bar}>
        <View style={styles.titleRow}>
          <TouchableOpacity onPress={host.exit} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Home</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Dev probe — containment + bridge</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.badge, { color: verdictColor }]}>{verdictText} {s.probesFrac}</Text>
          <Text style={styles.meta}>paint {s.paintMs == null ? '—' : s.paintMs + 'ms'} · gen {s.generation ?? '—'}</Text>
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
          {buttons.map((name) => (
            <TouchableOpacity key={name} style={styles.btn} onPress={() => host.deliverByRecord(recordFor(name), name)}>
              <Text style={styles.btnText}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <WebView
        ref={host.webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: host.runtimeHtml }}
        onMessage={(e) => host.onMessage(e.nativeEvent.data)}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        onError={(ev) => console.log('[whim] webview error', JSON.stringify(ev.nativeEvent))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020' },
  bar: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0b1020' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { paddingVertical: 2, paddingHorizontal: 6, backgroundColor: '#1e293b', borderRadius: 6 },
  backText: { color: '#bfdbfe', fontSize: 12, fontWeight: '700' },
  title: { color: '#e5e7eb', fontWeight: '700', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  badge: { fontWeight: '800', fontSize: 16 },
  meta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  btnRow: { gap: 8, paddingVertical: 6 },
  btn: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  btnText: { color: '#bfdbfe', fontSize: 12, fontWeight: '600' },
  web: { flex: 1, backgroundColor: '#0b1020' },
});
