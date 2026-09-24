/**
 * Validates `release/store/` (design D11; specs/store-listing/spec.md, all requirements):
 * required files and their per-store length limits, no committed URL files or domain/`whim.`
 * literals, no exclamation marks or promotional terms, committed screenshot sizes and ratios, a
 * 13+ age rating override, and the four privacy declarations (`app-privacy.json`,
 * `data-safety.json`, the iOS privacy manifest, `answers.md`) against the current disclosure
 * manifest's store mapping (legal-surface-v2 design D8), and, once device code carries the
 * diagnostics transport, that every declaration covers crash logs and diagnostics
 * (developer-observability design D11). Pure file reads plus the `parseXmlPlist`
 * reader from `./ios-project` — no shelling out, safe to run in the Linux devcontainer gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Buffer as NodeBuffer } from 'buffer';
import type { NativeReleaseConfig } from './native-config';
import { parseXmlPlist, type PlistValue } from './ios-project';
import { MANIFESTS, latestVersion, type DisclosureManifest } from '../../../contract/src/disclosure-manifest';
import { CONSENT_SCREEN_COVERAGE, LEGAL_COPY } from '../../../src/host/launcher/copy';
import { DIAGNOSTICS_PATH } from '../../../src/host/logging/diagnostics';

// `existsSync`/`readdirSync`/`Dirent` are already declared for 'node:fs' by
// `synthrun/env.d.ts` (ambient module augmentations merge additively across the program —
// `scripts/release/env.d.ts`'s own header note); redeclaring them here would conflict on
// modifiers rather than add anything.

export interface StoreListingFinding {
  /** Repo-relative path. */
  readonly file: string;
  readonly message: string;
}

// ── Field limits (specs/store-listing "Listing text lives as files within each store's limits") ──

export type ListingLimitUnit = 'characters' | 'bytes';

export interface ListingFieldLimit {
  readonly file: string;
  readonly limit: number;
  readonly unit: ListingLimitUnit;
}

export const LISTING_LIMITS: readonly ListingFieldLimit[] = [
  { file: 'release/store/app-store/en-US/name.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/app-store/en-US/subtitle.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/app-store/en-US/promotional_text.txt', limit: 170, unit: 'characters' },
  { file: 'release/store/app-store/en-US/description.txt', limit: 4000, unit: 'characters' },
  { file: 'release/store/app-store/en-US/keywords.txt', limit: 100, unit: 'bytes' },
  { file: 'release/store/play/en-US/title.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/play/en-US/short_description.txt', limit: 80, unit: 'characters' },
  { file: 'release/store/play/en-US/full_description.txt', limit: 4000, unit: 'characters' },
  { file: 'release/store/play/en-US/changelogs/default.txt', limit: 500, unit: 'characters' },
  // App Store Connect's "Notes for Review" field (platform-release-readiness task 12.2).
  { file: 'release/store/app-store/review_information/notes.txt', limit: 4000, unit: 'characters' },
];

/** Required files that carry no length limit of their own. */
export const REQUIRED_LISTING_FILES: readonly string[] = [
  'release/store/app-store/copyright.txt',
  'release/store/app-store/primary_category.txt',
  'release/store/app-store/secondary_category.txt',
  'release/store/app-store/app-privacy.json',
  'release/store/app-store/age-rating.json',
  'release/store/play/data-safety.json',
  'release/store/answers.md',
];

export const PROMO_TERMS: readonly string[] = [
  'amazing',
  'awesome',
  'best-in-class',
  'breakthrough',
  'cutting-edge',
  'effortless',
  'game-changing',
  'incredible',
  'magical',
  'powerful',
  'revolutionary',
  'seamless',
  'stunning',
  'ultimate',
  'unleash',
  'world-class',
];

const LISTING_ROOT = 'release/store';
const APP_STORE_SCREENSHOTS_DIR = 'release/store/app-store/screenshots';
const PLAY_PHONE_SCREENSHOTS_DIR = 'release/store/play/en-US/images/phoneScreenshots';
const APP_STORE_AGE_RATING_PATH = 'release/store/app-store/age-rating.json';
const APP_PRIVACY_PATH = 'release/store/app-store/app-privacy.json';
const DATA_SAFETY_PATH = 'release/store/play/data-safety.json';
const PRIVACY_MANIFEST_PATH = 'ios/Whim/PrivacyInfo.xcprivacy';
const ANSWERS_PATH = 'release/store/answers.md';

function readText(repoRoot: string, relPath: string): string | undefined {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    // eslint-disable-next-line no-restricted-syntax -- intentional: a missing listing file is reported as its own "missing" finding by the caller, not a thrown error
  } catch {
    return undefined;
  }
}

