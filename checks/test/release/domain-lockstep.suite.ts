/**
 * Acceptance for the domain lockstep (chain-11, platform-release-readiness).
 * openspec/changes/platform-release-readiness/specs/native-release-config/spec.md "The native
 * release domain matches the launcher's release domain"; design.md D1's lockstep paragraph.
 * `WHIM_DOMAIN` in the native release file (`release/whim-release.xcconfig`) and `WHIM_DOMAIN` in
 * the launcher's `release-config.ts` are two independent literals — nothing forces a JS constant
 * and an xcconfig/Gradle value to agree except this suite, which the gate runs on every commit.
 */

import { test, assert } from '../harness';
import { loadNativeReleaseConfig } from '../../../scripts/release/lib/native-config';
import { WHIM_DOMAIN as LAUNCHER_WHIM_DOMAIN } from '../../../src/host/launcher/release-config';

const REPO_ROOT = process.cwd();

export async function run(): Promise<void> {
  await test('domain-lockstep: the native release file and the launcher agree on WHIM_DOMAIN', () => {
    const native = loadNativeReleaseConfig(REPO_ROOT);
    assert(
      native.WHIM_DOMAIN === LAUNCHER_WHIM_DOMAIN,
      `WHIM_DOMAIN drifted: release/whim-release.xcconfig has "${native.WHIM_DOMAIN}", ` +
        `src/host/launcher/release-config.ts has "${LAUNCHER_WHIM_DOMAIN}" — they must name the same domain`,
    );
  });

  await test('domain-lockstep: a mismatch fails and names both values (discriminating: a same-length-only check would miss this)', () => {
    const native = { ...loadNativeReleaseConfig(REPO_ROOT), WHIM_DOMAIN: 'drifted-native.example' };
    const launcher = 'drifted-launcher.example';
    const matches = native.WHIM_DOMAIN === launcher;
    assert(!matches, 'fixture setup bug: the two drifted values must differ');
    const message =
      `WHIM_DOMAIN drifted: release/whim-release.xcconfig has "${native.WHIM_DOMAIN}", ` +
      `src/host/launcher/release-config.ts has "${launcher}" — they must name the same domain`;
    assert(message.includes('drifted-native.example') && message.includes('drifted-launcher.example'), 'the failure message must show both values');
  });
}
