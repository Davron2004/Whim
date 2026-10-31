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
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import LauncherRoot from './src/host/launcher/LauncherRoot';
import VersionStoreProbeScreen from './src/host/VersionStoreProbeScreen';
import StorageProbeScreen from './src/host/StorageProbeScreen';
import DataCopyProbeScreen from './src/host/DataCopyProbeScreen';
import BridgeProbeScreen from './src/host/BridgeProbeScreen';
import NetworkDenyProbeScreen from './src/host/NetworkDenyProbeScreen';
import RootErrorBoundary from './src/host/RootErrorBoundary';
import { recordRenderCrash } from './src/host/platform/install-diagnostics';

// Flip to true to run the network-deny reproduction probe (design D17 "Reproduce first, then
// prove") against a canary started on the Mac (`node scripts/netdeny/run.mjs canary`). Default
// false; checked before the other on-device probes.
const RUN_NETDENY_PROBE = false;

// Flip to true to run the version-store on-device acceptance instead of the launcher.
const RUN_VSTORE_PROBE = false;

// Flip to true to run the storage-engine on-device acceptance (Decision #40). Default false.
const RUN_STORAGE_PROBE = false;

// Flip to true to run the data-copy on-device probe (copy-app-data, task 1.5). Default false.
const RUN_DATA_COPY_PROBE = false;

// Flip to true to run the capability-bridge on-device acceptance (Decision #41). Default false.
// The WebView round-trip is also exercised by the launcher's __DEV__ probe (DevProbeScreen).
const RUN_BRIDGE_PROBE = false;

// Native screens for the launcher's stack (design.md D6); also reports at startup if the native
// module failed to link.
enableScreens(true);

export default function App() {
  let content = <LauncherRoot />;
  if (RUN_NETDENY_PROBE) content = <NetworkDenyProbeScreen />;
  else if (RUN_BRIDGE_PROBE) content = <BridgeProbeScreen />;
  else if (RUN_STORAGE_PROBE) content = <StorageProbeScreen />;
  else if (RUN_DATA_COPY_PROBE) content = <DataCopyProbeScreen />;
  else if (RUN_VSTORE_PROBE) content = <VersionStoreProbeScreen />;

  // Around everything: a render error no inner boundary handles is recorded, then rethrown into
  // React Native's own fatal handling (`RootErrorBoundary`). Inside it the roots the native UI
  // libraries need: gestures, the keyboard's frames, and Reanimated motion following the OS
  // Reduce Motion setting (design.md D9, system.md §4.5).
  return (
    <RootErrorBoundary onError={recordRenderCrash}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <ReducedMotionConfig mode={ReduceMotion.System} />
            {content}
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
