/**
 * Whim pages host site acceptance (public-generation-server chain-15, design D21–D24; legal-surface-v2
 * D7). Scaffolded here by chain-15 itself (task 16.4), invoked from `runDeployConfigTests()`.
 *
 * Covers specs/server-deployment "The privacy policy and support pages match what the app
 * discloses" (the D23 parity tripwire) and "Association files come only from the release tooling"
 * (the `.well-known` present/absent build states) at the `build.ts` layer, and specs/legal-pages:
 * the legal pages rendered from the identity file, and the deploy check that refuses them. The
 * Caddy route table itself is chain-12's tripwire.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { caught, check, eq, section } from './harness';
import {
  associationState,
  buildSite,
  renderPage,
  RenderPageError,
  type AssociationFilesRunner,
} from '../src/site/build';
import { LEGAL_IDENTITY_PATH, LEGAL_PAGES, pageText, renderLegalSite, statedKeepPeriods, type LegalPage } from '../src/site/legal-pages';
import { COPY, LEGAL_COPY } from '../../src/host/launcher/copy';
import { KEEP_PERIOD_VARIABLES, loadServerConfig } from '../src/config';
import { MANIFESTS, keepLimit, type DisclosureManifest } from '../../contract/src/disclosure-manifest';
import { runAgeCheck, storedAgeGate } from '../../src/host/launcher/age-check';
import type { KVBackend } from '../../src/host/version-store/fs/kv-fs';

const REPO_ROOT = path.resolve(process.cwd());
const SITE_DIR = path.join(REPO_ROOT, 'deploy', 'site');

function readPage(name: string): string {
  return fs.readFileSync(path.join(SITE_DIR, name), 'utf8');
}

// `Record<string, string>` (rather than the closed `PlaceholderValues` type) so these fixtures
// also satisfy `buildSite`'s `env: NodeJS.ProcessEnv` parameter without a cast.
const FIXTURE_VALUES: Record<string, string> = {
  WHIM_SUPPORT_EMAIL: 'support@whim.anycognition.ca',
};

const FIXTURE_VALUES_WITH_STORES: Record<string, string> = {
  ...FIXTURE_VALUES,
  WHIM_APP_STORE_URL: 'https://apps.apple.com/app/whim/id123456789',
  WHIM_PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.anycognition.whim',
};

// ── Legal-page fixtures: the checked-in identity file, and that file with every optional value set ──

const REAL_IDENTITY: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, LEGAL_IDENTITY_PATH), 'utf8'));

const ADDRESS = '100 Example Street, Suite 200';
const PHONE = '+1 613 555 0100';
const EU_REPRESENTATIVE = 'Example Representation GmbH, 1 Beispielweg, 10115 Berlin, eu-rep@example.test';
const UK_REPRESENTATIVE = 'Example Representative Ltd, 2 Sample Road, London EC1A 1AA, uk-rep@example.test';
const PROVIDER_CONTACT = 'dpo@provider.example.test';

/** A deep copy of `value` with the field at `fieldPath` (`a.b`, `list[1].c`) set to `replacement`. */
function withField(value: unknown, fieldPath: string, replacement: unknown): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = fieldPath.split(/\.|\[(\d+)\]/).filter((key) => key !== undefined && key !== '');
  let target = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]] = replacement;
  return copy;
}

function providerCount(identity: unknown): number {
  return (identity as { providers: unknown[] }).providers.length;
}

const FULL_IDENTITY = [
  ['streetAddress', ADDRESS],
  ['phone', PHONE],
  ['representatives.eu', EU_REPRESENTATIVE],
  ['representatives.uk', UK_REPRESENTATIVE],
  ...Array.from({ length: providerCount(REAL_IDENTITY) }, (_, index) => [`providers[${index}].contact`, PROVIDER_CONTACT]),
].reduce((identity, [field, value]) => withField(identity, field, value), REAL_IDENTITY);

function legalSources(): Record<LegalPage, string> {
  return Object.fromEntries(LEGAL_PAGES.map((page) => [page, readPage(page)])) as Record<LegalPage, string>;
}

function renderLegal(
  identity: unknown,
  edit?: { readonly page: LegalPage; readonly from: string; readonly to: string },
  manifests?: Readonly<Record<number, DisclosureManifest>>,
): ReturnType<typeof renderLegalSite> {
  const sources = legalSources();
  if (edit !== undefined) {
    if (!sources[edit.page].includes(edit.from)) throw new Error(`fixture: ${edit.page} no longer contains ${JSON.stringify(edit.from)}`);
    sources[edit.page] = sources[edit.page].replace(edit.from, edit.to);
  }
  return renderLegalSite({ sources, identity, manifests });
}

const POLICIES: readonly LegalPage[] = ['privacy.html', 'fr/privacy.html'];
const TERMS: readonly LegalPage[] = ['terms.html', 'fr/terms.html'];

