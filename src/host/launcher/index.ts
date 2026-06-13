/**
 * app-launcher — public surface (launcher-shell / #5). The product shell over the contained
 * runtime: a persistent installed-apps index, the sanctioned version-store access path, the
 * guaranteed-exit back-policy, first-run seeding, and the launcher screens.
 */

export { AppIndex } from './app-index';
export type { InstalledApp } from './app-index';
export { StoreAccess, storeIdOf } from './store-access';
export type { StoreAccessOptions, InstallSpec, DeleteStorage } from './store-access';
export { seedFirstRun, SEED_VERSION } from './seed';
export type { SeedSpec } from './seed';
export { BackPolicy, step, initialBackState, UNHANDLED_PRESS_WINDOW_MS } from './back-policy';
export type { BackAction, BackEvent, BackState } from './back-policy';
export { deliverBySourceJs, MAX_BUNDLE_SOURCE_BYTES, BundleTooLargeError } from './deliver';
export { monogram, tileColor, TILE_COLORS } from './tiles';
export { COPY, forkedFromLabel, deleteBody } from './copy';
export { useMiniAppHost } from './useMiniAppHost';
export type { MiniAppHost, HostState } from './useMiniAppHost';
export { default as LauncherRoot } from './LauncherRoot';
export { default as HomeScreen } from './HomeScreen';
export { default as MiniAppView } from './MiniAppView';
export { default as DevProbeScreen } from './DevProbeScreen';
export { default as FloatingExit } from './FloatingExit';
