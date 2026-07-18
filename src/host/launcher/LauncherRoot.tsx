// ─────────────────────────────────────────────────────────────────────────────
// LauncherRoot — the product shell's top-level screen switch (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// Plain RN state, no navigation library (three screens + a dev flip don't justify the dep): home
// grid → full-screen mini-app → back to home; a __DEV__ entry reaches the containment/bridge
// probe; a settings entry reaches the theme picker. This is also the host wiring: the MMKV-backed
// installed-apps index, the persistent version store, the sanctioned StoreAccess path (with the
// device user-data delete), first-run seeding (D7), the fork/delete flows (D2), and the theme
// state (design sdk-design-system D7) — the pref is loaded once from the same `whim.launcher`
// KVBackend the installed-apps index uses, resolved + re-persisted live via `ThemeProvider`. One
// WebView == one realm == one app: launching reads the active bundle source from the record and
// hands it to MiniAppView (keyed by launcher id, so each launch is a fresh realm).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import type { AppRecord } from '../bridge';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { deleteStorage } from '../storage-engine';
import { AppIndex, InstalledApp } from './app-index';
import { StoreAccess } from './store-access';
import { seedFirstRun, SeedSpec } from './seed';
import HomeScreen from './HomeScreen';
import MiniAppView from './MiniAppView';
import DevProbeScreen from './DevProbeScreen';
import SettingsScreen from './SettingsScreen';
import HistoryScreen from './HistoryScreen';
import { loadThemePref, saveThemePref, shellPalette } from './theme';
import { ThemeProvider, useTheme } from './theme-context';

type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' }
  | { kind: 'settings' }
  | { kind: 'history'; app: InstalledApp };

/** The first-run example set, built from the generated host records + bundle sources (D7). */
function defaultSeeds(): SeedSpec[] {
  const seeds: Array<{ id: string; name: string; prompt: string }> = [
    { id: 'tip-splitter', name: 'Tip Splitter', prompt: 'Example: split a bill with tip' },
    { id: 'water-counter', name: 'Water Counter', prompt: 'Example: track glasses of water' },
    { id: 'style-gallery', name: 'Style Gallery', prompt: 'Example: every SDK component in one screen' },
  ];
  return seeds
    .filter(s => APP_RECORDS[s.id] && APP_BUNDLES[s.id])
    .map(s => ({ ...s, record: APP_RECORDS[s.id], bundleSource: APP_BUNDLES[s.id] }));
}

export default function LauncherRoot() {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  // The theme pref reads from the SAME `whim.launcher` KVBackend instance the installed-apps
  // index uses (design D7 — one MMKV instance, two consumers).
  const { index, access, kv } = useMemo(() => {
    const launcherKv: KVBackend = createMmkvBackend('whim.launcher');
    const idx = new AppIndex(launcherKv);
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({ store, index: idx, deleteStorage: (appId) => deleteStorage({ appId }) });
    return { index: idx, access: acc, kv: launcherKv };
  }, []);

  const initialThemePref = useMemo(() => loadThemePref(kv), [kv]);

  return (
    <ThemeProvider initialPref={initialThemePref} onPrefChange={(pref) => saveThemePref(kv, pref)}>
      <LauncherShell index={index} access={access} />
    </ThemeProvider>
  );
}

function LauncherShell({ index, access }: Readonly<{ index: AppIndex; access: StoreAccess }>) {
  const { theme } = useTheme();
  const palette = shellPalette(theme);

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

  const onHistory = (app: InstalledApp) => {
    setScreen({ kind: 'history', app });
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

  const statusBarStyle = theme.dark ? 'light-content' : 'dark-content';

  if (!ready) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={statusBarStyle} />
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  let content: React.ReactNode;
  if (screen.kind === 'app') {
    content = (
      <MiniAppView
        key={screen.app.id}
        record={screen.record}
        bundleSource={screen.source}
        engineAppId={screen.engineAppId}
        theme={theme}
        onExit={goHome}
      />
    );
  } else if (screen.kind === 'dev') {
    content = <DevProbeScreen onExit={goHome} />;
  } else if (screen.kind === 'settings') {
    content = <SettingsScreen onBack={goHome} />;
  } else if (screen.kind === 'history') {
    content = <HistoryScreen app={screen.app} access={access} onBack={goHome} />;
  } else {
    content = (
      <HomeScreen
        apps={apps}
        onOpen={onOpen}
        onFork={onFork}
        onDelete={onDelete}
        onHistory={onHistory}
        onCreate={() => {
          // Pending #7 prompt-flow-ux: navigate to the prompt screen once implemented.
        }}
        onSettings={() => setScreen({ kind: 'settings' })}
        onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle={statusBarStyle} />
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
