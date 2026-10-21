/**
 * retired-keys — removes, once per install, launcher keys whose feature is gone, so the data a
 * retired feature stored does not stay on the phone (design-system-v1 `app-launcher` REMOVED "The
 * orb is a tapped menu whose actions are instrumented" — "The stored counters are deleted", task
 * 19.5; REMOVED "Highlighting can be switched off" — "The stored preference is ignored and
 * deleted", task 21.3).
 *
 * Pure and RN-free (the Node suite drives it directly). It runs at launch on the `whim.launcher`
 * KVBackend. A marker records the sweep, so every later launch costs one read.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

/** The old orb menu's per-action tap counters, `orb-action-count:<action>` (sweep 1), and the
 *  Whim Syntax highlighting switch, `'1'`/`'0'` (sweep 2). */
const RETIRED_KEYS: readonly string[] = [
  'orb-action-count:change',
  'orb-action-count:home',
  'orb-action-count:versions',
  'orb-action-count:report',
  'highlighting',
];

/** The sweep the marker records. A key added to `RETIRED_KEYS` needs the next sweep number, or
 *  phones already swept never remove it. */
const SWEEP_KEY = 'retired-keys-sweep';
const SWEEP = '2';

/** Delete every retired key once. Idempotent: after the sweep, a launch only reads the marker. */
export function sweepRetiredKeys(kv: KVBackend): void {
  if (kv.getString(SWEEP_KEY) === SWEEP) return;
  for (const key of RETIRED_KEYS) kv.delete(key);
  kv.set(SWEEP_KEY, SWEEP);
}