function measure(text: string, unit: ListingLimitUnit): number {
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return unit === 'bytes' ? new TextEncoder().encode(trimmed).length : trimmed.length;
}

// ── Required files and length limits ────────────────────────────────────────────────────────

function checkRequiredAndLimits(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const { file, limit, unit } of LISTING_LIMITS) {
    const text = readText(repoRoot, file);
    if (text === undefined) {
      findings.push({ file, message: 'missing required file' });
      continue;
    }
    const actual = measure(text, unit);
    if (actual > limit) {
      findings.push({ file, message: `exceeds the ${limit}-${unit === 'bytes' ? 'byte' : 'character'} limit, length ${actual}` });
    }
  }
  for (const file of REQUIRED_LISTING_FILES) {
    if (readText(repoRoot, file) === undefined) findings.push({ file, message: 'missing required file' });
  }
  return findings;
}

// ── No URL files, no domain or "whim." literals ─────────────────────────────────────────────

function walkFiles(repoRoot: string, dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(repoRoot, rel));
    else out.push(rel);
  }
  return out;
}

const WHIM_DOMAIN_LITERAL_PATTERN = /whim\.[a-z0-9]/i;

function checkNoUrlFilesOrDomainLiterals(repoRoot: string, config: NativeReleaseConfig): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const file of walkFiles(repoRoot, LISTING_ROOT)) {
    if (/url/i.test(path.basename(file))) {
      findings.push({ file, message: 'listing layouts commit no URL files — URLs are supplied at upload from WHIM_DOMAIN' });
    }
    if (!file.endsWith('.txt') && !file.endsWith('.json') && !file.endsWith('.md')) continue;
    const text = readText(repoRoot, file);
    if (text === undefined) continue;
    if (config.WHIM_DOMAIN.length > 0 && text.includes(config.WHIM_DOMAIN)) {
      findings.push({ file, message: `contains the release domain "${config.WHIM_DOMAIN}" — domains are supplied at upload, never committed` });
    }
    if (WHIM_DOMAIN_LITERAL_PATTERN.test(text)) {
      findings.push({ file, message: 'contains a "whim." URL literal — domains are supplied at upload, never committed' });
    }
  }
  return findings;
}

// ── Listing copy is plain ────────────────────────────────────────────────────────────────────

function checkPlainCopy(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const file of walkFiles(repoRoot, LISTING_ROOT)) {
    if (!file.endsWith('.txt') && !file.endsWith('.md')) continue;
    const text = readText(repoRoot, file);
    if (text === undefined) continue;
    if (text.includes('!')) findings.push({ file, message: 'contains an exclamation mark' });
    for (const term of PROMO_TERMS) {
      if (new RegExp(`\\b${term}\\b`, 'i').test(text)) {
        findings.push({ file, message: `contains the promotional term "${term}"` });
      }
    }
  }
  return findings;
}

// ── Committed screenshot sizes and ratios ───────────────────────────────────────────────────

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function readPngDimensions(buf: NodeBuffer): ImageDimensions | undefined {
  const isPng = buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Scans a JPEG's markers for the first start-of-frame segment, which carries its pixel size. */
function readJpegDimensions(buf: NodeBuffer): ImageDimensions | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 <= buf.length && buf[offset] === 0xff) {
    const marker = buf[offset + 1];
    const isStandalone = marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    if (isStandalone) {
      offset += 2;
      continue;
    }
    const isSofMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSofMarker) return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return undefined;
}

function readImageDimensions(repoRoot: string, relPath: string): ImageDimensions | undefined {
  const buf = fs.readFileSync(path.join(repoRoot, relPath));
  return readPngDimensions(buf) ?? readJpegDimensions(buf);
}

function isImageFile(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

const APP_STORE_SCREENSHOT_SIZES: readonly ImageDimensions[] = [
  { width: 1260, height: 2736 },
  { width: 1290, height: 2796 },
  { width: 1320, height: 2868 },
];

function checkAppStoreScreenshots(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const file of walkFiles(repoRoot, APP_STORE_SCREENSHOTS_DIR).filter(isImageFile)) {
    const dims = readImageDimensions(repoRoot, file);
    if (!dims) {
      findings.push({ file, message: 'not a readable PNG or JPEG image' });
      continue;
    }
    const matches = APP_STORE_SCREENSHOT_SIZES.some((s) => s.width === dims.width && s.height === dims.height);
    if (!matches) {
      findings.push({ file, message: `must be portrait 1260x2736, 1290x2796 or 1320x2868, got ${dims.width}x${dims.height}` });
    }
  }
  return findings;
}

