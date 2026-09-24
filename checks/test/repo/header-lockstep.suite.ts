/**
 * The phone's request-envelope header names match the contract's (request-envelope D8; spec "The
 * phone's header names match the contract"). The app cannot import `@whim/contract` values — zod
 * never enters the Metro bundle — so `src/host/launcher/wire-headers.ts` keeps its own literals
 * under the contract's constant names, and nothing but this suite holds the two together. The same
 * holds for the app-version pattern `src/host/launcher/app-info.ts` checks before sending: a
 * version the phone accepts but the envelope refuses would fail every `/v1` call with a `400`.
 */

import * as contract from '@whim/contract';
import { test, assert } from '../harness';
import * as phone from '../../../src/host/launcher/wire-headers';
import { APP_VERSION_PATTERN, appInfoFrom } from '../../../src/host/launcher/app-info';

/** A value as the lockstep compares it: a pattern by its source and flags, anything else as is. */
function spelling(value: unknown): unknown {
  return value instanceof RegExp ? String(value) : value;
}

/** One finding per phone value that differs from the contract constant of the same name (or that
 *  the contract does not export at all), naming the constant and both values. */
export function headerLockstepFindings(phoneValues: Record<string, unknown>, contractExports: Record<string, unknown>): string[] {
  return Object.entries(phoneValues)
    .filter(([name, value]) => spelling(contractExports[name]) !== spelling(value))
    .map(
      ([name, value]) =>
        `${name}: the phone has ${JSON.stringify(spelling(value))} but @whim/contract says ${JSON.stringify(spelling(contractExports[name]))}`,
    );
}

/** Whether the phone's own check lets `version` through to a request. */
function phoneAccepts(version: string): boolean {
  try {
    appInfoFrom('ios', { version, build: '1' });
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('WhimAppInfo: version')) return false;
    throw err;
  }
}

/** Whether the server's envelope schema parses `version` as the app-version header. */
function envelopeAccepts(version: string): boolean {
  return contract.ClientEnvelope.safeParse({ platform: 'ios', appVersion: version, build: '1', consent: 'none' }).success;
}

export async function run(): Promise<void> {
  await test('header lockstep: every phone header name equals the contract constant of the same name', () => {
    assert(Object.keys(phone).length > 0, 'wire-headers.ts exports no header names, so this check would pass vacuously');
    const findings = headerLockstepFindings(phone, contract);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('headerLockstepFindings: a renamed header fails, naming it and both spellings', () => {
    const drifted = { ...phone, BUILD_HEADER: 'x-whim-build-number' };
    const findings = headerLockstepFindings(drifted, contract);
    assert(
      findings.length === 1 &&
        findings[0].startsWith('BUILD_HEADER:') &&
        findings[0].includes('x-whim-build-number') &&
        findings[0].includes(JSON.stringify(contract.BUILD_HEADER)),
      `expected one finding naming BUILD_HEADER and both values, got ${JSON.stringify(findings)}`,
    );
  });

  await test('version lockstep: the phone accepts exactly the app versions the contract envelope does', () => {
    const findings = headerLockstepFindings({ APP_VERSION_PATTERN }, contract);
    assert(findings.length === 0, findings.join('; '));
    const versions = ['1.0.0', '1.1.0-beta.2', '2.0.0+381500', `1${'0'.repeat(31)}`, `1${'0'.repeat(32)}`, 'v1.1', '.1', '1.0 beta', '1_0', ''];
    for (const version of versions) {
      const [onPhone, onServer] = [phoneAccepts(version), envelopeAccepts(version)];
      assert(onPhone === onServer, `${JSON.stringify(version)}: the phone ${onPhone ? 'sends' : 'refuses'} it but the envelope ${onServer ? 'accepts' : 'refuses'} it`);
    }
  });

  await test('headerLockstepFindings: a drifted version pattern fails, naming it and both patterns', () => {
    const drifted = /^v?\d[0-9A-Za-z.+-]{0,31}$/;
    const findings = headerLockstepFindings({ APP_VERSION_PATTERN: drifted }, contract);
    assert(
      findings.length === 1 &&
        findings[0].startsWith('APP_VERSION_PATTERN:') &&
        findings[0].includes(JSON.stringify(String(drifted))) &&
        findings[0].includes(JSON.stringify(String(contract.APP_VERSION_PATTERN))),
      `expected one finding naming APP_VERSION_PATTERN and both patterns, got ${JSON.stringify(findings)}`,
    );
  });
}
