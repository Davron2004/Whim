/**
 * Whim — the retained RN shell. Default surface is the LAUNCHER (launcher-shell / #5): the home
 * grid of installed mini-apps, full-screen launch over the contained runtime, system-back +
 * floating-affordance exit, fork/delete, first-run seeding. The on-device acceptance harnesses
 * (version store / storage engine / capability bridge / network-deny reproduction) remain
 * reachable via the flips below; the containment/bridge probe surface lives behind LauncherRoot's
 * __DEV__ entry (DevProbeScreen).
 *
 * @format
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LauncherRoot from './src/host/launcher/LauncherRoot';
import VersionStoreProbeScreen from './src/host/VersionStoreProbeScreen';
import StorageProbeScreen from './src/host/StorageProbeScreen';
import BridgeProbeScreen from './src/host/BridgeProbeScreen';
import NetworkDenyProbeScreen from './src/host/NetworkDenyProbeScreen';

// Flip to true to run the network-deny reproduction probe (design D17 "Reproduce first, then
// prove") against a canary started on the Mac (`node scripts/netdeny/run.mjs canary`). Default
// false; checked before the other on-device probes.
const RUN_NETDENY_PROBE = false;

// Flip to true to run the version-store on-device acceptance instead of the launcher.
const RUN_VSTORE_PROBE = false;

// Flip to true to run the storage-engine on-device acceptance (Decision #40). Default false.
const RUN_STORAGE_PROBE = false;

// Flip to true to run the capability-bridge on-device acceptance (Decision #41). Default false.
// The WebView round-trip is also exercised by the launcher's __DEV__ probe (DevProbeScreen).
const RUN_BRIDGE_PROBE = false;

export default function App() {
  let content = <LauncherRoot />;
  if (RUN_NETDENY_PROBE) content = <NetworkDenyProbeScreen />;
  else if (RUN_BRIDGE_PROBE) content = <BridgeProbeScreen />;
  else if (RUN_STORAGE_PROBE) content = <StorageProbeScreen />;
  else if (RUN_VSTORE_PROBE) content = <VersionStoreProbeScreen />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}
