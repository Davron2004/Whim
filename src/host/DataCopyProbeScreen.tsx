/**
 * On-device probe screen for the data copy (copy-app-data, task 1.5). Renders the full
 * DataCopyVerdict on screen under a PASS/FAIL banner. The verdict appears right after the probe's
 * last copy is written: kill the app then and relaunch to read the durability section.
 *
 * Not in the default app path: App.tsx renders it only when RUN_DATA_COPY_PROBE is on.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../design/tokens';
import { DataCopyVerdict, runDataCopyDeviceAcceptance } from './storage-engine/copy-device-acceptance';

const C = COLORS.dark;

export default function DataCopyProbeScreen() {
  const [verdict, setVerdict] = useState<DataCopyVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    runDataCopyDeviceAcceptance().then(
      v => {
        if (live) setVerdict(v);
      },
      err => {
        const msg = (err as Error).stack || (err as Error).message;
        if (live) setError(msg);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Whim · data-copy on-device probe</Text>
      {!verdict && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={C.text} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 12 },
  title: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: C['text-2'], marginTop: 8 },
  body: { flex: 1 },
  banner: { fontSize: 20, fontWeight: '800', marginBottom: 12, paddingVertical: 4 },
  pass: { color: C.positive },
  fail: { color: C.danger },
  mono: { color: C.text, fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
