/**
 * server/src/site/legal-pages.ts — the legal pages and their deploy check (legal-surface-v2 D7,
 * specs/legal-pages). Every owner-only value comes from one checked-in identity file; the pages
 * are rendered from it, and `renderLegalSite`'s findings refuse the site build when a page still
 * carries an unresolved value, a draft marker, or a retention statement the manifest contradicts.
 *
 * Pure: the caller reads the files. Page-language values resolve by the page's folder (`fr/` is
 * French); a provider list names its own language: `<!--EACH:PROVIDERS:ko-->`.
 */
import {
  keepLimit,
  latestVersion,
  MANIFESTS,
  type DisclosureManifest,
} from '../../../contract/src/disclosure-manifest';
import { looksLikeEmail, RenderPageError, renderTemplate, type ListResolver, type Resolver } from './template';

export const LEGAL_PAGES = ['privacy.html', 'terms.html', 'fr/privacy.html', 'fr/terms.html'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

export const LEGAL_IDENTITY_PATH = 'deploy/site/legal-identity.json';

const PAGE_LANGUAGES = ['en', 'fr'] as const;
const LIST_LANGUAGES = ['en', 'fr', 'ko'] as const;
type PageLanguage = (typeof PAGE_LANGUAGES)[number];
type ListLanguage = (typeof LIST_LANGUAGES)[number];
type Translated<L extends string> = { readonly [K in L]: string };

interface ProviderRow {
  readonly name: string;
  readonly contact: string;
  readonly role: Translated<ListLanguage>;
  readonly receives: Translated<ListLanguage>;
  readonly country: Translated<ListLanguage>;
  readonly retention: Translated<ListLanguage>;
}

interface LegalIdentity {
  readonly legalName: string;
  readonly streetAddress: string;
  readonly locality: string;
  readonly phone: string;
  readonly contactEmail: string;
  readonly privacyOfficerTitle: Translated<PageLanguage>;
  readonly effectiveDates: { readonly privacy: string; readonly terms: string; readonly providerList: string };
  readonly representatives: { readonly eu: string; readonly uk: string };
  readonly providers: readonly ProviderRow[];
}

// ── Reading the identity file ───────────────────────────────────────────────────────────────

const TOP_KEYS = [
  'legalName',
  'streetAddress',
  'locality',
  'phone',
  'contactEmail',
  'privacyOfficerTitle',
  'effectiveDates',
  'representatives',
  'providers',
];
const PROVIDER_KEYS = ['name', 'contact', 'role', 'receives', 'country', 'retention'];

type Fields = Readonly<Record<string, unknown>>;

function fieldPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

/** Reads the fixed shape, recording every missing, mistyped or unknown field. Missing text reads
 *  as empty, so one bad field never hides the rest. */
class IdentityReader {
  readonly findings: string[] = [];

  note(field: string, problem: string): void {
    this.findings.push(`${LEGAL_IDENTITY_PATH}: ${field} ${problem}`);
  }

  fields(value: unknown, field: string, keys: readonly string[]): Fields {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.note(field || 'the file', 'must be an object.');
      return {};
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) this.note(fieldPath(field, key), 'is not a field the legal pages know.');
    }
    return value as Fields;
  }

  text(from: Fields, parent: string, key: string): string {
    const value = from[key];
    if (typeof value === 'string') return value.trim();
    this.note(fieldPath(parent, key), value === undefined ? 'is missing (write "" for a value not set yet).' : 'must be a string.');
    return '';
  }

  translated<L extends string>(from: Fields, parent: string, key: string, languages: readonly L[]): Translated<L> {
    const field = fieldPath(parent, key);
    const fields = this.fields(from[key], field, languages);
    return Object.fromEntries(languages.map((language) => [language, this.text(fields, field, language)])) as Translated<L>;
  }

  provider(value: unknown, index: number): ProviderRow {
    const field = `providers[${index}]`;
    const fields = this.fields(value, field, PROVIDER_KEYS);
    return {
      name: this.text(fields, field, 'name'),
      contact: this.text(fields, field, 'contact'),
      role: this.translated(fields, field, 'role', LIST_LANGUAGES),
      receives: this.translated(fields, field, 'receives', LIST_LANGUAGES),
      country: this.translated(fields, field, 'country', LIST_LANGUAGES),
      retention: this.translated(fields, field, 'retention', LIST_LANGUAGES),
    };
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function identityValueFindings(identity: LegalIdentity, reader: IdentityReader): void {
  if (identity.contactEmail !== '' && !looksLikeEmail(identity.contactEmail)) {
    reader.note('contactEmail', `must be an email address, got ${JSON.stringify(identity.contactEmail)}.`);
  }
  for (const [key, value] of Object.entries(identity.effectiveDates)) {
    if (value !== '' && !isCalendarDate(value)) reader.note(`effectiveDates.${key}`, `must be a YYYY-MM-DD date, got ${JSON.stringify(value)}.`);
  }
  if ((identity.streetAddress === '') !== (identity.phone === '')) {
    const empty = identity.streetAddress === '' ? 'streetAddress' : 'phone';
    reader.note(empty, 'is empty, but the address line shows only when streetAddress and phone are both set: set both, or neither.');
  }
  if (identity.providers.length === 0) {
    reader.note('providers', 'lists no provider, but "Who handles it right now" must name every current one.');
  }
}

function readLegalIdentity(raw: unknown): { readonly identity: LegalIdentity; readonly findings: string[] } {
  const reader = new IdentityReader();
  const root = reader.fields(raw, '', TOP_KEYS);
  const dates = reader.fields(root.effectiveDates, 'effectiveDates', ['privacy', 'terms', 'providerList']);
  const representatives = reader.fields(root.representatives, 'representatives', ['eu', 'uk']);
  let providers: readonly unknown[] = [];
  if (Array.isArray(root.providers)) providers = root.providers;
  else reader.note('providers', 'must be a list.');

  const identity: LegalIdentity = {
    legalName: reader.text(root, '', 'legalName'),
    streetAddress: reader.text(root, '', 'streetAddress'),
    locality: reader.text(root, '', 'locality'),
    phone: reader.text(root, '', 'phone'),
    contactEmail: reader.text(root, '', 'contactEmail'),
    privacyOfficerTitle: reader.translated(root, '', 'privacyOfficerTitle', PAGE_LANGUAGES),
    effectiveDates: {
      privacy: reader.text(dates, 'effectiveDates', 'privacy'),
      terms: reader.text(dates, 'effectiveDates', 'terms'),
      providerList: reader.text(dates, 'effectiveDates', 'providerList'),
    },
    representatives: { eu: reader.text(representatives, 'representatives', 'eu'), uk: reader.text(representatives, 'representatives', 'uk') },
    providers: providers.map((row, index) => reader.provider(row, index)),
  };
  identityValueFindings(identity, reader);
  return { identity, findings: reader.findings };
}

// ── Resolving the pages' names ──────────────────────────────────────────────────────────────

type Slot<T, L extends string> = (from: T, language: L) => readonly [field: string, value: string];

/** Every identity value a legal page may name. A named value must be set; an optional one is
 *  wrapped in its own `<!--IF:…-->` block, so it is only ever named when it has a value. */
const IDENTITY_SLOTS: Readonly<Record<string, Slot<LegalIdentity, PageLanguage>>> = {
  LEGAL_NAME: (i) => ['legalName', i.legalName],
  LEGAL_STREET_ADDRESS: (i) => ['streetAddress', i.streetAddress],
  LEGAL_LOCALITY: (i) => ['locality', i.locality],
  LEGAL_PHONE: (i) => ['phone', i.phone],
  LEGAL_CONTACT_EMAIL: (i) => ['contactEmail', i.contactEmail],
  LEGAL_PRIVACY_OFFICER_TITLE: (i, language) => [`privacyOfficerTitle.${language}`, i.privacyOfficerTitle[language]],
  LEGAL_PRIVACY_EFFECTIVE: (i) => ['effectiveDates.privacy', i.effectiveDates.privacy],
  LEGAL_TERMS_EFFECTIVE: (i) => ['effectiveDates.terms', i.effectiveDates.terms],
  LEGAL_PROVIDERS_CHANGED: (i) => ['effectiveDates.providerList', i.effectiveDates.providerList],
  LEGAL_EU_REPRESENTATIVE: (i) => ['representatives.eu', i.representatives.eu],
  LEGAL_UK_REPRESENTATIVE: (i) => ['representatives.uk', i.representatives.uk],
};

/** The row values inside `<!--EACH:PROVIDERS:<language>-->`. */
const PROVIDER_SLOTS: Readonly<Record<string, Slot<ProviderRow, ListLanguage>>> = {
  PROVIDER_NAME: (row) => ['name', row.name],
  PROVIDER_CONTACT: (row) => ['contact', row.contact],
  PROVIDER_ROLE: (row, language) => [`role.${language}`, row.role[language]],
  PROVIDER_RECEIVES: (row, language) => [`receives.${language}`, row.receives[language]],
  PROVIDER_COUNTRY: (row, language) => [`country.${language}`, row.country[language]],
  PROVIDER_RETENTION: (row, language) => [`retention.${language}`, row.retention[language]],
};

function slotResolution(name: string, field: string, value: string) {
  return { value, missing: `{{${name}}} is empty: set "${field}" in ${LEGAL_IDENTITY_PATH}.` };
}

function identityResolver(identity: LegalIdentity, language: PageLanguage): Resolver {
  return (name) => {
    const slot = IDENTITY_SLOTS[name];
    if (slot === undefined) return undefined;
    const [field, value] = slot(identity, language);
    return slotResolution(name, field, value);
  };
}

function isListLanguage(language: string): language is ListLanguage {
  return (LIST_LANGUAGES as readonly string[]).includes(language);
}

function providerLists(identity: LegalIdentity): ListResolver {
  return (list, language) => {
    if (list !== 'PROVIDERS' || !isListLanguage(language)) return undefined;
    return identity.providers.map((row, index): Resolver => (name) => {
      const slot = PROVIDER_SLOTS[name];
      if (slot === undefined) return undefined;
      const [field, value] = slot(row, language);
      return slotResolution(name, `providers[${index}].${field}`, value);
    });
  };
}

function pageLanguage(page: LegalPage): PageLanguage {
  return page.startsWith('fr/') ? 'fr' : 'en';
}

// ── Reading a rendered page ─────────────────────────────────────────────────────────────────

function withoutRanges(html: string, open: string, close: string): string {
  let out = '';
  let at = 0;
  for (let start = html.indexOf(open, at); start !== -1; start = html.indexOf(open, at)) {
    out += html.slice(at, start);
    const end = html.indexOf(close, start);
    if (end === -1) return out;
    at = end + close.length;
  }
  return out + html.slice(at);
}

/** A page's reading text: comments, `<style>` and tags removed (each tag read as a space), the
 *  entities the renderer writes decoded, whitespace collapsed. */
export function pageText(html: string): string {
  const visible = withoutRanges(withoutRanges(html, '<!--', '-->'), '<style', '</style>');
  let out = '';
  let inTag = false;
  for (const ch of visible) {
    if (ch === '<') {
      inTag = true;
      out += ' ';
    } else if (ch === '>') {
      inTag = false;
    } else if (!inTag) {
      out += ch;
    }
  }
  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Category id → the reading text of every element whose `attribute` lists it (space-separated).
 *  The legal pages put these attributes only on `<tr>`, `<p>` and `<li>`, which never nest. */
function elementsListing(html: string, attribute: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  const needle = ` ${attribute}="`;
  for (let at = html.indexOf(needle); at !== -1; at = html.indexOf(needle, at + needle.length)) {
    const tag = /^[a-z0-9]+/i.exec(html.slice(html.lastIndexOf('<', at) + 1))?.[0] ?? '';
    const valueStart = at + needle.length;
    const valueEnd = html.indexOf('"', valueStart);
    const contentStart = html.indexOf('>', valueEnd) + 1;
    const contentEnd = html.indexOf(`</${tag}>`, contentStart);
    const text = pageText(html.slice(contentStart, contentEnd === -1 ? undefined : contentEnd));
    for (const id of html.slice(valueStart, valueEnd).split(' ').filter(Boolean)) found.set(id, [...(found.get(id) ?? []), text]);
  }
  return found;
}

/** Twelve months, as the manifest counts them. A month count that isn't whole years has no exact
 *  day count, so it reads as NaN and never equals a manifest maximum. */
const DAYS_PER_12_MONTHS = 365;
const PERIOD_UNITS: ReadonlySet<string> = new Set(['day', 'days', 'month', 'months', 'jour', 'jours', 'mois']);

function periodDays(count: string, unit: string): number {
  const n = Number(count);
  if (unit !== 'month' && unit !== 'months' && unit !== 'mois') return n;
  return n % 12 === 0 ? (n / 12) * DAYS_PER_12_MONTHS : Number.NaN;
}

/** Every "<number> <unit>" in texts from `pageText` (one plain space between words). */
function periodsIn(texts: readonly string[]): number[] {
  const periods: number[] = [];
  for (const text of texts) {
    const words = text.toLowerCase().split(' ');
    words.forEach((word, index) => {
      const unit = (words[index + 1] ?? '').replace(/\W/g, '');
      if (/^\d+$/.test(word) && PERIOD_UNITS.has(unit)) periods.push(periodDays(word, unit));
    });
  }
  return periods;
}

function periodsByCategory(html: string, attribute: string): ReadonlyMap<string, readonly number[]> {
  return new Map([...elementsListing(html, attribute)].map(([id, texts]) => [id, periodsIn(texts)]));
}

/** Category id → every keep-period, in days, that the page's `data-keep` rows state for it (an
 *  empty list: a row that states none). A category with no row is absent. */
export function statedKeepPeriods(html: string): ReadonlyMap<string, readonly number[]> {
  return periodsByCategory(html, 'data-keep');
}

function describePeriods(periods: readonly number[]): string {
  if (periods.length === 0) return 'no period';
  return periods.map((days) => (Number.isNaN(days) ? 'a month count with no exact day count' : `${days} days`)).join(', ');
}

// ── The checks ──────────────────────────────────────────────────────────────────────────────

function draftMarkerFindings(page: LegalPage, html: string): string[] {
  const markers = new Set<string>();
  for (let at = html.indexOf('['); at !== -1; at = html.indexOf('[', at + 1)) {
    if (!/[A-Za-z]/.test(html.charAt(at + 1))) continue;
    const close = html.indexOf(']', at);
    markers.add(close === -1 || close - at > 60 ? `${html.slice(at, at + 40)}…` : html.slice(at, close + 1));
  }
  return [...markers].map((marker) => `${page}: the draft marker or placeholder ${marker} is still on the page.`);
}

/** Every category has a row in "What leaves your phone" and in "How long we keep it", the latter
 *  stating exactly the published maximum; a category kept only inside others, or not kept, states
 *  no period longer than that. */
function currentKeepFindings(page: LegalPage, html: string, manifest: DisclosureManifest, version: number): string[] {
  const findings: string[] = [];
  const dataRows = elementsListing(html, 'data-category');
  const kept = statedKeepPeriods(html);
  for (const category of manifest.categories) {
    const { id } = category;
    if (!dataRows.has(id)) findings.push(`${page}: manifest category ${id} has no row in "What leaves your phone" (data-category="${id}").`);
    const periods = kept.get(id);
    if (periods === undefined) {
      findings.push(`${page}: manifest category ${id} has no row in "How long we keep it" (data-keep="${id}").`);
      continue;
    }
    const cap = keepLimit(manifest, id)?.days ?? 0;
    const exact = category.keep.kind === 'max-days';
    const wrong = exact ? periods.length === 0 || periods.some((days) => days !== cap) : periods.some((days) => Number.isNaN(days) || days > cap);
    if (wrong) {
      const rules = { 'max-days': `is kept at most ${cap} days`, with: `is kept only inside other records, at most ${cap} days`, 'not-kept': 'is not kept' };
      findings.push(
        `${page}: ${id} ${rules[category.keep.kind]} (manifest version ${version}), but its "How long we keep it" row states ${describePeriods(periods)}.`,
      );
    }
  }
  return findings;
}

/** A category whose maximum grew since an older version keeps that version's rule for the records
 *  made under it, and the page's `data-keep-v<N>` note must say so. */
function olderRuleFindings(page: LegalPage, html: string, manifest: DisclosureManifest, older: DisclosureManifest, olderVersion: number): string[] {
  const findings: string[] = [];
  const stated = periodsByCategory(html, `data-keep-v${olderVersion}`);
  for (const category of manifest.categories) {
    const before = older.categories.find((c) => c.id === category.id)?.keep;
    if (category.keep.kind !== 'max-days' || before?.kind !== 'max-days' || before.days >= category.keep.days) continue;
    const periods = stated.get(category.id) ?? [];
    if (periods.length === 0 || periods.some((days) => days !== before.days)) {
      findings.push(
        `${page}: ${category.id} records made under version ${olderVersion} keep its ${before.days}-day rule, but the page's data-keep-v${olderVersion} note states ${describePeriods(periods)}.`,
      );
    }
  }
  return findings;
}

/** The policy against the current manifest (spec legal-pages "The policy matches the manifest"). */
function policyManifestFindings(page: LegalPage, html: string, manifests: Readonly<Record<number, DisclosureManifest>>): string[] {
  const version = latestVersion(manifests);
  const manifest = manifests[version];
  if (manifest === undefined) return [`${page}: there is no disclosure manifest to check the policy against.`];
  const findings = currentKeepFindings(page, html, manifest, version);
  for (const [key, older] of Object.entries(manifests)) {
    if (Number(key) < version) findings.push(...olderRuleFindings(page, html, manifest, older, Number(key)));
  }
  return findings;
}

interface LegalSiteInput {
  /** Each legal page's source, as checked in under `deploy/site/`. */
  readonly sources: Readonly<Record<LegalPage, string>>;
  /** The parsed identity file. */
  readonly identity: unknown;
  /** Defaults to `MANIFESTS`. */
  readonly manifests?: Readonly<Record<number, DisclosureManifest>>;
}

interface LegalSiteResult {
  readonly pages: Readonly<Record<LegalPage, string>>;
  /** `[]` = every legal page may be published. Each finding names its page or the identity file. */
  readonly findings: readonly string[];
}

/** Renders every legal page from the identity file and runs the deploy check over the result. */
export function renderLegalSite(input: LegalSiteInput): LegalSiteResult {
  const { identity, findings } = readLegalIdentity(input.identity);
  const lists = providerLists(identity);
  const pages = {} as Record<LegalPage, string>;
  for (const page of LEGAL_PAGES) {
    const problems: RenderPageError[] = [];
    const html = renderTemplate(input.sources[page], identityResolver(identity, pageLanguage(page)), problems, lists);
    pages[page] = html;
    findings.push(...new Set(problems.map((problem) => `${page}: ${problem.message}`)));
    findings.push(...draftMarkerFindings(page, html));
    if (page.endsWith('privacy.html')) findings.push(...policyManifestFindings(page, html, input.manifests ?? MANIFESTS));
  }
  return { pages, findings };
}
