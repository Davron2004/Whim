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

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b1020" />
      <WebViewHost />
    </SafeAreaProvider>
  );
}
