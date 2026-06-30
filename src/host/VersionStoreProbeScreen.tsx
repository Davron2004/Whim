/**
 * On-device acceptance screen for the version store (tasks 1.3, 5.2, 5.3, 7.2, 7.3).
 *
 * Renders the full DeviceVerdict on-screen (logcat truncates ~4 KB — the #35/#36
 * gotcha) and a PASS/FAIL banner. The CORE acceptance runs over the in-memory shim
 * (zero native modules), so this builds and runs on the existing toolchain.
 *
 * Cross-restart persistence (5.2/5.3) needs a persistent KV backend (the MMKV backend
 * below); relaunch the app to see `persistence.restartVerified` flip from "n/a" to true
 * once a prior launch's snapshots/pins/forks are confirmed to have survived the kill.
 *
 * Not in the default app path — App.tsx renders this only when RUN_VSTORE_PROBE is on.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { runDeviceAcceptance, DeviceVerdict } from './version-store/device-acceptance';
import type { KVBackend } from './version-store/fs/kv-fs';

// MMKV backend is wired; required lazily so the bundle doesn't pull react-native-mmkv unless used.
function tryMmkv(): KVBackend | undefined {
  try {
    const { createMmkvBackend } = require('./version-store/fs/mmkv-backend');
    return createMmkvBackend();
  } catch (err) {
    console.error('[whim-vstore] MMKV unavailable: ' + (err as Error).message);
    return undefined;
  }
}

export default function VersionStoreProbeScreen() {
  const [verdict, setVerdict] = useState<DeviceVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setVerdict(await runDeviceAcceptance({ kv: tryMmkv() }));
      } catch (err) {
        const msg = (err as Error).stack || (err as Error).message;
        setError(msg);
        console.error('[whim-vstore] FATAL ' + msg);
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Whim · version-store on-device acceptance</Text>
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
