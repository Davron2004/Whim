/**
 * Whim v0.1 — the retained RN shell. One full-screen WebView running the contained
 * mini-app runtime (sandbox-isolation + sandbox-rendering). See src/host/WebViewHost.tsx.
 *
 * @format
 */
import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WebViewHost from './src/host/WebViewHost';
import VersionStoreProbeScreen from './src/host/VersionStoreProbeScreen';
import StorageProbeScreen from './src/host/StorageProbeScreen';

// Flip to true to run the version-store on-device acceptance instead of the WebView
// host (tasks 1.3, 5.2, 5.3, 7.2, 7.3). Default false keeps the normal app path.
const RUN_VSTORE_PROBE = false;

// Flip to true to run the storage-engine on-device acceptance (Decision #40, tasks 7.2/7.3:
// op-sqlite lifecycle + evolution + KV cap + latency + cross-restart). Default false.
const RUN_STORAGE_PROBE = false;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b1020" />
      {RUN_STORAGE_PROBE ? (
        <StorageProbeScreen />
      ) : RUN_VSTORE_PROBE ? (
        <VersionStoreProbeScreen />
      ) : (
        <WebViewHost />
      )}
    </SafeAreaProvider>
  );
}
