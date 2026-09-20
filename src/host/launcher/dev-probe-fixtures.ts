/**
 * dev-probe-fixtures (review fix F3) — the baked fixture set `DevProbeScreen`'s buttons deliver,
 * resolved to a real bundle SOURCE rather than the retired deliver-by-name path (`deliverByRecord`,
 * which reinjected `{bundle: name}` into `RUNTIME_HTML`'s intentionally-empty baked bundle map —
 * the product delivers by source, never by a page-side name lookup). RN-free: this must load under
 * the launcher's Node acceptance suite.
 */
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import type { AppRecord } from '../bridge';

/** The fixtures the dev probe can deliver by name (incl. the adversarial ones — evil/
 *  cap-intruder/sql-injector/latency-probe), unchanged from the retired `DELIVERABLE` tuple. */
export const DEV_PROBE_FIXTURES = [
  'tip-splitter',
  'water-counter',
  'latency-probe',
  'pour-over-timer',
  'sql-injector',
  'cap-intruder',
  'evil',
] as const;

export type DevProbeFixture = (typeof DEV_PROBE_FIXTURES)[number];

function recordFor(name: string): AppRecord {
  return APP_RECORDS[name] ?? { appId: name, name, manifest: { capabilities: [] } };
}

/** Resolve a fixture name to the host record + bundle SOURCE `host.deliverBySource` needs — the
 *  same build-time-extracted maps the product path reads from, never the baked runtime page's own
 *  (intentionally empty) bundle map. */
export function devProbeFixture(name: DevProbeFixture): { record: AppRecord; source: string } {
  return { record: recordFor(name), source: APP_BUNDLES[name] ?? '' };
}
