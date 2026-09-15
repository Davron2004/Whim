/**
 * Validates `release/store/` (design D11; specs/store-listing/spec.md, all requirements):
 * required files and their per-store length limits, no committed URL files or domain/`whim.`
 * literals, no exclamation marks or promotional terms, committed screenshot sizes and ratios, a
 * 13+ age rating override, and privacy consistency across `app-privacy.json`, `data-safety.json`
 * and the iOS privacy manifest through D11's mapping. Pure file reads plus the `parseXmlPlist`
 * reader from `./ios-project` — no shelling out, safe to run in the Linux devcontainer gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Buffer as NodeBuffer } from 'buffer';
import type { NativeReleaseConfig } from './native-config';
import { parseXmlPlist, type PlistValue } from './ios-project';

// `existsSync`/`readdirSync`/`Dirent` are already declared for 'node:fs' by
// `synthrun/env.d.ts` (ambient module augmentations merge additively across the program —
// `scripts/release/env.d.ts`'s own header note); redeclaring them here would conflict on
// modifiers rather than add anything.

export interface StoreListingFinding {
  /** Repo-relative path (or comma-joined paths, for a cross-file disagreement). */
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

// ── Privacy consistency (app-privacy.json, data-safety.json, PrivacyInfo.xcprivacy) ────────

interface PrivacyTypeMapping {
  readonly appPrivacyCategory: string;
  readonly manifestType: string;
  readonly dataSafetyId: string;
  readonly label: string;
}

/** design D11's mapping: the two data types Whim's privacy answers ever name. */
export const PRIVACY_TYPE_MAPPING: readonly PrivacyTypeMapping[] = [
  {
    appPrivacyCategory: 'OTHER_USER_CONTENT',
    manifestType: 'NSPrivacyCollectedDataTypeOtherUserContent',
    dataSafetyId: 'other_user_generated_content',
    label: 'user content',
  },
  {
    appPrivacyCategory: 'DEVICE_ID',
    manifestType: 'NSPrivacyCollectedDataTypeDeviceID',
    dataSafetyId: 'device_or_other_ids',
    label: 'device ID',
  },
];

function isPlistDict(v: PlistValue | undefined): v is { [key: string]: PlistValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface AppPrivacyEntry {
  readonly category?: unknown;
  readonly data_protections?: unknown;
}

function readAppPrivacyEntries(repoRoot: string): AppPrivacyEntry[] {
  const text = readText(repoRoot, APP_PRIVACY_PATH);
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as AppPrivacyEntry[]) : [];
}

interface DataSafetyEntry {
  readonly id?: unknown;
  readonly collected?: unknown;
}

function readDataSafetyEntries(repoRoot: string): DataSafetyEntry[] {
  const text = readText(repoRoot, DATA_SAFETY_PATH);
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  const types = typeof parsed === 'object' && parsed !== null ? (parsed as { types?: unknown }).types : undefined;
  return Array.isArray(types) ? (types as DataSafetyEntry[]) : [];
}

function manifestCollectedTypeNames(repoRoot: string): Set<string> {
  const text = readText(repoRoot, PRIVACY_MANIFEST_PATH);
  const result = new Set<string>();
  if (text === undefined) return result;
  const plist = parseXmlPlist(text);
  const types = isPlistDict(plist) ? plist.NSPrivacyCollectedDataTypes : undefined;
  if (!Array.isArray(types)) return result;
  for (const entry of types) {
    if (isPlistDict(entry) && typeof entry.NSPrivacyCollectedDataType === 'string') result.add(entry.NSPrivacyCollectedDataType);
  }
  return result;
}

function checkTypeAgreement(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  const appPrivacyCategories = new Set(readAppPrivacyEntries(repoRoot).map((e) => e.category).filter((c): c is string => typeof c === 'string'));
  const dataSafetyIds = new Set(
    readDataSafetyEntries(repoRoot)
      .filter((e) => e.collected === true)
      .map((e) => e.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const manifestTypes = manifestCollectedTypeNames(repoRoot);
  const namedFiles = `${APP_PRIVACY_PATH}, ${DATA_SAFETY_PATH}, ${PRIVACY_MANIFEST_PATH}`;

  for (const mapping of PRIVACY_TYPE_MAPPING) {
    const inAppPrivacy = appPrivacyCategories.has(mapping.appPrivacyCategory);
    const inDataSafety = dataSafetyIds.has(mapping.dataSafetyId);
    const inManifest = manifestTypes.has(mapping.manifestType);
    if (inAppPrivacy === inDataSafety && inDataSafety === inManifest) continue;
    findings.push({
      file: namedFiles,
      message: `disagree on the ${mapping.label} data type (app-privacy.json:${inAppPrivacy} data-safety.json:${inDataSafety} PrivacyInfo.xcprivacy:${inManifest})`,
    });
  }

  const knownCategories = new Set(PRIVACY_TYPE_MAPPING.map((m) => m.appPrivacyCategory));
  for (const category of appPrivacyCategories) {
    if (!knownCategories.has(category)) {
      findings.push({ file: APP_PRIVACY_PATH, message: `declares an unexpected category "${category}" — data saved inside mini-apps must never be declared collected` });
    }
  }
  return findings;
}

function checkNoLinkageOrTracking(repoRoot: string): StoreListingFinding[] {
  const findings: StoreListingFinding[] = [];
  for (const entry of readAppPrivacyEntries(repoRoot)) {
    const protections = entry.data_protections;
    if (Array.isArray(protections) && protections.includes('DATA_LINKED_TO_YOU')) {
      findings.push({ file: APP_PRIVACY_PATH, message: `"${String(entry.category)}" claims DATA_LINKED_TO_YOU; Whim links no data to an identity` });
    }
  }
  return findings;
}

function checkPrivacyConsistency(repoRoot: string): StoreListingFinding[] {
  return [...checkTypeAgreement(repoRoot), ...checkNoLinkageOrTracking(repoRoot)];
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
  ];
}
