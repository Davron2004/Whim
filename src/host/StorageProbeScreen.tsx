/**
 * On-device acceptance screen for the storage engine (Decision #40, D7; tasks 7.2/7.3).
 *
 * Renders the full StorageVerdict on-screen (logcat truncates ~4 KB — the #35/#36 gotcha)
 * and a PASS/FAIL banner. This is the run that counts: op-sqlite under Hermes, the full
 * verb + evolution lifecycle, the KV cap, per-verb latency at a Tier-0 volume, DB size, and
 * cross-restart integrity (relaunch the app to see `persistence.restartVerified` flip from
 * "n/a" to true once a prior launch's records are confirmed to have survived the kill).
 *
 * Not in the default app path — App.tsx renders this only when RUN_STORAGE_PROBE is on.
 * Follows the VersionStoreProbeScreen pattern (kept as a sibling flag rather than a probe
 * picker — the open question in the design's task 7; a third flag is the smaller change).
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { runStorageDeviceAcceptance, StorageVerdict } from './storage-engine/device-acceptance';

export default function StorageProbeScreen() {
  const [verdict, setVerdict] = useState<StorageVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Defer one tick so the spinner paints before the synchronous op-sqlite run blocks JS.
    const t = setTimeout(() => {
      try {
        setVerdict(runStorageDeviceAcceptance());
      } catch (err) {
        const msg = (err as Error).stack || (err as Error).message;
        setError(msg);
        console.error('[whim-storage] FATAL ' + msg);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Whim · storage-engine on-device acceptance</Text>
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
