/**
 * Acceptance for the disclosure manifest and its release check (legal-surface-v2 tasks 1.2–1.3;
 * spec ai-data-consent "The consent version changes only when the disclosure manifest widens").
 * The diff cases run on fixture manifests derived from version 2, one per scenario of the
 * requirement plus its non-widening list; the release-check cases feed `disclosureReleaseFindings`
 * fixture inputs; the live case runs the same check the release preflight and deploy.sh run.
 */

import nodeAssert from 'node:assert';
import { test } from '../harness';
import {
  MANIFESTS,
  diffManifests,
  disclosureReleaseFindings,
  type DataUse,
  type DisclosureCategory,
  type DisclosureManifest,
  type DisclosureReleaseInput,
} from '../../../contract/src/disclosure-manifest';
import { checkDisclosureRelease } from '../../../scripts/release/lib/disclosure-check';

const REPO_ROOT = process.cwd();
const V1: DisclosureManifest = MANIFESTS[1];
const V2: DisclosureManifest = MANIFESTS[2];

/** A new category covered by the main grant, shown on the screen, kept 90 days. */
function category(id: string, overrides: Partial<DisclosureCategory> = {}): DisclosureCategory {
  return {
    id,
    rows: [{ name: id, description: `The ${id} fixture` }],
    excludes: {},
    keep: { kind: 'max-days', days: 90, after: 'collection' },
    consent: 'main',
    toggle: 'none',
    onScreen: true,
    savedData: 'none',
    store: { apple: [], play: [] },
    ...overrides,
  };
}

function withCategory(manifest: DisclosureManifest, added: DisclosureCategory, purposes: readonly string[] = ['operate']): DisclosureManifest {
  return {
    ...manifest,
    categories: [...manifest.categories, added],
    uses: [...manifest.uses, { category: added.id, roles: ['anycognition'], purposes }],
  };
}