/** The page between two markers (both must be present). */
function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error(`fixture: the page lost ${start} or ${end}`);
  return html.slice(from, to);
}

const PROVIDER_SECTION_START = '<section id="providers">';
const KOREAN_SECTION_START = '<div lang="ko" id="ko-transfer">';

/** "Who handles it right now" in the page's own language, then its Korean transfer section. */
function providerLists(html: string): { readonly list: string; readonly korean: string } {
  return { list: between(html, PROVIDER_SECTION_START, KOREAN_SECTION_START), korean: between(html, KOREAN_SECTION_START, '</section>') };
}

/** The page with the provider section cut out: where no vendor may be named. */
function outsideProviderSection(html: string): string {
  const start = html.indexOf(PROVIDER_SECTION_START);
  const end = html.indexOf('</section>', start);
  return start === -1 || end === -1 ? html : html.slice(0, start) + html.slice(end);
}

/** Tags stripped, entities decoded, whitespace collapsed, curly and straight apostrophes
 *  compared as the same character (design D23's parity rule normalization). */
function normalizeForParity(html: string): string {
  return pageText(html).replace(/[’']/g, "'");
}

/** The D23 allowlist — screen chrome, not disclosure. Everything else starting with `consent`
 *  must appear verbatim in the rendered policy, denying by default. */
const CONSENT_ALLOWLIST: ReadonlySet<string> = new Set([
  'consentTitle',
  'consentOutdatedLine',
  'consentAgree',
  'consentDecline',
  'consentReviewKeepOn',
  'consentReviewTurnOff',
  'consentReviewTurnOn',
]);

/** The tripwire itself: every `copy` key starting with `consent`, except `allowlist`, must
 *  appear verbatim (after normalization) in `normalizedPolicy`. Returns the missing key names. */
function missingConsentDisclosures(
  copy: Readonly<Record<string, string>>,
  allowlist: ReadonlySet<string>,
  normalizedPolicy: string,
): string[] {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(copy)) {
    if (!key.startsWith('consent') || allowlist.has(key)) continue;
    if (!normalizedPolicy.includes(normalizeForParity(value))) missing.push(key);
  }
  return missing;
}

interface ServerKeepDefault {
  readonly variable: string;
  readonly category: string;
  readonly days: number;
}

/** A server default the policy doesn't cover: longer than a period the policy states for the
 *  default's category, or a category the policy states no period for. */
function serverKeepFindings(stated: ReadonlyMap<string, readonly number[]>, defaults: readonly ServerKeepDefault[]): string[] {
  const findings: string[] = [];
  for (const { variable, category, days } of defaults) {
    const periods = stated.get(category) ?? [];
    if (periods.length === 0 || periods.some((period) => days > period)) {
      findings.push(`${variable} keeps ${category} ${days} days; the policy states ${periods.join(', ') || 'none'}`);
    }
  }
  return findings;
}

function legalPageTests(): void {
  section('Web site: the legal pages from the identity file');

  const real = renderLegalSite({ sources: legalSources(), identity: REAL_IDENTITY });
  eq('the checked-in identity file passes the deploy check', real.findings, []);
  const unaddressed = ['streetAddress', 'phone'].reduce((value, name) => withField(value, name, ''), REAL_IDENTITY);
  const noAddress = renderLegalSite({ sources: legalSources(), identity: unaddressed });
  for (const page of LEGAL_PAGES) {
    check(`${page}: with no street address or phone, no address line renders`, !noAddress.pages[page].includes('class="postal"'));
    check(`${page}: names no privacy@ mailbox (the owner has none)`, !real.pages[page].toLowerCase().includes('privacy@'));
  }
  for (const page of POLICIES) {
    check(`${page}: with no representative recorded, no representative paragraph renders`, !real.pages[page].includes('class="representative"'));
  }

  const full = renderLegalSite({ sources: legalSources(), identity: FULL_IDENTITY });
  eq('the identity file with every optional value set passes the deploy check', full.findings, []);
  for (const page of LEGAL_PAGES) {
    const text = pageText(full.pages[page]);
    check(`${page}: a recorded street address and phone render`, text.includes(ADDRESS) && text.includes(PHONE));
  }
  for (const page of POLICIES) {
    const text = pageText(full.pages[page]);
    check(`${page}: a recorded EU and UK representative are named`, text.includes(EU_REPRESENTATIVE) && text.includes(UK_REPRESENTATIVE));
    const lists = providerLists(full.pages[page]);
    check(`${page}: a recorded provider contact shows in both provider lists`, lists.list.includes(PROVIDER_CONTACT) && lists.korean.includes(PROVIDER_CONTACT));
  }

  for (const field of ['streetAddress&phone', 'representatives.eu', 'representatives.uk', 'providers[0].contact']) {
    const identity = field.split('&').reduce((value, name) => withField(value, name, ''), FULL_IDENTITY);
    eq(`an empty optional ${field} is not a finding`, renderLegalSite({ sources: legalSources(), identity }).findings, []);
  }

  eq(
    'an empty contact email fails the check on every page, naming the field and the identity file',
    renderLegal(withField(REAL_IDENTITY, 'contactEmail', '')).findings,
    LEGAL_PAGES.map((page) => `${page}: {{LEGAL_CONTACT_EMAIL}} is empty: set "contactEmail" in ${LEGAL_IDENTITY_PATH}.`),
  );
  const required = [
    'legalName',
    'locality',
    'privacyOfficerTitle.en',
    'privacyOfficerTitle.fr',
    'effectiveDates.privacy',
    'effectiveDates.terms',
    'effectiveDates.providerList',
    'providers[0].name',
    'providers[1].role.ko',
    'providers[0].receives.fr',
    'providers[1].country.en',
    'providers[0].retention.en',
    'providers[1].retention.ko',
  ];
  for (const field of required) {
    const findings = renderLegal(withField(REAL_IDENTITY, field, '')).findings;
    check(
      `an empty required ${field} fails the check, naming the page and the field`,
      findings.length > 0 && findings.every((finding) => LEGAL_PAGES.some((page) => finding.startsWith(`${page}: `)) && finding.includes(`set "${field}" in ${LEGAL_IDENTITY_PATH}`)),
      findings.join(' | '),
    );
  }

  const halfAddress = renderLegal(withField(FULL_IDENTITY, 'phone', '')).findings;
  eq('a street address without a phone fails, naming the empty phone', halfAddress, [
    `${LEGAL_IDENTITY_PATH}: phone is empty, but the address line shows only when streetAddress and phone are both set: set both, or neither.`,
  ]);
  check(
    'a malformed contact email fails, naming it',
    renderLegal(withField(REAL_IDENTITY, 'contactEmail', 'support at anycognition')).findings.some((f) => f.startsWith(`${LEGAL_IDENTITY_PATH}: contactEmail must be an email address`)),
  );
  check(
    'a malformed effective date fails, naming it',
    renderLegal(withField(REAL_IDENTITY, 'effectiveDates.terms', '24/09/2026')).findings.some((f) => f.startsWith(`${LEGAL_IDENTITY_PATH}: effectiveDates.terms must be a YYYY-MM-DD date`)),
  );
  check(
    'a misspelt field fails, naming it (its value would never render)',
    renderLegal(withField(REAL_IDENTITY, 'phne', PHONE)).findings.includes(`${LEGAL_IDENTITY_PATH}: phne is not a field the legal pages know.`),
  );

  section('Web site: one provider list, two renderings');

  const added = {
    name: 'Example Mail Co.',
    contact: '',
    role: { en: 'Sends us alerts', fr: 'Nous envoie des alertes', ko: '알림 발송' },
    receives: { en: 'Error summaries', fr: 'Des résumés d’erreurs', ko: '오류 요약' },
    country: { en: 'Ireland', fr: 'Irlande', ko: '아일랜드' },
    retention: { en: '30 days', fr: '30 jours', ko: '30일' },
  };
  const identity = withField(REAL_IDENTITY, `providers[${providerCount(REAL_IDENTITY)}]`, added);
  const withProvider = renderLegal(identity);
  eq('an added provider row passes the deploy check', withProvider.findings, []);
  for (const page of POLICIES) {
    const lists = providerLists(withProvider.pages[page]);
    const country = page.startsWith('fr/') ? added.country.fr : added.country.en;
    check(`${page}: an added provider appears in "Who handles it right now"`, lists.list.includes(added.name) && lists.list.includes(country));
    check(`${page}: and in the Korean transfer section`, lists.korean.includes(added.name) && lists.korean.includes(added.country.ko) && lists.korean.includes(added.retention.ko));
  }
}

function providerNameTests(): void {
  section('Web site: a provider row that names a kind of company, per language');

  const kind = {
    name: { en: 'Example mail companies', fr: 'Des entreprises de courriel', ko: '예시 메일 업체' },
    contact: '',
    role: { en: 'Send us alerts', fr: 'Nous envoient des alertes', ko: '알림 발송' },
    receives: { en: 'Error summaries', fr: 'Des résumés d’erreurs', ko: '오류 요약' },
    country: { en: 'Ireland', fr: 'Irlande', ko: '아일랜드' },
    retention: { en: '30 days', fr: '30 jours', ko: '30일' },
  };
  const withKind = renderLegal(withField(REAL_IDENTITY, `providers[${providerCount(REAL_IDENTITY)}]`, kind));
  eq('a provider row with a name per language passes the deploy check', withKind.findings, []);
  for (const page of POLICIES) {
    const lists = providerLists(withKind.pages[page]);
    const own = page.startsWith('fr/') ? kind.name.fr : kind.name.en;
    const other = page.startsWith('fr/') ? kind.name.en : kind.name.fr;
    check(`${page}: a per-language name shows in its own language in "Who handles it right now"`, lists.list.includes(own) && !lists.list.includes(other));
    check(`${page}: and in Korean in the Korean transfer section`, lists.korean.includes(kind.name.ko) && !lists.korean.includes(own));
  }
  const blankFrench = withField(REAL_IDENTITY, `providers[${providerCount(REAL_IDENTITY)}]`, { ...kind, name: { ...kind.name, fr: '' } });
  eq(
    'an empty French name in a per-language name fails the French pages, naming name.fr',
    renderLegal(blankFrench).findings,
    [`fr/privacy.html: {{PROVIDER_NAME}} is empty: set "providers[${providerCount(REAL_IDENTITY)}].name.fr" in ${LEGAL_IDENTITY_PATH}.`],
  );
}

/** A key-value store in memory, for the age-check module the policy describes. */
function memoryKv(): KVBackend {
  const values = new Map<string, string>();
  return {
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
    getAllKeys: () => [...values.keys()],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NATIVE_AGE_SIGNAL = path.join(REPO_ROOT, 'src', 'native', 'NativeWhimAgeSignal.ts');

/** The store's age check as built (legal-surface-v2 D11): what one check keeps on the phone, and
 *  after how many days an allowed outcome stops holding and the store is asked again. */
async function builtAgeCheck(): Promise<{ readonly keptFields: readonly string[]; readonly recheckDays: number }> {
  const kv = memoryKv();
  const checkedAt = new Date('2026-09-27T12:00:00.000Z');
  await runAgeCheck(kv, async () => 'adult', () => checkedAt);
  const keptFields = kv.getAllKeys().flatMap((key) => Object.keys(JSON.parse(kv.getString(key) ?? '{}') as object)).sort((a, b) => a.localeCompare(b));
  let recheckDays = 0;
  while (recheckDays < 400 && storedAgeGate(kv, new Date(checkedAt.getTime() + (recheckDays + 1) * DAY_MS)) === 'allowed') recheckDays++;
  return { keptFields, recheckDays };
}

/** What the policy's age-check paragraph must say, in the page's language, for what was built. */
function ageParagraphFindings(page: LegalPage, html: string, built: { readonly keptFields: readonly string[]; readonly recheckDays: number }): string[] {
  const paragraph = elementText(html, 'p', 'age-signal');
  if (paragraph === undefined) return [`${page}: the store age check is built, but the policy has no age-check paragraph (<p id="age-signal">)`];
  const french = page.startsWith('fr/');
  const period = `${built.recheckDays} ${french ? 'jours' : 'days'}`;
  const findings: string[] = [];
  if (!paragraph.includes(period)) findings.push(`${page}: the age-check paragraph doesn't say the store is asked again every ${period}`);
  if (!paragraph.includes(french ? 'Rien sur votre âge ne quitte votre téléphone' : 'Nothing about your age leaves your phone')) {
    findings.push(`${page}: the age-check paragraph doesn't say nothing about age leaves the phone`);
  }
  return findings;
}

/** The reading text of the one `<tag id="id">`, or `undefined` when the page has none. */
function elementText(html: string, tag: string, id: string): string | undefined {
  const open = `<${tag} id="${id}">`;
  const start = html.indexOf(open);
  if (start === -1) return undefined;
  const end = html.indexOf(`</${tag}>`, start);
  return pageText(html.slice(start + open.length, end === -1 ? undefined : end));
}

async function ageAndPreviousVersionTests(): Promise<void> {
  section('Web site: the policy describes the store age check as built');

  const { pages } = renderLegalSite({ sources: legalSources(), identity: REAL_IDENTITY });
  if (fs.existsSync(NATIVE_AGE_SIGNAL)) {
    const built = await builtAgeCheck();
    eq('setup: an age check keeps only its outcome and the date it asked', built.keptFields, ['checkedAt', 'outcome']);
    for (const page of POLICIES) eq(`${page} carries the age-check paragraph, true to the built check`, ageParagraphFindings(page, pages[page], built), []);
    const withoutParagraph = renderLegal(REAL_IDENTITY, { page: 'fr/privacy.html', from: '<p id="age-signal">', to: '<p>' }).pages['fr/privacy.html'];
    eq('  red: a French policy without the age-check paragraph fails, naming the page', ageParagraphFindings('fr/privacy.html', withoutParagraph, built), [
      'fr/privacy.html: the store age check is built, but the policy has no age-check paragraph (<p id="age-signal">)',
    ]);
    const stale = renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: 'again every 30 days', to: 'again every 60 days' }).pages['privacy.html'];
    check('  red: a policy stating another re-ask period than the built check fails', ageParagraphFindings('privacy.html', stale, built).some((f) => f.includes(`every ${built.recheckDays} days`)));
  } else {
    check('no store age check is built, so the policy needs no age-check paragraph', !fs.existsSync(NATIVE_AGE_SIGNAL));
  }

  section('Web site: the previous policy stays readable until the new one takes effect');

  for (const page of POLICIES) {
    check(`${page} links the version-1 policy at /privacy/v1`, pages[page].includes('href="/privacy/v1"'));
  }
  const v1 = renderPage(readPage('privacy-v1.html'), FIXTURE_VALUES);
  check('privacy-v1.html is not a legal page: the legal-pages deploy check never reads it', !(LEGAL_PAGES as readonly string[]).includes('privacy-v1.html'));
  check('privacy-v1.html renders from deploy values alone, naming the support address', v1.includes(FIXTURE_VALUES.WHIM_SUPPORT_EMAIL) && !v1.includes('{{'));
  const v1Days = [...pageText(v1).matchAll(/deleted after (\d+) days|kept for (\d+) days/g)].map((m) => Number(m[1] ?? m[2]));
  eq(
    'privacy-v1.html states version 1’s keep-periods for reports and the ledger',
    v1Days,
    [keepLimit(MANIFESTS[1], 'reports')?.days, keepLimit(MANIFESTS[1], 'usage-records')?.days],
  );
}

function deployCheckRedChecks(): void {
  section('Web site: the legal-pages deploy check refuses');

  eq(
    'a leftover [B9] fails, naming the page and the marker',
    renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: 'Nobody at Whim can read what you save inside your apps.', to: 'Nobody at Whim can read what you save inside your apps. [B9]' }).findings,
    ['privacy.html: the draft marker or placeholder [B9] is still on the page.'],
  );
  eq(
    'a bracketed placeholder fails, naming the page and the placeholder',
    renderLegal(REAL_IDENTITY, { page: 'fr/terms.html', from: '{{LEGAL_LOCALITY}}', to: '[street address], {{LEGAL_LOCALITY}}' }).findings,
    ['fr/terms.html: the draft marker or placeholder [street address] is still on the page.'],
  );
  eq(
    'an unresolved {{…}} fails, naming the page and the value',
    renderLegal(REAL_IDENTITY, { page: 'terms.html', from: '{{LEGAL_LOCALITY}}', to: '{{LEGAL_CITY}}' }).findings,
    ['terms.html: unknown placeholder {{LEGAL_CITY}}.'],
  );
  eq(
    'a policy with no retention row for a manifest category fails, naming it',
    renderLegal(REAL_IDENTITY, { page: 'fr/privacy.html', from: ' data-keep="reports"', to: '' }).findings,
    ['fr/privacy.html: manifest category reports has no row in "How long we keep it" (data-keep="reports").'],
  );
  eq(
    'a policy with no data row for a manifest category fails, naming it',
    renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: ' data-category="app-integrity"', to: '' }).findings,
    ['privacy.html: manifest category app-integrity has no row in "What leaves your phone" (data-category="app-integrity").'],
  );
  eq(
    'a policy stating a longer keep-period than the manifest fails, naming the category',
    renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: 'Deleted within 12 months.', to: 'Deleted within 24 months.' }).findings,
    ['privacy.html: reports is kept at most 365 days (manifest version 2), but its "How long we keep it" row states 730 days.'],
  );
  eq(
    'a policy stating a shorter keep-period than the manifest publishes fails too: it states the maximum',
    renderLegal(REAL_IDENTITY, { page: 'fr/privacy.html', from: 'Supprimés dans les 12 mois.', to: 'Supprimés dans les 90 jours.' }).findings,
    ['fr/privacy.html: reports is kept at most 365 days (manifest version 2), but its "How long we keep it" row states 90 days.'],
  );
  eq(
    'a policy giving a not-kept category a period fails',
    renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: 'Only while your request is being handled.', to: 'For 30 days.' }).findings,
    ['privacy.html: request-material is not kept (manifest version 2), but its "How long we keep it" row states 30 days.'],
  );
  eq(
    'a policy dropping the version-1 rule fails for each category whose maximum grew',
    renderLegal(REAL_IDENTITY, { page: 'fr/privacy.html', from: ' data-keep-v1="reports usage-records"', to: '' }).findings,
    [
      'fr/privacy.html: usage-records records made under version 1 keep its 90-day rule, but the page\'s data-keep-v1 note states no period.',
      'fr/privacy.html: reports records made under version 1 keep its 90-day rule, but the page\'s data-keep-v1 note states no period.',
    ],
  );

  const current = MANIFESTS[2];
  const shorterReports: Readonly<Record<number, DisclosureManifest>> = {
    ...MANIFESTS,
    2: { ...current, categories: current.categories.map((c) => (c.id === 'reports' ? { ...c, keep: { kind: 'max-days', days: 180, after: 'collection' } as const } : c)) },
  };
  eq(
    'the check reads the manifest: a manifest publishing 180 days for reports fails both unchanged policies',
    renderLegal(REAL_IDENTITY, undefined, shorterReports).findings,
    POLICIES.map((page) => `${page}: reports is kept at most 180 days (manifest version 2), but its "How long we keep it" row states 365 days.`),
  );
}

