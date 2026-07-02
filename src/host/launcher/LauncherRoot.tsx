// ─────────────────────────────────────────────────────────────────────────────
// LauncherRoot — the product shell's top-level screen switch (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// Plain RN state, no navigation library (two screens + a dev flip don't justify the dep): home
// grid → full-screen mini-app → back to home; a __DEV__ entry reaches the containment/bridge
// probe. This is also the host wiring: the MMKV-backed installed-apps index, the persistent
// version store, the sanctioned StoreAccess path (with the device user-data delete), first-run
// seeding (D7), and the fork/delete flows (D2). One WebView == one realm == one app: launching
// reads the active bundle source from the record and hands it to MiniAppView (keyed by launcher
// id, so each launch is a fresh realm).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import type { AppRecord } from '../bridge';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import { deleteStorage } from '../storage-engine';
import { AppIndex, InstalledApp } from './app-index';
import { StoreAccess } from './store-access';
import { seedFirstRun, SeedSpec } from './seed';
import HomeScreen from './HomeScreen';
import MiniAppView from './MiniAppView';
import DevProbeScreen from './DevProbeScreen';

type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' };

/** The first-run example set, built from the generated host records + bundle sources (D7). */
function defaultSeeds(): SeedSpec[] {
  const seeds: Array<{ id: string; name: string; prompt: string }> = [
    { id: 'tip-splitter', name: 'Tip Splitter', prompt: 'Example: split a bill with tip' },
    { id: 'water-counter', name: 'Water Counter', prompt: 'Example: track glasses of water' },
  ];
  return seeds
    .filter(s => APP_RECORDS[s.id] && APP_BUNDLES[s.id])
    .map(s => ({ ...s, record: APP_RECORDS[s.id], bundleSource: APP_BUNDLES[s.id] }));
}

export default function LauncherRoot() {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  const { index, access } = useMemo(() => {
    const idx = new AppIndex(createMmkvBackend('whim.launcher'));
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({ store, index: idx, deleteStorage: (appId) => deleteStorage({ appId }) });
    return { index: idx, access: acc };
  }, []);

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = () => setApps(index.list());

  useEffect(() => {
    (async () => {
      try {
        await seedFirstRun(index, access, defaultSeeds());
      } catch (e) {
        console.log('[whim] seed failed:', (e as Error)?.message);
      }
      refresh();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpen = async (app: InstalledApp) => {
    try {
      const source = await access.activeBundle(app);
      setScreen({ kind: 'app', app, record: app.record, source, engineAppId: access.engineAppId(app) });
    } catch (e) {
      Alert.alert('Could not open this app', (e as Error)?.message ?? String(e));
    }
  };

  const onFork = async (app: InstalledApp) => {
    try {
      await access.fork(app);
      refresh();
    } catch (e) {
      Alert.alert('Could not fork this app', (e as Error)?.message ?? String(e));
    }
  };

  const onDelete = async (app: InstalledApp) => {
    try {
      await access.remove(app);
      refresh();
    } catch (e) {
      Alert.alert('Could not delete this app', (e as Error)?.message ?? String(e));
    }
  };

  const goHome = () => {
    refresh();
    setScreen({ kind: 'home' });
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#93c5fd" />
      </View>
    );
  }

  if (screen.kind === 'app') {
    return (
      <MiniAppView
        key={screen.app.id}
        record={screen.record}
        bundleSource={screen.source}
        engineAppId={screen.engineAppId}
        onExit={goHome}
      />
    );
  }

  if (screen.kind === 'dev') {
    return <DevProbeScreen onExit={goHome} />;
  }

  return (
    <HomeScreen
      apps={apps}
      onOpen={onOpen}
      onFork={onFork}
      onDelete={onDelete}
      onCreate={() => {
        // Pending #7 prompt-flow-ux: navigate to the prompt screen once implemented.
      }}
      onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1020' },
});