function checkPlayScreenshots(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const file of walkFiles(repoRoot, PLAY_PHONE_SCREENSHOTS_DIR).filter(isImageFile)) {
    const dims = readImageDimensions(repoRoot, file);
    if (!dims) {
      findings.push({ file, message: 'not a readable PNG or JPEG image' });
      continue;
    }
    const { width, height } = dims;
    if (width < 320 || width > 3840 || height < 320 || height > 3840) {
      findings.push({ file, message: `each side must measure between 320 and 3840 pixels, got ${width}x${height}` });
      continue;
    }
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > 2) {
      findings.push({ file, message: `long side must be at most twice the short side, got ${width}x${height} (${ratio.toFixed(2)} aspect ratio)` });
    }
  }
  return findings;
}

// ── Age rating ───────────────────────────────────────────────────────────────────────────────

function checkAgeRating(repoRoot: string): StoreListingFinding[] {
  const text = readText(repoRoot, APP_STORE_AGE_RATING_PATH);
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  const override = typeof parsed === 'object' && parsed !== null ? (parsed as { ageRatingOverrideV2?: unknown }).ageRatingOverrideV2 : undefined;
  if (override !== 'THIRTEEN_PLUS') {
    return [{ file: APP_STORE_AGE_RATING_PATH, message: `"ageRatingOverrideV2" must be "THIRTEEN_PLUS" to produce a 13+ rating, got ${JSON.stringify(override)}` }];
  }
  return [];
}

// ── Privacy declarations follow the disclosure manifest's store mapping ─────────────────────
//
// legal-surface-v2 design D8; spec store-privacy-declarations. Each of the four declarations
// (app-privacy.json, PrivacyInfo.xcprivacy, data-safety.json, answers.md's two console tables) is
// read into `Declaration`s in its own vocabulary and compared with the current manifest's mapping
// spelled in that same vocabulary, so a finding names the file and the type as the file spells it.

/** One declared store type. `flags` holds `linked` (Apple) or `optional` and `shared` (Play);
 *  `undefined` when the file doesn't say, which never matches the mapping. */
interface Declaration {
  readonly type: string;
  readonly flags: Readonly<Record<string, boolean | undefined>>;
  readonly purposes: readonly string[];
}

/** A store type the mapping gives, with the manifest categories it comes from. */
interface ExpectedDeclaration extends Declaration {
  readonly categories: readonly string[];
}

/** One store type as the mapping gives it, in the mapping's own tokens. */
interface MappedType {
  readonly type: string;
  /** Apple only: the privacy-manifest data types the categories give (one, when well formed). */
  readonly manifestTypes: ReadonlySet<string>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly purposes: ReadonlySet<string>;
  readonly categories: readonly string[];
}

interface MappedStoreTypes {
  readonly apple: readonly MappedType[];
  readonly play: readonly MappedType[];
}

/** How several categories' flags for one store type combine: linked or shared if any category's
 *  is, optional only if every category's is (so required if any is). */
const FLAG_UNION: Readonly<Record<string, (a: boolean, b: boolean) => boolean>> = {
  linked: (a, b) => a || b,
  shared: (a, b) => a || b,
  optional: (a, b) => a && b,
};

function mergeMapped(into: Map<string, MappedType>, category: string, next: Omit<MappedType, 'categories'>): void {
  const had = into.get(next.type);
  into.set(next.type, {
    type: next.type,
    manifestTypes: new Set([...(had?.manifestTypes ?? []), ...next.manifestTypes]),
    flags: had === undefined ? next.flags : Object.fromEntries(Object.entries(next.flags).map(([flag, value]) => [flag, FLAG_UNION[flag](had.flags[flag], value)])),
    purposes: new Set([...(had?.purposes ?? []), ...next.purposes]),
    categories: [...(had?.categories ?? []), category],
  });
}

/** Each store type's declaration is the union over the categories that map to it (`FLAG_UNION`,
 *  and every purpose any of them lists). */
function mappedStoreTypes(manifest: DisclosureManifest): MappedStoreTypes {
  const apple = new Map<string, MappedType>();
  const play = new Map<string, MappedType>();
  for (const category of manifest.categories) {
    for (const t of category.store.apple) {
      mergeMapped(apple, category.id, { type: t.type, manifestTypes: new Set([t.manifestType]), flags: { linked: t.linked }, purposes: new Set(t.purposes) });
    }
    for (const t of category.store.play) {
      mergeMapped(play, category.id, { type: t.type, manifestTypes: new Set(), flags: { optional: t.optional, shared: t.shared }, purposes: new Set(t.purposes) });
    }
  }
  return { apple: [...apple.values()], play: [...play.values()] };
}

