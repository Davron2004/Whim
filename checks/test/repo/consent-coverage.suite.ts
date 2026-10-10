/**
 * The consent screen covers the current disclosure manifest (legal-surface-v2 design D4; spec
 * ai-data-consent "The disclosure names what is sent…"). The app can't import the manifest, so
 * `CONSENT_SCREEN_COVERAGE` in `src/host/launcher/copy.ts` names the copy keys that put each
 * manifest category and recipient role on the screen, and nothing but this suite holds the two
 * together: every on-screen category and screen-named role of the current manifest, and the purpose,
 * needs an entry; every key it names must be non-empty in every legal language table (`LEGAL_COPY`)
 * and one of them must say the thing the entry stands for (`NAMING`: the words that name it in each
 * language, so a swapped or reworded-away sentence fails, not only a missing key); and on the
 * first-run sheet's first layer no key serves two entries, so the row stays one sentence each. Each of
 * those tables also needs a what's-new line for every older consent version, and every legal key
 * (`LEGAL_COPY_KEYS`, plus any `consent` key a table carries) non-empty (spec
 * legal-text-localization "Every legal copy key exists in both languages"). No consent or report
 * string, and no what's-new line, may name OpenRouter or call anything anonymous.
 * (The launcher's consent UI suite holds the other half: the screen renders every covered key.)
 */

import nodeAssert from 'node:assert';
import { test } from '../harness';
import { MANIFESTS, latestVersion, type DisclosureManifest } from '../../../contract/src/disclosure-manifest';
import {
  COPY,
  CONSENT_SCREEN_COVERAGE,
  CONSENT_WHATS_NEW,
  FIRST_RUN_COVERAGE,
  LEGAL_COPY,
  LEGAL_COPY_KEYS,
  type LegalCopyTable,
} from '../../../src/host/launcher/copy';

/** Which copy keys put each manifest category and recipient role on a surface. */
interface Coverage {
  readonly categories: Readonly<Record<string, readonly string[]>>;
  readonly roles: Readonly<Record<string, readonly string[]>>;
  /** Why the data is sent. */
  readonly purpose: readonly string[];
}

export interface ConsentCoverageInput {
  /** The current disclosure manifest. */
  readonly manifest: DisclosureManifest;
  /** Every consent version before the current one: a grant under any of them is outdated. */
  readonly olderVersions: readonly number[];
  readonly coverage: Coverage;
  /** The same for the first-run sheet's first layer. */
  readonly firstLayerCoverage: Coverage;
  /** What each coverage entry stands for, in words: entry (`category:<id>`, `role:<id>`, `purpose`) →
   *  language → the pattern a string naming it matches. */
  readonly naming: Readonly<Record<string, Readonly<Record<string, RegExp>>>>;
  /** Language → that language's legal copy table. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The keys the legal screens read, which every table must carry. */
  readonly legalKeys: readonly string[];
  /** Language → grant version → what's-new line. */
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, { readonly text: string }>>>>;
}

/** What no consent, report or first-run string, in any language, may say: the router's name (the screen names
 *  roles, never a provider), or that the phone ID is anonymous (it is pseudonymous). */
const BANNED: readonly RegExp[] = [/open\s*router/i, /anonym/i];

const SCANNED_KEY = /^(consent|report|firstRun)/;

function bannedFindings(where: string, text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map((pattern) => `${where} matches ${pattern}: ${JSON.stringify(text)}`);
}

function isBlank(text: string | undefined): boolean {
  return (text ?? '').trim() === '';
}

/** What a string must say to name each coverage entry, per legal language: the words a reader looks
 *  for, written from the disclosure itself and not from the coverage tables they check. A language
 *  with no pattern for an entry fails, so a new language cannot pass unchecked. */
const NAMING: ConsentCoverageInput['naming'] = {
  'category:request-material': { en: /ask for/i, fr: /demandez/i },
  'category:phone-id': { en: /\bID\b/, fr: /identifiant/i },
  'category:error-details': { en: /error details/i, fr: /détails d.erreur/i },
  'role:anycognition': { en: /AnyCognition/, fr: /AnyCognition/ },
  'role:ai-providers': { en: /\bAI (providers|companies)/, fr: /(fournisseurs|entreprises) d.IA/ },
  'role:hosting-providers': { en: /host/i, fr: /héberge/i },
  'role:platform': { en: /Apple or Google/, fr: /Apple ou Google/ },
  'role:authorities': { en: /authorities/i, fr: /autorités/i },
  purpose: { en: /run Whim/, fr: /fonctionner Whim/ },
};

