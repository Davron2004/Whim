/** The dev-probe fixtures each resolve a real source and record. */

import { Harness } from './harness';
import { DEV_PROBE_FIXTURES, devProbeFixture } from '../dev-probe-fixtures';
import { bundleDefinesApp } from '../bundle-validity';

export async function runDevProbeBackButtonTests(h: Harness): Promise<void> {
  // review fix F3: every dev-probe fixture button resolves a real bundle SOURCE, not a page-side
  // deliver-by-name lookup into `RUNTIME_HTML`'s intentionally empty baked bundle map.
  await h.test('F3: every dev-probe fixture resolves a real source and record', () => {
    for (const name of DEV_PROBE_FIXTURES) {
      const fixture = devProbeFixture(name);
      h.ok(fixture.source.length > 0, `${name}: devProbeFixture must return a non-empty bundle source`);
      h.ok(bundleDefinesApp(fixture.source), `${name}: the resolved source must define an app (bundleDefinesApp)`);
      h.ok(fixture.record.appId.length > 0, `${name}: the resolved record must carry an appId`);
    }
  });
}
