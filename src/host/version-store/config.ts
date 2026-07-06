/**
 * Version-store configuration. The compaction trigger is a tunable LOOSE-OBJECT-COUNT
 * threshold (task 4.2) — count is the cost driver (#36: ~4 objects/generation, each a
 * key in the KV-backed FS), not byte volume.
 */

export interface VersionStoreConfig {
  /** Base path in the FS under which per-app repos live. */
  rootDir: string;
  /** Compaction fires when a repo's loose-object count exceeds this (tunable). */
  compactionThreshold: number;
  /** Run compaction automatically after a snapshot crosses the threshold. */
  autoCompact: boolean;
  /** Default cap for history() — `log` scales with depth (#36), so paginate. */
  historyLimit: number;
  /** Clock source (seconds-resolution timestamps come from `Math.floor(now()/1000)`). */
  now: () => number;
}

export const DEFAULT_CONFIG: VersionStoreConfig = {
  rootDir: '/whim/apps',
  // ~4 loose objects/generation (#36) → ~20 generations between packs at 80.
  compactionThreshold: 80,
  autoCompact: true,
  historyLimit: 100,
  now: () => Date.now(),
};

export function resolveConfig(overrides?: Partial<VersionStoreConfig>): VersionStoreConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
