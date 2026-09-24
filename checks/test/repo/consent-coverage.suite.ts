/**
 * The consent screen covers the current disclosure manifest (legal-surface-v2 design D4; spec
 * ai-data-consent "The disclosure names what is sent…"). The app can't import the manifest, so
 * `CONSENT_SCREEN_COVERAGE` in `src/host/launcher/copy.ts` names the copy keys that put each
 * manifest category and recipient role on the screen, and nothing but this suite holds the two
 * together: every on-screen category and screen-named role of the current manifest needs an entry,
 * and every key it names must be non-empty in every legal language table (`LEGAL_COPY`). Each of
 * those tables also needs a what's-new line for every older consent version, and no consent or
 * report string, and no what's-new line, may name OpenRouter or call anything anonymous.
 * (The launcher's consent UI suite holds the other half: the screen renders every covered key.)
 */

import nodeAssert from 'node:assert';
import { test } from '../harness';
import { MANIFESTS, latestVersion, type DisclosureManifest } from '../../../contract/src/disclosure-manifest';
import {
  COPY,
  CONSENT_SCREEN_COVERAGE,
  CONSENT_WHATS_NEW,
  LEGAL_COPY,
  type LegalCopyTable,
} from '../../../src/host/launcher/copy';

export interface ConsentCoverageInput {
  /** The current disclosure manifest. */
  readonly manifest: DisclosureManifest;
  /** Every consent version before the current one: a grant under any of them is outdated. */
  readonly olderVersions: readonly number[];
  readonly coverage: {
    readonly categories: Readonly<Record<string, readonly string[]>>;
    readonly roles: Readonly<Record<string, readonly string[]>>;
  };
  /** Language → that language's legal copy table. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Language → grant version → what's-new line. */
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, { readonly text: string }>>>>;
}

/** What no consent or report string, in any language, may say: the router's name (the screen names
 *  roles, never a provider), or that the phone ID is anonymous (it is pseudonymous). */
const BANNED: readonly RegExp[] = [/open\s*router/i, /anonym/i];

const SCANNED_KEY = /^(consent|report)/;

function bannedFindings(where: string, text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map((pattern) => `${where} matches ${pattern}: ${JSON.stringify(text)}`);
}

function isBlank(text: string | undefined): boolean {
  return (text ?? '').trim() === '';
}

/** Every on-screen category and screen-named role of the manifest has copy keys, each non-empty
 *  in every table. */
function coverageFindings(input: ConsentCoverageInput): string[] {
  const required: [string, readonly string[] | undefined][] = [
    ...input.manifest.categories.filter((c) => c.onScreen).map((c): [string, readonly string[] | undefined] => [`category ${c.id}`, input.coverage.categories[c.id]]),
    ...input.manifest.roles.filter((r) => r.namedOnScreen).map((r): [string, readonly string[] | undefined] => [`role ${r.id}`, input.coverage.roles[r.id]]),
  ];
  return required.flatMap(([what, keys]) => {
    if (keys === undefined || keys.length === 0) {
      return [`${what} belongs on the consent screen, but CONSENT_SCREEN_COVERAGE names no copy key for it`];
    }
    return Object.entries(input.tables).flatMap(([language, table]) =>
      keys.filter((key) => isBlank(table[key])).map((key) => `${what}: ${key} is missing or empty in the ${language} table`),
    );
  });
}

/** Every table has a what's-new line for every older consent version. */
function whatsNewFindings(input: ConsentCoverageInput): string[] {
  return Object.keys(input.tables).flatMap((language) =>
    input.olderVersions
      .filter((version) => isBlank(input.whatsNew[language]?.[version]?.text))
      .map((version) => `the ${language} table has no what's-new line for a version-${version} grant`),
  );
}

/** No consent or report string, and no what's-new line, says what `BANNED` forbids. */
function wordingFindings(input: ConsentCoverageInput): string[] {
  const strings = Object.entries(input.tables).flatMap(([language, table]) =>
    Object.entries(table).filter(([key]) => SCANNED_KEY.test(key)).map(([key, value]): [string, string] => [`${language} ${key}`, value]),
  );
  const lines = Object.entries(input.whatsNew).flatMap(([language, byVersion]) =>
    Object.entries(byVersion).map(([version, line]): [string, string] => [`${language} what's-new for version ${version}`, line.text]),
  );
  return [...strings, ...lines].flatMap(([where, text]) => bannedFindings(where, text));
}

/** One finding per gap; `[]` means the screen covers the manifest in every language. */
export function consentCoverageFindings(input: ConsentCoverageInput): string[] {
  return [...coverageFindings(input), ...whatsNewFindings(input), ...wordingFindings(input)];
}

const CURRENT = latestVersion();

