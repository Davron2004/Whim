// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY SPIKE — PEN-TEST T5 fixture: module-resolution confinement.
//
// A mini-app in the normal contract shape (defineApp default export, looks legit) whose
// ONLY sin is reaching OUTSIDE the allowed module surface. Unlike bad-app.example.tsx
// (which also trips forbidden-global scans), this fixture isolates the MODULE axis: it
// imports non-'vc-sdk' specifiers and nothing else forbidden, so it cleanly exercises
//   (1) build/static-check.mjs  → must emit non_sdk_import findings WITH original lines, and
//   (2) esbuild's build behavior → 'axios'/'node:fs' are NOT external and have no on-disk
//       module here, so a bundle attempt RESOLVE-FAILS (the build errors out) rather than
//       silently smuggling a forbidden module into the IIFE. That build-time failure is the
//       T5 confinement guarantee at the bundler layer; the runtime resolver allowlist
//       (window.__whimRequire → only 'vc-sdk'/'react'/'react-dom') is the second layer.
//
// NOT part of the happy-path build (build.mjs does not target it). static-check.mjs scans
// it; the run recipe shows the deliberate esbuild resolve failure.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Text } from 'vc-sdk';
import axios from 'axios';                 // <- non-SDK import (must be flagged + unresolvable)
import { readFileSync } from 'node:fs';    // <- Node builtin (must be flagged + unresolvable)

function Home() {
  // referenced so the imports are not tree-shaken away before esbuild tries to resolve them
  const ping = typeof axios + '/' + typeof readFileSync;
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Text size="caption">{ping}</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Bad Import',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});
