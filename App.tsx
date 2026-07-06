/**
 * Whim — the retained RN shell. Default surface is the LAUNCHER (launcher-shell / #5): the home
 * grid of installed mini-apps, full-screen launch over the contained runtime, system-back +
 * floating-affordance exit, fork/delete, first-run seeding. The on-device acceptance harnesses
 * (version store / storage engine / capability bridge) remain reachable via the flips below; the
 * containment/bridge probe surface lives behind LauncherRoot's __DEV__ entry (DevProbeScreen).
 *
 * @format
 */
import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LauncherRoot from './src/host/launcher/LauncherRoot';
import VersionStoreProbeScreen from './src/host/VersionStoreProbeScreen';
import StorageProbeScreen from './src/host/StorageProbeScreen';
import BridgeProbeScreen from './src/host/BridgeProbeScreen';

// Flip to true to run the version-store on-device acceptance instead of the launcher.
const RUN_VSTORE_PROBE = false;

// Flip to true to run the storage-engine on-device acceptance (Decision #40). Default false.
const RUN_STORAGE_PROBE = false;

// Flip to true to run the capability-bridge on-device acceptance (Decision #41). Default false.
// The WebView round-trip is also exercised by the launcher's __DEV__ probe (DevProbeScreen).
const RUN_BRIDGE_PROBE = false;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b1020" />
      {RUN_BRIDGE_PROBE ? (
        <BridgeProbeScreen />
      ) : RUN_STORAGE_PROBE ? (
        <StorageProbeScreen />
      ) : RUN_VSTORE_PROBE ? (
        <VersionStoreProbeScreen />
      ) : (
        <LauncherRoot />
      )}
    </SafeAreaProvider>
  );
}