function parityAndRetentionTests(): void {
  section('Web site: parity and retention');

  const { pages } = renderLegalSite({ sources: legalSources(), identity: REAL_IDENTITY });
  const normalizedPolicy = normalizeForParity(pages['privacy.html']);

  const missing = missingConsentDisclosures(COPY, CONSENT_ALLOWLIST, normalizedPolicy);
  eq('privacy.html quotes every non-allowlisted consent key verbatim', missing, []);

  {
    // A policy missing consentSentDevice's text must fail.
    const policyWithoutDeviceLine = normalizedPolicy.replace(normalizeForParity(COPY.consentSentDevice), '');
    const redMissing = missingConsentDisclosures(COPY, CONSENT_ALLOWLIST, policyWithoutDeviceLine);
    eq('dropping the phone-ID line fails naming consentSentDevice', redMissing, ['consentSentDevice']);
  }

  {
    // A COPY fixture with an extra un-quoted consent key must fail against the real (denies by
    // default) rule — not against a variant that only checks a hand-kept list of known keys.
    const copyWithNewKey = { ...COPY, consentWhatSentReports: 'A new disclosure line, never quoted anywhere.' };
    const redMissing = missingConsentDisclosures(copyWithNewKey, CONSENT_ALLOWLIST, normalizedPolicy);
    eq('an unquoted new consent key fails naming itself', redMissing, ['consentWhatSentReports']);
  }

  // The French policy quotes the French consent screen the same way (legal-surface-v2 D6): same
  // allowlist, same normalization, against the French legal table.
  const normalizedFrenchPolicy = normalizeForParity(pages['fr/privacy.html']);
  eq(
    'fr/privacy.html quotes every non-allowlisted French consent key verbatim',
    missingConsentDisclosures(LEGAL_COPY.fr, CONSENT_ALLOWLIST, normalizedFrenchPolicy),
    [],
  );

  {
    // A French page whose "who gets it" paragraph drifted from the app's must fail, naming the key.
    const drifted = renderLegal(REAL_IDENTITY, { page: 'fr/privacy.html', from: 'pour des raisons de sécurité ou juridiques', to: 'pour des raisons de sécurité' });
    const redMissing = missingConsentDisclosures(LEGAL_COPY.fr, CONSENT_ALLOWLIST, normalizeForParity(drifted.pages['fr/privacy.html']));
    eq('a French page that drops words from the French consentWho fails naming consentWho', redMissing, ['consentWho']);
  }

  // The processor is named in the provider list, and nowhere else: no promise rests on a vendor.
  for (const page of POLICIES) {
    check(`${page} names OpenRouter in "Who handles it right now"`, providerLists(pages[page]).list.includes('OpenRouter'));
    check(`${page} names OpenRouter nowhere outside the provider list`, !pageText(outsideProviderSection(pages[page])).includes('OpenRouter'));
    const lower = pageText(pages[page]).toLowerCase();
    for (const vendor of ['deepseek', 'anthropic', 'openai', 'gemini', 'claude', 'gpt']) {
      check(`${page} does not name a specific model vendor (${vendor})`, !lower.includes(vendor));
    }
    check(`${page} never calls anything anonymous`, !lower.includes('anonym'));
  }
  check(
    '  red: "via OpenRouter" outside the provider list is caught',
    pageText(outsideProviderSection(renderLegal(REAL_IDENTITY, { page: 'privacy.html', from: 'AI providers work for us.', to: 'AI providers work for us via OpenRouter.' }).pages['privacy.html'])).includes('OpenRouter'),
  );

  // Every server keep-period default fits inside what both policies publish for its category. The
  // policies state the manifest maximum (the check above), so this fails when a default outgrows it.
  const config = loadServerConfig({});
  const defaults: readonly ServerKeepDefault[] = [
    { variable: 'WHIM_REPORT_RETENTION_DAYS', category: 'reports', days: config.reportRetentionDays },
    { variable: 'WHIM_LEDGER_RETENTION_DAYS', category: 'usage-records', days: config.ledgerRetentionDays },
    { variable: 'WHIM_USAGE_IDLE_DAYS', category: 'usage-records', days: config.usageIdleDays },
  ];
  eq(
    'every server keep-period variable is compared with the policy',
    defaults.map((d) => d.variable).sort((a, b) => a.localeCompare(b)),
    [...KEEP_PERIOD_VARIABLES].sort((a, b) => a.localeCompare(b)),
  );
  for (const page of POLICIES) {
    eq(`${page} states a keep-period covering each of loadServerConfig({})'s defaults`, serverKeepFindings(statedKeepPeriods(pages[page]), defaults), []);
  }
  eq(
    '  red: a 400-day report default fails against the policy',
    serverKeepFindings(statedKeepPeriods(pages['privacy.html']), [{ variable: 'WHIM_REPORT_RETENTION_DAYS', category: 'reports', days: 400 }]),
    ['WHIM_REPORT_RETENTION_DAYS keeps reports 400 days; the policy states 365'],
  );

  section('Web site: each legal page links its twin');

  const twins: Readonly<Record<LegalPage, string>> = {
    'privacy.html': '/fr/privacy',
    'fr/privacy.html': '/privacy',
    'terms.html': '/fr/terms',
    'fr/terms.html': '/terms',
  };
  for (const page of LEGAL_PAGES) check(`${page} links ${twins[page]}`, pages[page].includes(`href="${twins[page]}"`));
  for (const page of TERMS) check(`${page} links its own language's policy`, pages[page].includes(`href="${page.startsWith('fr/') ? '/fr/privacy' : '/privacy'}"`));
}