interface Entry {
  /** `category:<id>`, `role:<id>` or `purpose`: the `NAMING` key. */
  readonly entry: string;
  /** For the finding. */
  readonly what: string;
  readonly keys: readonly string[] | undefined;
}

/** What a surface must cover: every on-screen category and screen-named role of the manifest, and the purpose. */
function requiredOf(input: ConsentCoverageInput, coverage: Coverage): Entry[] {
  return [
    ...input.manifest.categories.filter((c) => c.onScreen).map((c) => ({ entry: `category:${c.id}`, what: `category ${c.id}`, keys: coverage.categories[c.id] })),
    ...input.manifest.roles.filter((r) => r.namedOnScreen).map((r) => ({ entry: `role:${r.id}`, what: `role ${r.id}`, keys: coverage.roles[r.id] })),
    { entry: 'purpose', what: 'the purpose', keys: coverage.purpose },
  ];
}

/** Whether, in `table`, the entry's non-blank keys say what `NAMING` expects; one finding if not. */
function namingFinding(input: ConsentCoverageInput, { entry, what, keys = [] }: Entry, language: string, table: Readonly<Record<string, string>>): string[] {
  const texts = keys.map((key) => table[key]).filter((text) => !isBlank(text));
  if (texts.length === 0) return [];
  const pattern = input.naming[entry]?.[language];
  if (pattern === undefined) return [`${what}: nothing says what naming it looks like in the ${language} table`];
  if (texts.some((text) => pattern.test(text))) return [];
  return [`${what}: none of ${keys.join(', ')} names it in the ${language} table (looked for ${pattern})`];
}

/** Every on-screen category and screen-named role of the manifest, and the purpose, has copy keys in
 *  `coverage`, each non-empty in every table, and one of them says it. `name` is the coverage table and
 *  `surface` the place, for the finding. */
function coverageFindings(input: ConsentCoverageInput, coverage: Coverage, name: string, surface: string): string[] {
  return requiredOf(input, coverage).flatMap((required) => {
    const { what, keys } = required;
    if (keys === undefined || keys.length === 0) {
      return [`${what} belongs on ${surface}, but ${name} names no copy key for it`];
    }
    return Object.entries(input.tables).flatMap(([language, table]) => [
      ...keys.filter((key) => isBlank(table[key])).map((key) => `${what}: ${key} is missing or empty in the ${language} table`),
      ...namingFinding(input, required, language, table),
    ]);
  });
}

/** On the first layer one sentence names one thing: a key claimed by two entries is a catch-all
 *  that hides which of them was dropped. */
function sharedKeyFindings(input: ConsentCoverageInput, coverage: Coverage, name: string): string[] {
  const claims = new Map<string, string[]>();
  for (const { what, keys } of requiredOf(input, coverage)) {
    for (const key of keys ?? []) claims.set(key, [...(claims.get(key) ?? []), what]);
  }
  return [...claims].filter(([, whats]) => whats.length > 1).map(([key, whats]) => `${name}: ${key} names ${whats.join(' and ')}; each needs a sentence of its own`);
}

/** Every table has a what's-new line for every older consent version. */
function whatsNewFindings(input: ConsentCoverageInput): string[] {
  return Object.keys(input.tables).flatMap((language) =>
    input.olderVersions
      .filter((version) => isBlank(input.whatsNew[language]?.[version]?.text))
      .map((version) => `the ${language} table has no what's-new line for a version-${version} grant`),
  );
}

/** A key starting with `consent` is legal copy whichever table it was added to. */
const CONSENT_KEY = /^consent/;

/** Every legal key — the declared list, and any `consent` key in any table — is non-empty in every
 *  table: a key added to one language only fails, naming the table that lacks it. */