/** How one file spells the mapping's tokens; `fix` says what to change when one has no spelling. */
interface Vocabulary {
  readonly type: (t: MappedType) => string | undefined;
  readonly purpose: (token: string) => string | undefined;
  readonly fix?: string;
}

const MAPPING_TOKENS: Vocabulary = { type: (t) => t.type, purpose: (token) => token };

/** `PrivacyInfo.xcprivacy` spellings of the `app-privacy.json` purpose tokens the mapping uses. */
const PRIVACY_MANIFEST_PURPOSES: Readonly<Record<string, string>> = {
  APP_FUNCTIONALITY: 'NSPrivacyCollectedDataTypePurposeAppFunctionality',
  ANALYTICS: 'NSPrivacyCollectedDataTypePurposeAnalytics',
};

const PRIVACY_MANIFEST_VOCABULARY: Vocabulary = {
  type: (t) => (t.manifestTypes.size === 1 ? [...t.manifestTypes][0] : undefined),
  purpose: (token) => PRIVACY_MANIFEST_PURPOSES[token],
  fix: 'a purpose needs an entry in PRIVACY_MANIFEST_PURPOSES (scripts/release/lib/store-listing.ts), and every category must give one Apple type the same manifestType',
};

/** The console labels `answers.md` uses for the mapping's tokens (Apple tokens are upper case,
 *  Play tokens lower case, so one table serves both stores). */
const CONSOLE_LABELS: Readonly<Record<string, string>> = {
  OTHER_USER_CONTENT: 'Other User Content',
  DEVICE_ID: 'Device ID',
  PRODUCT_INTERACTION: 'Product Interaction',
  CRASH_DATA: 'Crash Data',
  OTHER_DIAGNOSTIC_DATA: 'Other Diagnostic Data',
  APP_FUNCTIONALITY: 'App Functionality',
  ANALYTICS: 'Analytics',
  other_user_generated_content: 'Other user-generated content',
  device_or_other_ids: 'Device or other IDs',
  app_interactions: 'App interactions',
  crash_logs: 'Crash logs',
  diagnostics: 'Diagnostics',
  app_functionality: 'App functionality',
  analytics: 'Analytics',
  fraud_prevention_security_compliance: 'Fraud prevention, security and compliance',
};

const CONSOLE_VOCABULARY: Vocabulary = {
  type: (t) => CONSOLE_LABELS[t.type],
  purpose: (token) => CONSOLE_LABELS[token],
  fix: 'add its console label to CONSOLE_LABELS (scripts/release/lib/store-listing.ts)',
};

/** The mapping spelled in `vocabulary`; an unspellable token is itself a finding and stays as the token. */
function expectedDeclarations(file: string, types: readonly MappedType[], vocabulary: Vocabulary): { expected: ExpectedDeclaration[]; findings: StoreListingFinding[] } {
  const findings: StoreListingFinding[] = [];
  const hint = vocabulary.fix === undefined ? '' : `; ${vocabulary.fix}`;
  const spell = (token: string, word: string | undefined): string => {
    if (word === undefined) findings.push({ file, message: `has no spelling for the store mapping's "${token}"${hint}` });
    return word ?? token;
  };
  const expected = types.map((t): ExpectedDeclaration => ({
    type: spell(t.type, vocabulary.type(t)),
    flags: t.flags,
    purposes: [...t.purposes].map((p) => spell(p, vocabulary.purpose(p))),
    categories: t.categories,
  }));
  return { expected, findings };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

/** Every way `declared` (one file) differs from the mapping spelled in that file's vocabulary. */
function compareDeclarations(file: string, declared: readonly Declaration[], expected: readonly ExpectedDeclaration[]): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  const declaredTypes = declared.map((d) => d.type);
  for (const type of declaredTypes.filter((t, index) => declaredTypes.indexOf(t) !== index)) {
    findings.push({ file, message: `declares "${type}" twice` });
  }
  for (const want of expected) {
    const from = `the store mapping gives it for ${want.categories.join(', ')}`;
    const got = declared.find((d) => d.type === want.type);
    if (got === undefined) {
      findings.push({ file, message: `does not declare "${want.type}"; ${from}` });
      continue;
    }
    for (const [flag, value] of Object.entries(want.flags)) {
      if (got.flags[flag] !== value) {
        findings.push({ file, message: `declares "${want.type}" with ${flag}=${String(got.flags[flag])}; ${from} with ${flag}=${String(value)}` });
      }
    }
    if (!sameSet(got.purposes, want.purposes)) {
      findings.push({ file, message: `declares "${want.type}" for ${JSON.stringify(got.purposes)}; ${from} for ${JSON.stringify(want.purposes)}` });
    }
  }
  const known = new Set(expected.map((e) => e.type));
  for (const type of declaredTypes.filter((t) => !known.has(t))) {
    findings.push({ file, message: `declares "${type}", which the store mapping doesn't give — data saved inside mini-apps must never be declared collected` });
  }
  return findings;
}