export async function runWebSiteTests(): Promise<void> {
  legalPageTests();
  providerNameTests();
  deployCheckRedChecks();
  parityAndRetentionTests();
  await ageAndPreviousVersionTests();

  section('Web site: renderPage placeholder rules');

  eq('renderPage substitutes and escapes required values', renderPage('{{WHIM_SUPPORT_EMAIL}}', FIXTURE_VALUES), 'support@whim.anycognition.ca');

  {
    const err = await caught(() => {
      renderPage('{{WHIM_NOT_A_REAL_PLACEHOLDER}}', FIXTURE_VALUES);
    });
    check(
      'an unknown placeholder fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_NOT_A_REAL_PLACEHOLDER',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL}}', {});
    });
    check(
      'a missing required value fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_SUPPORT_EMAIL',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL}}', { ...FIXTURE_VALUES, WHIM_SUPPORT_EMAIL: 'not-an-email' });
    });
    check(
      'a malformed required value fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_SUPPORT_EMAIL',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL', FIXTURE_VALUES);
    });
    check('a leftover {{ marker fails', err instanceof RenderPageError && err.placeholder === '{{');
  }

  {
    const err = await caught(() => {
      renderPage('<!--IF:WHIM_APP_STORE_URL-->unclosed', FIXTURE_VALUES_WITH_STORES);
    });
    check('an unclosed IF block fails', err instanceof RenderPageError && err.placeholder === '<!--');
  }

  eq(
    'renderPage HTML-escapes a value containing <',
    renderPage('{{WHIM_SUPPORT_EMAIL}}', {
      ...FIXTURE_VALUES,
      WHIM_SUPPORT_EMAIL: '<script>alert(1)</script>@evil.com',
    }),
    '&lt;script&gt;alert(1)&lt;/script&gt;@evil.com',
  );

  const bothStores = '<!--IF:WHIM_APP_STORE_URL&WHIM_PLAY_STORE_URL-->both<!--ENDIF-->';
  eq('an IF block naming two values is kept when both are set', renderPage(bothStores, FIXTURE_VALUES_WITH_STORES), 'both');
  eq(
    'and dropped when either is empty',
    renderPage(bothStores, { ...FIXTURE_VALUES, WHIM_APP_STORE_URL: FIXTURE_VALUES_WITH_STORES.WHIM_APP_STORE_URL }),
    '',
  );

  section('Web site: app-link store links');

  const appLinkSource = readPage('app-link.html');
  const appLinkWithoutStores = renderPage(appLinkSource, FIXTURE_VALUES);
  check('with no store URLs, app-link.html has no store links', !appLinkWithoutStores.includes('class="stores"'));

  const appLinkWithStores = renderPage(appLinkSource, FIXTURE_VALUES_WITH_STORES);
  check(
    'with both store URLs, app-link.html links both stores',
    appLinkWithStores.includes(FIXTURE_VALUES_WITH_STORES.WHIM_APP_STORE_URL) &&
      appLinkWithStores.includes(FIXTURE_VALUES_WITH_STORES.WHIM_PLAY_STORE_URL),
  );

  section('Web site: no script in any rendered page');

  const legalPages = renderLegalSite({ sources: legalSources(), identity: FULL_IDENTITY }).pages;
  for (const page of LEGAL_PAGES) check(`${page} contains no <script`, !legalPages[page].toLowerCase().includes('<script'));
  for (const file of ['support.html', 'app-link.html', 'not-found.html', 'privacy-v1.html']) {
    const rendered = renderPage(readPage(file), FIXTURE_VALUES_WITH_STORES).toLowerCase();
    check(`${file} contains no <script`, !rendered.includes('<script'));
  }

  section('Web site: associationState');

  // The "neither fingerprint file" case is the same `missingPath` the `buildSite` "no
  // fingerprints" case below already asserts, end to end — not duplicated here.

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assoc-upload-only-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      eq('upload fingerprint only: absent, naming the play-signing path', associationState(dir), {
        kind: 'absent',
        missingPath: 'release/android-play-signing-cert.sha256',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assoc-both-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      fs.writeFileSync(path.join(dir, 'release', 'android-play-signing-cert.sha256'), 'CC:DD\n');
      eq('both fingerprints: present', associationState(dir), { kind: 'present' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  section('Web site: buildSite');

  /** A repo holding this checkout's whole `deploy/site/`, identity file included, or `identity`
   *  in its place. */
  function fakeRepoRoot(withFingerprints: boolean, identity?: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-buildsite-repo-'));
    fs.cpSync(SITE_DIR, path.join(dir, 'deploy', 'site'), { recursive: true });
    if (identity !== undefined) fs.writeFileSync(path.join(dir, LEGAL_IDENTITY_PATH), JSON.stringify(identity));
    if (withFingerprints) {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      fs.writeFileSync(path.join(dir, 'release', 'android-play-signing-cert.sha256'), 'CC:DD\n');
    }
    return dir;
  }

  const neverCalledRunner: AssociationFilesRunner = async () => {
    throw new Error('runAssociationFiles should not be called when a fingerprint is missing');
  };

  {
    const repoRoot = fakeRepoRoot(false);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-absent-${process.pid}`);
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: neverCalledRunner });
      eq('no fingerprints: build succeeds reporting absent', result, {
        ok: true,
        associationState: 'absent',
        missingPath: 'release/android-upload-cert.sha256',
      });
      check('no fingerprints: outDir has no .well-known', !fs.existsSync(path.join(outDir, '.well-known')));
      eq(
        'the build publishes every legal page exactly as the deploy check rendered it',
        LEGAL_PAGES.map((page) => fs.readFileSync(path.join(outDir, page), 'utf8')),
        LEGAL_PAGES.map((page) => renderLegalSite({ sources: legalSources(), identity: REAL_IDENTITY }).pages[page]),
      );
      check('  ... and not the identity file itself', !fs.existsSync(path.join(outDir, path.basename(LEGAL_IDENTITY_PATH))));
      eq(
        '  ... and the version-1 policy, rendered from deploy values',
        fs.readFileSync(path.join(outDir, 'privacy-v1.html'), 'utf8'),
        renderPage(readPage('privacy-v1.html'), FIXTURE_VALUES),
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(false, withField(REAL_IDENTITY, 'contactEmail', ''));
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-legal-${process.pid}`);
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: neverCalledRunner });
      check(
        'an identity file with no contact email fails the build, naming the field and the file',
        !result.ok && result.reason.includes(`set "contactEmail" in ${LEGAL_IDENTITY_PATH}`),
        result.ok ? 'built' : result.reason,
      );
      check('a failed build (legal pages) leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-present-${process.pid}`);
    const aasaBytes = Buffer.from('{"applinks":{"details":[]}}');
    const assetLinksBytes = Buffer.from('[{"relation":[]}]');
    const successRunner: AssociationFilesRunner = async (stageDir) => {
      fs.writeFileSync(path.join(stageDir, 'apple-app-site-association'), aasaBytes);
      fs.writeFileSync(path.join(stageDir, 'assetlinks.json'), assetLinksBytes);
      return { exitCode: 0 };
    };
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: successRunner });
      eq('both fingerprints + a successful runner: build succeeds reporting present', result, {
        ok: true,
        associationState: 'present',
      });
      check(
        'the AASA file is copied byte for byte',
        fs.readFileSync(path.join(outDir, '.well-known', 'apple-app-site-association')).equals(aasaBytes),
      );
      check(
        'the assetlinks file is copied byte for byte',
        fs.readFileSync(path.join(outDir, '.well-known', 'assetlinks.json')).equals(assetLinksBytes),
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-failing-${process.pid}`);
    const failingRunner: AssociationFilesRunner = async () => ({ exitCode: 1 });
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: failingRunner });
      check('a non-zero runner exit fails the build', !result.ok);
      check('a failed build leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-wrongfiles-${process.pid}`);
    const wrongFilesRunner: AssociationFilesRunner = async (stageDir) => {
      fs.writeFileSync(path.join(stageDir, 'apple-app-site-association'), 'x');
      fs.writeFileSync(path.join(stageDir, 'extra-file.txt'), 'y');
      return { exitCode: 0 };
    };
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: wrongFilesRunner });
      check('an unexpected file set fails the build', !result.ok);
      check('a failed build (wrong file set) leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(false);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-missing-env-${process.pid}`);
    try {
      const result = await buildSite({ repoRoot, env: {}, outDir, runAssociationFiles: neverCalledRunner });
      check('a missing required env value fails the build', !result.ok);
      check('a failed build (missing env) leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}
