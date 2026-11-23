// ─────────────────────────────────────────────────────────────────────────────
// DevProbeScreen — the standing containment/bridge acceptance harness (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// The probe surface that used to BE WebViewHost: the verdict bar, syscall counters, and the
// deliver-by-name buttons over the baked fixture set (incl. the adversarial ones — evil/
// cap-intruder/sql-injector/latency-probe). It is NOT legacy UI — it is the on-device bridge +
// containment harness (D6), reachable from the launcher via a __DEV__ entry. It drives the
// SAME useMiniAppHost loop the product MiniAppView uses, so realm + dispatcher are always bound
// (the cap-intruder lesson) by construction.
import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from '../webview';
import { log } from '../logging';
import { logWebViewError } from './webview-error';
import { useMiniAppHost, type BridgeRecord } from './useMiniAppHost';
import { DEV_PROBE_FIXTURES, devProbeFixture } from './dev-probe-fixtures';
import { createRuntimeChannel, useRuntimeChannel } from './runtime-channel';
import { exposureCode, type RuntimeChannelSnapshot } from './runtime-message-auth';

export interface DevProbeScreenProps {
  onExit: () => void;
}

export default function DevProbeScreen({ onExit }: Readonly<DevProbeScreenProps>) {
  // The WebView's provenance channel, for the screen's life (its one WebView instance): its token,
  // the verifier every message goes through, and what it dropped and recorded, shown in the bar.
  const [channel] = useState(() => ({ current: createRuntimeChannel('dev-probe') }));
  const host = useMiniAppHost({ onExit, channel });
  const s = host.state;
  const runtime = useRuntimeChannel(channel.current);

  const verdictColor = verdictValue(s.contained, '#94a3b8', '#16a34a', '#dc2626');
  const verdictText = verdictValue(s.contained, 'running…', 'CONTAINED ✓', 'LEAK ✗');
  const buttons = useMemo(() => DEV_PROBE_FIXTURES, []);

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
          {s.t7AnyPoison == null ? '' : ` · T7: ${s.t7AnyPoison}`}
          {s.lastError ? ` · err: ${s.lastError}` : ''}
        </Text>
        <Text style={styles.meta}>
          bridge: {bridgeText(s.bridge)} · dropped: {runtime.dropped} · exposure: {exposureText(runtime)}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.btnRow}>
          {buttons.map((name) => {
            const fixture = devProbeFixture(name);
            return (
              <TouchableOpacity key={name} style={styles.btn} onPress={() => host.deliverBySource(fixture.record, fixture.source)}>
                <Text style={styles.btnText}>{name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <WebView
        ref={host.webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: host.runtimeHtml }}
        onMessage={(e) => host.onMessage(e.nativeEvent.data)}
        onLoadEnd={host.onLoadEnd}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        onError={(ev) => logWebViewError(log, ev.nativeEvent, { surface: 'dev-probe' })}
      />
    </SafeAreaView>
  );
}

/** The verdict's `bridge` field: each native bridge object present in the frame at start, and removed. */
function bridgeText(bridge: BridgeRecord | null): string {
  if (bridge === null) return '—';
  const side = (b: BridgeRecord['android']) => {
    if (!b.present) return 'absent';
    return b.removed ? 'present/removed' : 'present/NOT removed';
  };
  return `android ${side(bridge.android)}, ios ${side(bridge.ios)}`;
}

/** The WebView's exposure record (the canary even before its report). */
function exposureText(runtime: RuntimeChannelSnapshot): string {
  const e = runtime.exposure;
  if (e === null) return runtime.canary ? 'pending (canary reached native)' : 'pending';
  return `${exposureCode(e)} · visible android=${e.visible.android} ios=${e.visible.ios} · canary=${e.canaryReachedNative} · ${e.webview ?? 'unknown'}`;
}

function verdictValue<T>(contained: boolean | null, running: T, containedValue: T, leakValue: T): T {
  if (contained === null) return running;
  return contained ? containedValue : leakValue;
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
