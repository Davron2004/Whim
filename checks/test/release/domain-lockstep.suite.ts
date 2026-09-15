/**
 * Acceptance for the domain lockstep (chain-11, platform-release-readiness).
 * openspec/changes/platform-release-readiness/specs/native-release-config/spec.md "The native
 * release domain matches the launcher's release domain"; design.md D1's lockstep paragraph.
 * `WHIM_DOMAIN` in the native release file (`release/whim-release.xcconfig`), `WHIM_DOMAIN` in
 * the launcher's `release-config.ts`, and `deploy/defaults.env`'s two derived hosts are
 * independent literals — nothing forces them to agree except this suite, which the gate runs on
 * every commit.
 */

import { test, assert } from '../harness';
import { loadNativeReleaseConfig } from '../../../scripts/release/lib/native-config';
import { domainLockstepFinding, deployHostLockstepFindings, loadDeployDefaults, type DeployDefaults } from '../../../scripts/release/lib/domain-lockstep';
import { WHIM_DOMAIN as LAUNCHER_WHIM_DOMAIN } from '../../../src/host/launcher/release-config';

const REPO_ROOT = process.cwd();

export async function run(): Promise<void> {
  await test('domain-lockstep: the native release file and the launcher agree on WHIM_DOMAIN', () => {
    const native = loadNativeReleaseConfig(REPO_ROOT);
    const finding = domainLockstepFinding(native.WHIM_DOMAIN, LAUNCHER_WHIM_DOMAIN);
    assert(finding === undefined, finding ?? '');
  });

  await test('domainLockstepFinding: matching domains return no finding', () => {
    assert(domainLockstepFinding('anycognition.ca', 'anycognition.ca') === undefined, 'expected no finding for matching domains');
  });

  await test('domainLockstepFinding: a mismatch fails and names both values (discriminating: a same-length-only check would miss this)', () => {
    const finding = domainLockstepFinding('drifted-native.example', 'drifted-launcher.example');
    assert(
      finding !== undefined && finding.includes('drifted-native.example') && finding.includes('drifted-launcher.example'),
      `expected a finding naming both values, got ${JSON.stringify(finding)}`,
    );
  });

  await test('domain-lockstep: deploy/defaults.env agrees with the native release domain', () => {
    const native = loadNativeReleaseConfig(REPO_ROOT);
    const deploy = loadDeployDefaults(REPO_ROOT);
    const findings = deployHostLockstepFindings(native.WHIM_DOMAIN, deploy);
    assert(findings.length === 0, `expected deploy/defaults.env to match, got ${JSON.stringify(findings)}`);
  });

  await test('deployHostLockstepFindings: matching hosts return no findings', () => {
    const deploy: DeployDefaults = { WHIM_API_HOST: 'api.whim.anycognition.ca', WHIM_WEB_HOST: 'whim.anycognition.ca' };
    assert(deployHostLockstepFindings('anycognition.ca', deploy).length === 0, 'expected no findings for matching hosts');
  });

  await test('deployHostLockstepFindings: a mismatched API host fails, naming both', () => {
    const deploy: DeployDefaults = { WHIM_API_HOST: 'api.whim.wrong.example', WHIM_WEB_HOST: 'whim.anycognition.ca' };
    const findings = deployHostLockstepFindings('anycognition.ca', deploy);
    assert(
      findings.some((f) => f.includes('api.whim.wrong.example') && f.includes('api.whim.anycognition.ca')),
      `expected an API host finding naming both, got ${JSON.stringify(findings)}`,
    );
  });

  await test('deployHostLockstepFindings: a mismatched web host fails, naming both', () => {
    const deploy: DeployDefaults = { WHIM_API_HOST: 'api.whim.anycognition.ca', WHIM_WEB_HOST: 'whim.wrong.example' };
    const findings = deployHostLockstepFindings('anycognition.ca', deploy);
    assert(
      findings.some((f) => f.includes('whim.wrong.example') && f.includes('whim.anycognition.ca')),
      `expected a web host finding naming both, got ${JSON.stringify(findings)}`,
    );
  });
}