function legalKeyFindings(input: ConsentCoverageInput): string[] {
  const tables = Object.entries(input.tables);
  const keys = new Set([...input.legalKeys, ...tables.flatMap(([, table]) => Object.keys(table).filter((key) => CONSENT_KEY.test(key)))]);
  return tables.flatMap(([language, table]) =>
    [...keys].filter((key) => isBlank(table[key])).map((key) => `legal key ${key} is missing or empty in the ${language} table`),
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
  return [
    ...coverageFindings(input, input.coverage, 'CONSENT_SCREEN_COVERAGE', 'the consent screen'),
    ...coverageFindings(input, input.firstLayerCoverage, 'FIRST_RUN_COVERAGE', 'the first-run sheet’s first layer'),
    ...sharedKeyFindings(input, input.firstLayerCoverage, 'FIRST_RUN_COVERAGE'),
    ...whatsNewFindings(input),
    ...legalKeyFindings(input),
    ...wordingFindings(input),
  ];
}

const CURRENT = latestVersion();

/** The live inputs, with `change` applied — each defect case below changes exactly one thing. */
function liveInput(change: Partial<ConsentCoverageInput> = {}): ConsentCoverageInput {
  return {
    manifest: MANIFESTS[CURRENT],
    olderVersions: Object.keys(MANIFESTS).map(Number).filter((v) => v < CURRENT),
    coverage: CONSENT_SCREEN_COVERAGE,
    firstLayerCoverage: FIRST_RUN_COVERAGE,
    naming: NAMING,
    tables: LEGAL_COPY,
    legalKeys: LEGAL_COPY_KEYS,
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
    const french: LegalCopyTable = { ...LEGAL_COPY.fr, consentSentErrors: ' ' };
    const whatsNew = { ...CONSENT_WHATS_NEW, fr: CONSENT_WHATS_NEW.en };
    const findings = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, fr: french }, whatsNew }));
    nodeAssert.deepStrictEqual(findings, [
      'category error-details: consentSentErrors is missing or empty in the fr table',
      'legal key consentSentErrors is missing or empty in the fr table',
    ]);
  });

  await test('legal keys: a key deleted from the French table fails, naming the key and the French table', () => {
    for (const key of ['termsUpdatedLine', 'consentOutdatedLine', 'legalLanguageSwitch'] as const) {
      const findings = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, fr: without<string>(LEGAL_COPY.fr, key) } }));
      nodeAssert.deepStrictEqual(findings, [`legal key ${key} is missing or empty in the fr table`], `deleting ${key}`);
    }
  });

  await test('legal keys: a new consent key added to the English table only fails, naming the key and the French table', () => {
    const english = { ...LEGAL_COPY.en, consentSentVoice: 'What you say, when you talk instead of typing' };
    const findings = consentCoverageFindings(liveInput({ tables: { en: english, fr: LEGAL_COPY.fr } }));
    nodeAssert.deepStrictEqual(findings, ['legal key consentSentVoice is missing or empty in the fr table']);
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

  await test('consent coverage: dropping a role or category from FIRST_RUN_COVERAGE, or blanking its text in one language, fails, naming it and the first-run sheet', () => {
    const roles = without(FIRST_RUN_COVERAGE.roles, 'platform');
    const dropped = consentCoverageFindings(liveInput({ firstLayerCoverage: { ...FIRST_RUN_COVERAGE, roles } }));
    assertFinding(dropped, ['role platform', 'first-run sheet', 'FIRST_RUN_COVERAGE names no copy key'], 'dropped role');
    const categories = without(FIRST_RUN_COVERAGE.categories, 'phone-id');
    assertFinding(consentCoverageFindings(liveInput({ firstLayerCoverage: { ...FIRST_RUN_COVERAGE, categories } })), ['category phone-id', 'first-run sheet'], 'dropped category');
    const french: LegalCopyTable = { ...LEGAL_COPY.fr, firstRunWhoAuthorities: '' };
    const blanked = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, fr: french } }));
    assertFinding(blanked, ['role authorities', 'firstRunWhoAuthorities', 'fr table'], 'blanked first-layer text');
  });

  await test('consent coverage: a sentence reworded so it no longer names its category or role fails, naming the entry, the key and the language', () => {
    const cases: readonly [string, Partial<ConsentCoverageInput>, readonly string[]][] = [
      ['first-run error details reworded away', { tables: { en: { ...COPY, firstRunSentErrors: 'Something may go wrong now and then.' } } }, ['category error-details', 'firstRunSentErrors', 'en table']],
      ['first-run phone ID swapped for the error sentence', { tables: { en: { ...COPY, firstRunSentDevice: COPY.firstRunSentErrors } } }, ['category phone-id', 'firstRunSentDevice', 'en table']],
      ['first-run app-integrity sentence without the platforms, in French', { tables: { fr: { ...LEGAL_COPY.fr, firstRunWhoPlatform: 'La demande vient de l’app Whim.' } } }, ['role platform', 'firstRunWhoPlatform', 'fr table']],
      ['first-run purpose sentence that says nothing of running Whim', { tables: { en: { ...COPY, firstRunWhy: 'All of it is used for the good of everyone.' } } }, ['the purpose', 'firstRunWhy', 'en table']],
      ['consent screen purpose reworded away, in French', { tables: { fr: { ...LEGAL_COPY.fr, consentWhy: 'Pour des raisons diverses.' } } }, ['the purpose', 'consentWhy', 'fr table']],
      ['consent screen authorities sentence without the authorities', { tables: { en: { ...COPY, consentWhoAuthorities: 'We follow the law.' } } }, ['role authorities', 'consentWhoAuthorities', 'en table']],
    ];
    for (const [label, change, parts] of cases) {
      assertFinding(consentCoverageFindings(liveInput(change)), parts, label);
    }
  });

  await test('consent coverage: dropping the AI providers from the shared recipient paragraph fails for that role alone', () => {
    const withoutAi = COPY.consentWho.replace(' and AI providers', '');
    nodeAssert.ok(withoutAi !== COPY.consentWho, 'the fixture really removed the words');
    const findings = consentCoverageFindings(liveInput({ tables: { en: { ...COPY, consentWho: withoutAi } } }));
    assertFinding(findings, ['role ai-providers', 'consentWho', 'en table'], 'dropped AI providers');
    nodeAssert.ok(!findings.some((f) => f.includes('role anycognition') || f.includes('role hosting-providers')), `the roles still named are not blamed: ${JSON.stringify(findings)}`);
  });

  await test('consent coverage: the first layer needs a sentence per entry, and a purpose entry on both surfaces', () => {
    const merged = { ...FIRST_RUN_COVERAGE, categories: { ...FIRST_RUN_COVERAGE.categories, 'phone-id': FIRST_RUN_COVERAGE.categories['request-material'] } };
    assertFinding(consentCoverageFindings(liveInput({ firstLayerCoverage: merged })), ['FIRST_RUN_COVERAGE', 'firstRunSentRequest', 'category request-material and category phone-id'], 'a key serving two entries');
    assertFinding(consentCoverageFindings(liveInput({ firstLayerCoverage: { ...FIRST_RUN_COVERAGE, purpose: [] } })), ['the purpose', 'FIRST_RUN_COVERAGE names no copy key'], 'no first-run purpose');
    assertFinding(consentCoverageFindings(liveInput({ coverage: { ...CONSENT_SCREEN_COVERAGE, purpose: [] } })), ['the purpose', 'CONSENT_SCREEN_COVERAGE names no copy key'], 'no consent purpose');
  });

  await test('consent coverage: a language the naming words do not cover fails instead of passing unchecked', () => {
    const findings = consentCoverageFindings(liveInput({ tables: { en: LEGAL_COPY.en, de: LEGAL_COPY.en }, whatsNew: { ...CONSENT_WHATS_NEW, de: CONSENT_WHATS_NEW.en } }));
    assertFinding(findings, ['category error-details', 'nothing says what naming it looks like', 'de table'], 'unknown language');
  });

  await test('consent coverage: a language with no what’s-new line for version 1 fails, naming it', () => {
    const findings = consentCoverageFindings(liveInput({ whatsNew: without(CONSENT_WHATS_NEW, 'fr') }));
    assertFinding(findings, ['fr table', 'version-1 grant'], 'missing what’s-new');
  });

  await test('consent coverage: OpenRouter or "anonymous" in a consent, report, first-run or what’s-new string fails', () => {
    const cases: readonly [string, Partial<ConsentCoverageInput>, readonly string[]][] = [
      ['a consent string naming the router', { tables: { en: { ...COPY, consentLead: 'Requests reach AI providers through OpenRouter.' } } }, ['en consentLead', 'open']],
      ['a first-run row naming the router', { tables: { en: { ...COPY, firstRunWhoAi: 'Your request goes to OpenRouter and then to the AI companies.' } } }, ['en firstRunWhoAi', 'open']],
      ['a first-run row calling the ID anonymous, in French', { tables: { fr: { ...LEGAL_COPY.fr, firstRunSentDevice: 'Un identifiant anonyme accompagne la demande.' } } }, ['fr firstRunSentDevice', 'anonym']],
      ['a report string calling the ID anonymous', { tables: { en: { ...COPY, reportDeviceIdLine: 'An anonymous ID goes with your report.' } } }, ['en reportDeviceIdLine', 'anonym']],
      ['a what’s-new line calling the ID anonymous', { whatsNew: { en: { 1: { text: 'Your anonymous ID now stays longer.' } } } }, ["en what's-new for version 1", 'anonym']],
    ];
    for (const [label, change, parts] of cases) {
      assertFinding(consentCoverageFindings(liveInput(change)), parts, label);
    }
  });
}