function editCategory(manifest: DisclosureManifest, id: string, change: Partial<DisclosureCategory>): DisclosureManifest {
  return { ...manifest, categories: manifest.categories.map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

function withUse(manifest: DisclosureManifest, use: DataUse): DisclosureManifest {
  return { ...manifest, uses: [...manifest.uses, use] };
}

function withPurpose(manifest: DisclosureManifest, id: string, advertisingOrTracking = false): DisclosureManifest {
  return { ...manifest, purposes: [...manifest.purposes, { id, description: `The ${id} fixture`, advertisingOrTracking }] };
}

/** The live manifests with each released as-is, and a what's-new line covering exactly the diff. */
function releaseInput(overrides: Partial<DisclosureReleaseInput> = {}): DisclosureReleaseInput {
  return {
    manifests: { 1: V1, 2: V2 },
    released: { 1: V1, 2: V2 },
    consentVersion: 2,
    bumpReasons: {},
    whatsNew: { en: { 1: { text: 'What changed.', covers: diffManifests(V1, V2) } } },
    ...overrides,
  };
}

function assertFinding(findings: readonly string[], parts: readonly string[], label: string): void {
  nodeAssert.ok(
    findings.some((f) => parts.every((part) => f.includes(part))),
    `${label}: expected a finding naming ${parts.join(' + ')}, got ${JSON.stringify(findings)}`,
  );
}

async function widensTests(): Promise<void> {
  await test('disclosure diff: switching AI provider within the service-provider role does not widen', () => {
    const reworded = {
      ...V2,
      roles: V2.roles.map((r) => (r.id === 'service-providers' ? { ...r, description: 'Companies acting only for AnyCognition, such as a model vendor’s direct API' } : r)),
    };
    nodeAssert.deepStrictEqual(diffManifests(V2, reworded), []);
  });

  await test('disclosure diff: a new diagnostic field and a ledger failure_reason column fall inside their categories', () => {
    const withFields = editCategory(
      editCategory(V2, 'error-details', { rows: [{ name: 'Error details', description: 'Technical details, now with the device model' }] }),
      'usage-records',
      { rows: [{ name: 'Usage records', description: 'Per request: type, times, how it ended, failure reason, cost' }] },
    );
    nodeAssert.deepStrictEqual(diffManifests(V2, withFields), []);
  });

  await test('disclosure diff: sign-in with an email address adds a main-grant category', () => {
    nodeAssert.deepStrictEqual(diffManifests(V2, withCategory(V2, category('account-email'))), ['category:account-email']);
  });

  await test('disclosure diff: keeping requests to evaluate model quality widens a purpose, a keep-period and a core promise', () => {
    const evaluated = editCategory(withUse(withPurpose(V2, 'model-evaluation'), { category: 'request-material', roles: ['anycognition'], purposes: ['model-evaluation'] }), 'request-material', {
      keep: { kind: 'max-days', days: 365, after: 'collection' },
    });
    nodeAssert.deepStrictEqual(diffManifests(V2, evaluated), ['keep:request-material', 'promise:requests-not-kept', 'purpose:request-material:model-evaluation']);
  });

  await test('disclosure diff: the same evaluation as its own switch, off until the user agrees, does not widen', () => {
    const optIn = withCategory(withPurpose(V2, 'model-evaluation'), category('evaluation-requests', { consent: 'own-opt-in', toggle: 'default-off', onScreen: false }), ['model-evaluation']);
    nodeAssert.deepStrictEqual(diffManifests(V2, optIn), []);
  });

  await test('disclosure diff: end-to-end encrypted sync with its own opt-in, off by default, does not widen', () => {
    const sync = category('sync', { consent: 'own-opt-in', toggle: 'default-off', onScreen: false, savedData: 'encrypted-on-phone' });
    nodeAssert.deepStrictEqual(diffManifests(V2, withCategory(V2, sync)), []);
  });

  await test('disclosure diff: sync Whim could decrypt narrows the saved-data promise, whatever its opt-in', () => {
    const readable = category('sync', { consent: 'own-opt-in', toggle: 'default-off', onScreen: false, savedData: 'readable' });
    nodeAssert.deepStrictEqual(diffManifests(V2, withCategory(V2, readable)), ['promise:saved-data-unreadable']);
  });

  await test('disclosure diff: a purchase record consented to by the purchase itself does not widen', () => {
    const purchases = category('purchase-records', { consent: 'user-act', onScreen: false, keep: { kind: 'max-days', days: 365, after: 'collection' } });
    nodeAssert.deepStrictEqual(diffManifests(V2, withCategory(V2, purchases)), []);
  });

  await test('disclosure diff: reports going from 12 months to 5 years widens their keep-period', () => {
    nodeAssert.deepStrictEqual(diffManifests(V2, editCategory(V2, 'reports', { keep: { kind: 'max-days', days: 1825, after: 'collection' } })), ['keep:reports']);
  });

  await test('disclosure diff: every other widening clause has its own id', () => {
    const optional = withCategory(V2, category('voice', { consent: 'own-opt-in', toggle: 'default-off' }));
    const cases: readonly [string, DisclosureManifest, DisclosureManifest, string][] = [
      ['an excluded field', V2, editCategory(V2, 'error-details', { excludes: { 'saved-data': 'Saved data' } }), 'exclusion:error-details:free-text-errors'],
      ['a new (category, role) pair', V2, withUse(V2, { category: 'request-material', roles: ['platform'], purposes: ['operate'] }), 'recipient:request-material:platform'],
      ['a new recipient role', V2, { ...V2, roles: [...V2.roles, { id: 'data-buyer', description: 'Uses data for its own purposes', namedOnScreen: true }] }, 'role:data-buyer'],
      ['a kept category that was not kept', V2, editCategory(V2, 'request-material', { keep: { kind: 'with', categories: ['reports'] } }), 'keep:request-material'],
      ['a new carrier for a with-kept category', V2, editCategory(V2, 'phone-id', { keep: { kind: 'with', categories: ['usage-records', 'reports', 'app-integrity'] } }), 'keep:phone-id'],
      ['a keep-period counted from last use instead', V2, editCategory(V2, 'reports', { keep: { kind: 'max-days', days: 365, after: 'last-use' } }), 'keep:reports'],
      ['an optional category turned on by default', optional, editCategory(optional, 'voice', { toggle: 'default-on' }), 'default:voice'],
      ['an opt-in moved into the main grant', optional, editCategory(optional, 'voice', { consent: 'main' }), 'consent:voice'],
      ['a purpose for advertising', V2, withUse(withPurpose(V2, 'ads', true), { category: 'usage-records', roles: ['anycognition'], purposes: ['ads'] }), 'promise:no-advertising'],
      ['a removed core promise', V2, { ...V2, promises: V2.promises.filter((p) => p.id !== 'requests-not-kept') }, 'promise:requests-not-kept'],
    ];
    for (const [label, from, to, id] of cases) {
      const found: readonly string[] = diffManifests(from, to);
      nodeAssert.ok(found.includes(id), `${label}: expected ${id}, got ${JSON.stringify(found)}`);
    }
  });

  await test('disclosure diff: shorter keep-periods and every kind of narrowing do not widen', () => {
    const narrowed: readonly [string, DisclosureManifest, DisclosureManifest][] = [
      ['a shorter keep-period', V2, editCategory(V2, 'reports', { keep: { kind: 'max-days', days: 180, after: 'collection' } })],
      ['a removed category', V2, { ...V2, categories: V2.categories.filter((c) => c.id !== 'error-details') }],
      ['a removed role', V2, { ...V2, roles: V2.roles.filter((r) => r.id !== 'successor'), uses: V2.uses.filter((u) => !u.roles.includes('successor')) }],
      ['a removed use', V2, { ...V2, uses: V2.uses.slice(1) }],
      ['an added exclusion', V2, editCategory(V2, 'usage-records', { excludes: { 'request-content': 'Request content', 'ip-address': 'IP address' } })],
      ['an added core promise', V1, { ...V1, promises: V2.promises }],
    ];
    for (const [label, from, to] of narrowed) {
      nodeAssert.deepStrictEqual(diffManifests(from, to), [], label);
    }
  });

  await test('disclosure diff: version 1 to 2 widens everything v1 never disclosed', () => {
    // Error details, the app-integrity check by Apple or Google, the longer keep-periods for reports
    // and usage records, and what v1's consent screen and privacy page never said: service providers
    // beyond the AI companies, requests used to run Whim, connection logs used at all, authorities
    // (when the law requires it, or for fraud, security or safety problems) and a new owner.
    nodeAssert.deepStrictEqual(diffManifests(V1, V2), [
      'category:app-integrity',
      'category:error-details',
      'keep:reports',
      'keep:usage-records',
      'purpose:connection-logs:legal',
      'purpose:connection-logs:operate',
      'purpose:connection-logs:safety',
      'purpose:phone-id:legal',
      'purpose:reports:legal',
      'purpose:request-material:legal',
      'purpose:request-material:operate',
      'purpose:usage-records:legal',
      'purpose:usage-records:safety',
      'recipient:connection-logs:service-providers',
      'recipient:phone-id:service-providers',
      'recipient:reports:service-providers',
      'recipient:usage-records:service-providers',
      'role:authorities',
      'role:platform',
      'role:successor',
    ]);
  });
}

async function releaseCheckTests(): Promise<void> {
  await test('release check: this checkout passes (the gate, the release preflight and deploy.sh run this)', () => {
    const findings = checkDisclosureRelease(REPO_ROOT);
    nodeAssert.deepStrictEqual(findings, [], `the disclosure release check refused:\n${findings.join('\n')}`);
  });

  await test('release check: the fixture baseline passes (the defect cases below each change one thing)', () => {
    nodeAssert.deepStrictEqual(disclosureReleaseFindings(releaseInput()), []);
  });

  await test('release check: adding a category to released version 2 is refused, naming version 2 and the widening', () => {
    const edited = withCategory(V2, category('account-email'));
    const findings = disclosureReleaseFindings(releaseInput({ manifests: { 1: V1, 2: edited } }));
    assertFinding(findings, ['version 2 was released', 'category:account-email'], 'edited released version');
  });

  await test('release check: a server-only purpose added to released version 2 is refused', () => {
    const edited = withUse(V2, { category: 'request-material', roles: ['anycognition'], purposes: ['safety'] });
    const findings = disclosureReleaseFindings(releaseInput({ manifests: { 1: V1, 2: edited } }));
    assertFinding(findings, ['version 2 was released', 'purpose:request-material:safety'], 'server-only purpose');
  });

  await test('release check: a widening version 3 without the version bump is refused', () => {
    const v3 = withCategory(V2, category('account-email'));
    const findings = disclosureReleaseFindings(releaseInput({ manifests: { 1: V1, 2: V2, 3: v3 }, released: { 1: V1, 2: V2, 3: v3 } }));
    assertFinding(findings, ['AI_CONSENT_VERSION is 2', 'highest disclosure manifest version is 3'], 'unbumped version');
  });

  await test('release check: a bump with nothing new is refused until a reviewed reason exists', () => {
    const whatsNew = { en: { 1: { text: 'What changed.', covers: diffManifests(V1, V2) }, 2: { text: 'We fixed the last screen.', covers: [] } } };
    const bumped = releaseInput({ manifests: { 1: V1, 2: V2, 3: V2 }, released: { 1: V1, 2: V2, 3: V2 }, consentVersion: 3, whatsNew });
    assertFinding(disclosureReleaseFindings(bumped), ['version 3 does not widen version 2', 'BUMP_REASONS[3]'], 'empty bump');
    nodeAssert.deepStrictEqual(disclosureReleaseFindings({ ...bumped, bumpReasons: { 3: 'The version-2 screen left out the phone ID.' } }), []);
  });

  await test('release check: a manifest version with no released snapshot is refused', () => {
    assertFinding(disclosureReleaseFindings(releaseInput({ released: { 1: V1 } })), ['version 2 has no snapshot', 'v2.json'], 'missing snapshot');
  });

  await test('release check: a what’s-new line that hides the longer keep-period for reports is refused, naming the language', () => {
    const hiding = diffManifests(V1, V2).filter((id) => id !== 'keep:reports');
    for (const language of ['en', 'fr']) {
      const whatsNew = { en: { 1: { text: 'What changed.', covers: diffManifests(V1, V2) } }, [language]: { 1: { text: 'Ce qui change.', covers: hiding } } };
      assertFinding(disclosureReleaseFindings(releaseInput({ whatsNew })), [`what's-new (${language}) for version 1`, 'does not cover keep:reports'], language);
    }
  });

  await test('release check: a what’s-new line claiming a widening that did not happen, or missing, is refused', () => {
    const claiming = { en: { 1: { text: 'What changed.', covers: [...diffManifests(V1, V2), 'keep:connection-logs'] } } };
    assertFinding(disclosureReleaseFindings(releaseInput({ whatsNew: claiming })), ['covers keep:connection-logs', 'did not widen'], 'extra cover');
    assertFinding(disclosureReleaseFindings(releaseInput({ whatsNew: { en: {} } })), ["what's-new (en) has no line for version 1"], 'missing line');
  });
}

export async function run(): Promise<void> {
  await widensTests();
  await releaseCheckTests();
}