// ── Reading the four declarations ───────────────────────────────────────────────────────────

/** One file's (or one `answers.md` table's) declarations, read in its own vocabulary. */
interface DeclarationSource {
  readonly file: string;
  readonly store: keyof MappedStoreTypes;
  readonly vocabulary: Vocabulary;
  readonly declarations: readonly Declaration[];
  /** Declared type → whether the file marks it as used for tracking; `undefined` when a file
   *  that must answer doesn't. Empty for Play, whose form has no tracking answer (an advertising
   *  purpose is refused as a purpose the mapping doesn't give). */
  readonly tracking: ReadonlyMap<string, boolean | undefined>;
  /** Problems reading the file's shape (a missing table or column). */
  readonly findings: readonly StoreListingFinding[];
}

function isPlistDict(v: PlistValue | undefined): v is { [key: string]: PlistValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// Each reader returns `undefined` for a missing file, already its own "missing required file" finding.

function readAppPrivacy(repoRoot: string): DeclarationSource | undefined {
  const text = readText(repoRoot, APP_PRIVACY_PATH);
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text);
  const entries = Array.isArray(parsed) ? (parsed as { category?: unknown; purposes?: unknown; data_protections?: unknown }[]) : [];
  const declarations: Declaration[] = [];
  const tracking = new Map<string, boolean | undefined>();
  for (const entry of entries) {
    if (typeof entry.category !== 'string') continue;
    const protections = stringsOf(entry.data_protections);
    const linked = protections.includes('DATA_LINKED_TO_YOU');
    const saysOne = linked !== protections.includes('DATA_NOT_LINKED_TO_YOU');
    declarations.push({ type: entry.category, flags: { linked: saysOne ? linked : undefined }, purposes: stringsOf(entry.purposes) });
    tracking.set(entry.category, protections.includes('DATA_USED_TO_TRACK_YOU'));
  }
  return { file: APP_PRIVACY_PATH, store: 'apple', vocabulary: MAPPING_TOKENS, declarations, tracking, findings: [] };
}

function readPrivacyManifest(repoRoot: string): DeclarationSource | undefined {
  const text = readText(repoRoot, PRIVACY_MANIFEST_PATH);
  if (text === undefined) return undefined;
  const plist = parseXmlPlist(text);
  const types = isPlistDict(plist) ? plist.NSPrivacyCollectedDataTypes : undefined;
  const declarations: Declaration[] = [];
  const tracking = new Map<string, boolean | undefined>();
  for (const entry of Array.isArray(types) ? types : []) {
    if (!isPlistDict(entry) || typeof entry.NSPrivacyCollectedDataType !== 'string') continue;
    const type = entry.NSPrivacyCollectedDataType;
    declarations.push({ type, flags: { linked: booleanOrUndefined(entry.NSPrivacyCollectedDataTypeLinked) }, purposes: stringsOf(entry.NSPrivacyCollectedDataTypePurposes) });
    tracking.set(type, booleanOrUndefined(entry.NSPrivacyCollectedDataTypeTracking));
  }
  return { file: PRIVACY_MANIFEST_PATH, store: 'apple', vocabulary: PRIVACY_MANIFEST_VOCABULARY, declarations, tracking, findings: [] };
}

function readDataSafety(repoRoot: string): DeclarationSource | undefined {
  const text = readText(repoRoot, DATA_SAFETY_PATH);
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text);
  const types = typeof parsed === 'object' && parsed !== null ? (parsed as { types?: unknown }).types : undefined;
  const entries = Array.isArray(types) ? (types as { id?: unknown; collected?: unknown; optional?: unknown; shared?: unknown; purposes?: unknown }[]) : [];
  const declarations = entries.flatMap((e): Declaration[] =>
    e.collected === true && typeof e.id === 'string'
      ? [{ type: e.id, flags: { optional: booleanOrUndefined(e.optional), shared: booleanOrUndefined(e.shared) }, purposes: stringsOf(e.purposes) }]
      : [],
  );
  return { file: DATA_SAFETY_PATH, store: 'play', vocabulary: MAPPING_TOKENS, declarations, tracking: new Map(), findings: [] };
}

interface MarkdownTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** The markdown tables in `text`: a header row, a `|---|` rule, then body rows. */
function markdownTables(text: string): MarkdownTable[] {
  const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const isRow = (line: string | undefined): boolean => line?.trim().startsWith('|') ?? false;
  const isRule = (line: string | undefined): boolean => line !== undefined && /^\s*\|[\s|:-]+\|\s*$/.test(line);
  const lines = text.split('\n');
  const tables: MarkdownTable[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isRow(lines[i]) || !isRule(lines[i + 1])) {
      i++;
      continue;
    }
    let end = i + 2;
    while (isRow(lines[end])) end++;
    tables.push({ header: cells(lines[i]), rows: lines.slice(i + 2, end).map(cells) });
    i = end;
  }
  return tables;
}

