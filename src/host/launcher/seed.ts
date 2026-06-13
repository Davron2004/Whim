/**
 * First-run seeding (launcher-shell / #5 D7). On a virgin install, the launcher installs the
 * tip splitter and water counter as example-labeled records — full citizens: launchable,
 * forkable, deletable, snapshot-backed from snapshot #1 (so #6 has real history + provenance
 * the day it lands). Seeding is idempotent across restarts and never resurrects a deleted
 * example: a single MMKV seed marker gates the whole routine.
 *
 * The core (`seedFirstRun`) is injection-shaped (takes the seed specs) so it is Node-testable
 * without the generated fixture sources; the host builds the real specs from the generated
 * `APP_RECORDS` + `APP_BUNDLES` (see the launcher host wiring).
 */

import type { AppRecord } from '../bridge/contract';
import { AppIndex } from './app-index';
import { StoreAccess } from './store-access';

/** Bump when the seed SET changes meaningfully. A higher marker means "already seeded this set";
 *  deleting an example does NOT lower it, so deleted examples stay deleted (D7). */
export const SEED_VERSION = 1;

export interface SeedSpec {
  id: string;
  name: string;
  /** Honest product string; tracked as snapshot #1's prompt and surfaced in #6's history. */
  prompt: string;
  record: AppRecord;
  bundleSource: string;
}

/**
 * Seed the examples once. No-op when the marker already records this seed version (idempotent;
 * deleted examples stay deleted). Each example is store-first, index-second via `StoreAccess`.
 */
export async function seedFirstRun(
  index: AppIndex,
  access: StoreAccess,
  seeds: SeedSpec[],
  seedVersion: number = SEED_VERSION,
): Promise<void> {
  if (index.seedVersion() >= seedVersion) return;
  for (const s of seeds) {
    if (index.has(s.id)) continue; // never double-install
    await access.install({
      id: s.id,
      name: s.name,
      record: s.record,
      bundleSource: s.bundleSource,
      prompt: s.prompt,
      example: true,
    });
  }
  index.markSeeded(seedVersion);
}
