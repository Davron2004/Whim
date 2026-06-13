/**
 * On-device acceptance screen for the capability-bridge (Decision #41, D8; tasks 6.1–6.3).
 *
 * Renders the full BridgeVerdict on-screen (logcat truncates ~4 KB) and a PASS/FAIL banner:
 * the gate/dispatcher/registry + storage syscall path over op-sqlite under Hermes, end-to-end
 * injection inertness, per-verb syscall latency, and cross-restart persistence (relaunch to see
 * `persistence.restartVerified` flip once a prior launch's Log rows are confirmed to survive a
 * kill). Not in the default app path — App.tsx renders this only when RUN_BRIDGE_PROBE is on.
 * Follows the StorageProbeScreen pattern.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { runBridgeDeviceAcceptance, BridgeVerdict } from './bridge/device-acceptance';

export default function BridgeProbeScreen() {
  const [verdict, setVerdict] = useState<BridgeVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      runBridgeDeviceAcceptance()
        .then(setVerdict)
        .catch((err) => {
          const msg = (err as Error).stack || (err as Error).message;
          setError(msg);
          console.error('[whim-bridge] FATAL ' + msg);
        });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Whim · capability-bridge on-device acceptance</Text>
      {!verdict && !error && (
        <View style={styles.center}>
          <ActivityIndicator color="#7dd3fc" />
          <Text style={styles.muted}>running…</Text>
        </View>
      )}
      {error && (
        <ScrollView style={styles.body}>
          <Text style={[styles.banner, styles.fail]}>FATAL</Text>
          <Text style={styles.mono}>{error}</Text>
        </ScrollView>
      )}
      {verdict && (
        <ScrollView style={styles.body}>
          <Text style={[styles.banner, verdict.pass ? styles.pass : styles.fail]}>
            {verdict.pass ? 'PASS' : `FAIL (${verdict.failures.length})`}
          </Text>
          <Text style={styles.mono}>{JSON.stringify(verdict, null, 2)}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020', paddingTop: 48, paddingHorizontal: 12 },
  title: { color: '#cbd5e1', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#64748b', marginTop: 8 },
  body: { flex: 1 },
  banner: { fontSize: 20, fontWeight: '800', marginBottom: 12, paddingVertical: 4 },
  pass: { color: '#22c55e' },
  fail: { color: '#ef4444' },
  mono: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