/** A type cell without its trailing parenthetical note: "Crash logs (error details)" → "Crash logs". */
function withoutNote(cell: string): string {
  const open = cell.indexOf(' (');
  return open !== -1 && cell.endsWith(')') ? cell.slice(0, open) : cell;
}

const YES_NO: Readonly<Record<string, boolean>> = { Yes: true, No: false };
const REQUIRED_OPTIONAL: Readonly<Record<string, boolean>> = { Required: false, Optional: true };

/** One `answers.md` console table, found by its type column and read by column name. Every row
 *  is a declaration, so a `collectedColumn` must say Yes on each. */
interface AnswersTable {
  readonly name: string;
  readonly store: keyof MappedStoreTypes;
  readonly typeColumn: string;
  readonly flagColumns: Readonly<Record<string, { readonly column: string; readonly values: Readonly<Record<string, boolean>> }>>;
  readonly purposeColumn: string;
  readonly trackingColumn?: string;
  readonly collectedColumn?: string;
}

const ANSWERS_TABLES: readonly AnswersTable[] = [
  {
    name: 'App Store App Privacy',
    store: 'apple',
    typeColumn: 'Apple data type',
    flagColumns: { linked: { column: 'Linked to you', values: YES_NO } },
    purposeColumn: 'Purpose',
    trackingColumn: 'Used to track you',
  },
  {
    name: 'Google Play Data safety',
    store: 'play',
    typeColumn: 'Data type (Play name)',
    flagColumns: { shared: { column: 'Shared', values: YES_NO }, optional: { column: 'Required or optional', values: REQUIRED_OPTIONAL } },
    purposeColumn: 'Purposes',
    collectedColumn: 'Collected',
  },
];

/** Reads one console table. A type cell may end in a parenthetical note, e.g. "Device or other
 *  IDs (the random phone ID)"; purposes are separated by semicolons. */
function readAnswersTable(text: string, spec: AnswersTable): DeclarationSource {
  const source = { file: ANSWERS_PATH, store: spec.store, vocabulary: CONSOLE_VOCABULARY };
  const table = markdownTables(text).find((t) => t.header.includes(spec.typeColumn));
  if (table === undefined) {
    return { ...source, declarations: [], tracking: new Map(), findings: [{ file: ANSWERS_PATH, message: `has no ${spec.name} table (one with a "${spec.typeColumn}" column)` }] };
  }
  const optionalColumns = [spec.trackingColumn, spec.collectedColumn].filter((c): c is string => c !== undefined);
  const columns = [spec.typeColumn, spec.purposeColumn, ...Object.values(spec.flagColumns).map((f) => f.column), ...optionalColumns];
  const missing = columns.filter((c) => !table.header.includes(c));
  if (missing.length > 0) {
    const names = missing.map((c) => JSON.stringify(c)).join(', ');
    return { ...source, declarations: [], tracking: new Map(), findings: [{ file: ANSWERS_PATH, message: `its ${spec.name} table has no ${names} column` }] };
  }
  const at = (row: readonly string[], column: string): string => row[table.header.indexOf(column)] ?? '';
  const declarations: Declaration[] = [];
  const tracking = new Map<string, boolean | undefined>();
  const findings: StoreListingFinding[] = [];
  for (const row of table.rows) {
    const type = withoutNote(at(row, spec.typeColumn));
    const flags = Object.fromEntries(Object.entries(spec.flagColumns).map(([flag, { column, values }]) => [flag, values[at(row, column)]]));
    declarations.push({ type, flags, purposes: at(row, spec.purposeColumn).split(';').map((p) => p.trim()).filter((p) => p !== '') });
    if (spec.trackingColumn !== undefined) tracking.set(type, YES_NO[at(row, spec.trackingColumn)]);
    if (spec.collectedColumn !== undefined && at(row, spec.collectedColumn) !== 'Yes') {
      findings.push({ file: ANSWERS_PATH, message: `its ${spec.name} table lists "${type}" with ${spec.collectedColumn} "${at(row, spec.collectedColumn)}"; list only collected types, marked Yes` });
    }
  }
  return { ...source, declarations, tracking, findings };
}