/** The live inputs, with `change` applied — each defect case below changes exactly one thing. */
function liveInput(change: Partial<ConsentCoverageInput> = {}): ConsentCoverageInput {
  return {
    manifest: MANIFESTS[CURRENT],
    olderVersions: Object.keys(MANIFESTS).map(Number).filter((v) => v < CURRENT),
    coverage: CONSENT_SCREEN_COVERAGE,
    tables: LEGAL_COPY,
    whatsNew: CONSENT_WHATS_NEW,
    ...change,
  };
}

function assertFinding(findings: readonly string[], parts: readonly string[], label: string): void {
  nodeAssert.ok(
    findings.some((f) => parts.every((part) => f.includes(part))),
    `${label}: expected a finding naming ${parts.join(' + ')}, got ${JSON.stringify(findings)}`,
  );
}

/** `record` without `key`. */
function without<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

export async function run(): Promise<void> {
  await test('consent coverage: the screen covers the current manifest in every language table', () => {
    const input = liveInput();
    const onScreen = input.manifest.categories.filter((c) => c.onScreen).length + input.manifest.roles.filter((r) => r.namedOnScreen).length;
    nodeAssert.ok(onScreen > 0, 'the current manifest puts nothing on the screen, so this check would pass vacuously');
    nodeAssert.ok(Object.keys(input.tables).length > 0, 'no legal language table, so this check would pass vacuously');
    const findings = consentCoverageFindings(input);
    nodeAssert.deepStrictEqual(findings, [], `the consent screen does not cover the manifest:\n${findings.join('\n')}`);
  });

  await test('consent coverage: deleting the app-integrity sentence fails, naming the platform role', () => {
    const emptied = consentCoverageFindings(liveInput({ tables: { en: { ...COPY, consentWhoPlatform: '' } } }));
    assertFinding(emptied, ['role platform', 'consentWhoPlatform', 'en table'], 'emptied sentence');
    const deleted = consentCoverageFindings(liveInput({ tables: { en: without<string>(COPY, 'consentWhoPlatform') } }));
    assertFinding(deleted, ['role platform', 'consentWhoPlatform', 'en table'], 'deleted key');
  });

  await test('consent coverage: a second language missing an error-details sentence fails, naming that language', () => {
    const french: LegalCopyTable = { ...LEGAL_COPY.en, consentSentErrors: ' ' };
    const whatsNew = { ...CONSENT_WHATS_NEW, fr: CONSENT_WHATS_NEW.en };
    const findings = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, fr: french }, whatsNew }));
    nodeAssert.deepStrictEqual(findings, ['category error-details: consentSentErrors is missing or empty in the fr table']);
  });

  await test('consent coverage: a new on-screen category or screen-named role with no copy key fails, naming it', () => {
    const manifest = liveInput().manifest;
    const voice = { ...manifest.categories[0], id: 'voice', onScreen: true };
    const buyer = { id: 'data-buyer', description: 'Uses data for its own purposes', namedOnScreen: true };
    const findings = consentCoverageFindings(liveInput({ manifest: { ...manifest, categories: [...manifest.categories, voice], roles: [...manifest.roles, buyer] } }));
    assertFinding(findings, ['category voice', 'names no copy key'], 'new category');
    assertFinding(findings, ['role data-buyer', 'names no copy key'], 'new role');
  });

  await test('consent coverage: dropping a role from CONSENT_SCREEN_COVERAGE fails, naming the role', () => {
    const roles = without(CONSENT_SCREEN_COVERAGE.roles, 'authorities');
    const findings = consentCoverageFindings(liveInput({ coverage: { ...CONSENT_SCREEN_COVERAGE, roles } }));
    assertFinding(findings, ['role authorities', 'names no copy key'], 'dropped role');
  });

  await test('consent coverage: a language with no what’s-new line for version 1 fails, naming it', () => {
    const findings = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, fr: { ...LEGAL_COPY.en } } }));
    assertFinding(findings, ['fr table', 'version-1 grant'], 'missing what’s-new');
  });

  await test('consent coverage: OpenRouter or "anonymous" in a consent, report or what’s-new string fails', () => {
    const cases: readonly [string, Partial<ConsentCoverageInput>, readonly string[]][] = [
      ['a consent string naming the router', { tables: { en: { ...COPY, consentLead: 'Requests reach AI providers through OpenRouter.' } } }, ['en consentLead', 'open']],
      ['a report string calling the ID anonymous', { tables: { en: { ...COPY, reportDeviceIdLine: 'An anonymous ID goes with your report.' } } }, ['en reportDeviceIdLine', 'anonym']],
      ['a what’s-new line calling the ID anonymous', { whatsNew: { en: { 1: { text: 'Your anonymous ID now stays longer.' } } } }, ["en what's-new for version 1", 'anonym']],
    ];
    for (const [label, change, parts] of cases) {
      assertFinding(consentCoverageFindings(liveInput(change)), parts, label);
    }
  });
}
