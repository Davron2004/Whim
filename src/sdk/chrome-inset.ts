import * as React from 'react';

// ── Host chrome inset (beta-1 D5) ─────────────────────────────────────────────
// How much of the realm's bottom edge the host's orb covers, in CSS pixels. The trusted loader
// hands it to `NavRoot`, which provides it here, and `Screen` adds it to its bottom padding.
// Repository-internal: nothing in the public `vc-sdk` namespace exposes this context or its
// value (#11/#13), so a mini-app lays out with tokens and never learns the host's chrome.
//
// Created on first use, not at module load: the build reads each app's manifest by loading the
// SDK against a React stub that has no `createContext` (build/build.mjs, REACT_STUB).
let context: React.Context<number> | undefined;

export function chromeInsetContext(): React.Context<number> {
  context ??= React.createContext(0);
  return context;
}