function readDeclarationSources(repoRoot: string): DeclarationSource[] {
  const answers = readText(repoRoot, ANSWERS_PATH);
  const answerTables = answers === undefined ? [] : ANSWERS_TABLES.map((spec) => readAnswersTable(answers, spec));
  return [readAppPrivacy(repoRoot), readPrivacyManifest(repoRoot), readDataSafety(repoRoot), ...answerTables].filter((s): s is DeclarationSource => s !== undefined);
}

/** Each declaration declares exactly the store types, flags and purposes the mapping gives. */
function checkTypeAgreement(sources: readonly DeclarationSource[], manifest: DisclosureManifest): StoreListingFinding[] {
  const mapped = mappedStoreTypes(manifest);
  return sources.flatMap((source) => {
    const { expected, findings } = expectedDeclarations(source.file, mapped[source.store], source.vocabulary);
    return [...source.findings, ...findings, ...compareDeclarations(source.file, source.declarations, expected)];
  });
}

/** No declaration marks a type as used for tracking, and one that must answer says no. */
function checkNoTracking(sources: readonly DeclarationSource[]): StoreListingFinding[] {
  return sources.flatMap(({ file, tracking }) =>
    [...tracking].flatMap(([type, tracked]): StoreListingFinding[] => {
      if (tracked === true) return [{ file, message: `marks "${type}" as used for tracking; Whim tracks no one` }];
      if (tracked === undefined) return [{ file, message: `doesn't say whether "${type}" is used for tracking; it must say no` }];
      return [];
    }),
  );
}

function checkPrivacyConsistency(repoRoot: string): StoreListingFinding[] {
  const sources = readDeclarationSources(repoRoot);
  return [...checkTypeAgreement(sources, MANIFESTS[latestVersion()]), ...checkNoTracking(sources)];
}

// ── A build that sends diagnostics declares them everywhere ─────────────────────────────────
//
// developer-observability design D11; spec device-diagnostics "What the app sends is disclosed
// wherever it is declared". The checks above compare the declarations with whatever the current
// manifest maps, so a manifest that stopped mapping error details would let every declaration
// drop them together. Once the device can send diagnostics, the manifest, all four store
// declarations, the consent screen and both privacy pages must carry them; together with
// `checkTypeAgreement` that also makes the declarations agree on their flags and purposes.

const DIAGNOSTICS_CATEGORY = 'error-details';
const DISCLOSURE_MANIFEST_PATH = 'contract/src/disclosure-manifest.ts';
const CONSENT_COPY_PATH = 'src/host/launcher/copy.ts';
const PRIVACY_PAGES: readonly string[] = ['deploy/site/privacy.html', 'deploy/site/fr/privacy.html'];


function diagnosticsType(type: string, manifestType?: string): MappedType {
  return { type, manifestTypes: new Set(manifestType === undefined ? [] : [manifestType]), flags: {}, purposes: new Set(), categories: [DIAGNOSTICS_CATEGORY] };
}

/** The store types crash logs and diagnostics are declared as, per store. */
const DIAGNOSTICS_STORE_TYPES: MappedStoreTypes = {
  apple: [diagnosticsType('CRASH_DATA', 'NSPrivacyCollectedDataTypeCrashData'), diagnosticsType('OTHER_DIAGNOSTIC_DATA', 'NSPrivacyCollectedDataTypeOtherDiagnosticData')],
  play: [diagnosticsType('crash_logs'), diagnosticsType('diagnostics')],
};

/** The first device source (`src/`, outside tests and generated output, or `index.js`) that
 *  carries the route the diagnostics transport posts to — its own `DIAGNOSTICS_PATH` constant,
 *  imported, so the marker follows the route if it ever moves — or `undefined` when the build
 *  can't send diagnostics. */
export function diagnosticsTransportFile(repoRoot: string): string | undefined {
  const candidates = [...walkFiles(repoRoot, 'src').filter((f) => /\.(tsx?|js)$/.test(f) && !/\/(test|generated)\//.test(f)), 'index.js'];
  return candidates.find((file) => {
    const text = readText(repoRoot, file);
    return text?.includes(DIAGNOSTICS_PATH) ?? false;
  });
}

/** The error-details category in the manifest: present, on the consent screen, and mapped to every diagnostics store type. */
function manifestDiagnosticsFindings(manifest: DisclosureManifest, because: string): StoreListingFinding[] {
  const category = manifest.categories.find((c) => c.id === DIAGNOSTICS_CATEGORY);
  if (category === undefined) return [{ file: DISCLOSURE_MANIFEST_PATH, message: `the current manifest has no ${DIAGNOSTICS_CATEGORY} category; ${because}` }];
  const findings: StoreListingFinding[] = [];
  if (!category.onScreen) findings.push({ file: DISCLOSURE_MANIFEST_PATH, message: `${DIAGNOSTICS_CATEGORY} is not on the consent screen; ${because}` });
  for (const want of DIAGNOSTICS_STORE_TYPES.apple) {
    if (!category.store.apple.some((t) => t.type === want.type && want.manifestTypes.has(t.manifestType))) {
      findings.push({ file: DISCLOSURE_MANIFEST_PATH, message: `${DIAGNOSTICS_CATEGORY} does not map to Apple "${want.type}" (${[...want.manifestTypes].join('')}); ${because}` });
    }
  }
  for (const want of DIAGNOSTICS_STORE_TYPES.play) {
    if (!category.store.play.some((t) => t.type === want.type)) {
      findings.push({ file: DISCLOSURE_MANIFEST_PATH, message: `${DIAGNOSTICS_CATEGORY} does not map to Play "${want.type}"; ${because}` });
    }
  }
  return findings;
}

/** Each store declaration names every diagnostics type of its store, in its own vocabulary. */
function declarationDiagnosticsFindings(sources: readonly DeclarationSource[], because: string): StoreListingFinding[] {
  return sources.flatMap((source) =>
    DIAGNOSTICS_STORE_TYPES[source.store].flatMap((want): StoreListingFinding[] => {
      const spelled = source.vocabulary.type(want) ?? want.type;
      return source.declarations.some((d) => d.type === spelled) ? [] : [{ file: source.file, message: `does not declare "${spelled}"; ${because}` }];
    }),
  );
}

/** Both privacy pages list error details under what leaves the phone and under how long it's kept. */
function privacyPageDiagnosticsFindings(repoRoot: string, because: string): StoreListingFinding[] {
  const listsCategory = (html: string, attribute: string): boolean =>
    [...html.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, 'g'))].some((m) => m[1].split(/\s+/).includes(DIAGNOSTICS_CATEGORY));
  return PRIVACY_PAGES.flatMap((file): StoreListingFinding[] => {
    const html = readText(repoRoot, file);
    if (html === undefined) return [{ file, message: `is missing; ${because}` }];
    return ['data-category', 'data-keep']
      .filter((attribute) => !listsCategory(html, attribute))
      .map((attribute) => ({ file, message: `has no ${attribute}="${DIAGNOSTICS_CATEGORY}" row; ${because}` }));
  });
}

/** The consent screen's text for error details, per language (`CONSENT_SCREEN_COVERAGE`'s keys in `LEGAL_COPY`). */
function liveConsentText(): Readonly<Record<string, string>> {
  const keys = CONSENT_SCREEN_COVERAGE.categories[DIAGNOSTICS_CATEGORY] ?? [];
  return Object.fromEntries(Object.entries(LEGAL_COPY).map(([language, table]) => [language, keys.map((key) => table[key]).join(' ').trim()]));
}

/** The declarations read as modules rather than files; a suite passes its own. */
export interface DiagnosticsDisclosureModules {
  readonly manifest: DisclosureManifest;
  /** Language → the consent screen's text for error details (empty when the screen names none). */
  readonly consentText: Readonly<Record<string, string>>;
}

/** Empty when the build can't send diagnostics or every declaration carries them. */
export function checkDiagnosticsDisclosure(
  repoRoot: string,
  modules: DiagnosticsDisclosureModules = { manifest: MANIFESTS[latestVersion()], consentText: liveConsentText() },
): StoreListingFinding[] {
  const transport = diagnosticsTransportFile(repoRoot);
  if (transport === undefined) return [];
  const because = `the build sends crash logs and diagnostics (${transport})`;
  const consentFindings = Object.entries(modules.consentText)
    .filter(([, text]) => text === '')
    .map(([language]) => ({ file: CONSENT_COPY_PATH, message: `the ${language} consent screen names no error details; ${because}` }));
  return [
    ...manifestDiagnosticsFindings(modules.manifest, because),
    ...declarationDiagnosticsFindings(readDeclarationSources(repoRoot), because),
    ...consentFindings,
    ...privacyPageDiagnosticsFindings(repoRoot, because),
  ];
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

/** Checks `release/store/` under `repoRoot` against `config` (the parsed native release file). Empty = passes. */
export function checkStoreListing(repoRoot: string, config: NativeReleaseConfig): StoreListingFinding[] {
  return [
    ...checkRequiredAndLimits(repoRoot),
    ...checkNoUrlFilesOrDomainLiterals(repoRoot, config),
    ...checkPlainCopy(repoRoot),
    ...checkAppStoreScreenshots(repoRoot),
    ...checkPlayScreenshots(repoRoot),
    ...checkAgeRating(repoRoot),
    ...checkPrivacyConsistency(repoRoot),
    ...checkDiagnosticsDisclosure(repoRoot),
  ];
}
