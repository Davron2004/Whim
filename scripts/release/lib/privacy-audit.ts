/**
 * Audits an archived `.app` for required-reason API usage before an iOS upload (design D7;
 * specs/store-release-pipeline/spec.md "The iOS lane audits required-reason APIs before
 * upload"). `REQUIRED_REASON_TABLE` is design D7's table as data. `categoriesFor` and
 * `auditFindings` are pure — the only things `checks/test/release/release-cli.suite.ts` calls —
 * everything else here shells to `xcrun nm`/`xcrun otool` and reads the filesystem
 * (chains.md's suite-portability rule: a suite never shells to `xcrun`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseXmlPlist, type PlistValue } from './ios-project';

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}

// ── design D7's table, as data (pure) ───────────────────────────────────────────────────────

export type RequiredReasonCategory = 'FileTimestamp' | 'SystemBootTime' | 'DiskSpace' | 'ActiveKeyboards' | 'UserDefaults';

export interface RequiredReasonRule {
  readonly category: RequiredReasonCategory;
  /** Every symbol or selector design D7 lists for this category, matched against both the
   *  imported-symbol list and the Objective-C selector list — the table doesn't distinguish
   *  which technique would find which name, only that finding any of them means the category. */
  readonly names: readonly string[];
}

export const REQUIRED_REASON_TABLE: readonly RequiredReasonRule[] = [
  {
    category: 'FileTimestamp',
    names: [
      'stat', 'fstat', 'fstatat', 'lstat', 'getattrlist', 'fgetattrlist', 'getattrlistat', 'getattrlistbulk',
      'NSFileCreationDate', 'NSFileModificationDate', 'NSURLCreationDateKey', 'NSURLContentModificationDateKey',
      'creationDate', 'modificationDate', 'fileModificationDate',
    ],
  },
  { category: 'SystemBootTime', names: ['mach_absolute_time', 'systemUptime'] },
  {
    category: 'DiskSpace',
    names: [
      'statfs', 'statvfs', 'fstatfs', 'fstatvfs',
      'NSFileSystemFreeSize', 'NSFileSystemSize', 'NSURLVolumeAvailableCapacityKey',
      'NSURLVolumeAvailableCapacityForImportantUsageKey', 'NSURLVolumeAvailableCapacityForOpportunisticUsageKey',
      'NSURLVolumeTotalCapacityKey',
    ],
  },
  { category: 'ActiveKeyboards', names: ['activeInputModes'] },
  { category: 'UserDefaults', names: ['NSUserDefaults'] },
];

const ACCESSED_API_TYPE_PREFIX = 'NSPrivacyAccessedAPICategory';

/** `"NSPrivacyAccessedAPICategoryDiskSpace"` → `"DiskSpace"`, given it's one of the five known categories. */
function categoryFromAccessedApiType(raw: string): RequiredReasonCategory | undefined {
  if (!raw.startsWith(ACCESSED_API_TYPE_PREFIX)) return undefined;
  const candidate = raw.slice(ACCESSED_API_TYPE_PREFIX.length);
  return REQUIRED_REASON_TABLE.some((rule) => rule.category === candidate) ? (candidate as RequiredReasonCategory) : undefined;
}

/** The declared categories in a parsed `PrivacyInfo.xcprivacy`'s `NSPrivacyAccessedAPITypes` array. */
export function declaredCategoriesFromManifest(accessedApiTypes: readonly string[]): readonly RequiredReasonCategory[] {
  const result: RequiredReasonCategory[] = [];
  for (const raw of accessedApiTypes) {
    const category = categoryFromAccessedApiType(raw);
    if (category !== undefined) result.push(category);
  }
  return result;
}

// ── categoriesFor: pure classification of a binary's imports ───────────────────────────────

export interface RequiredReasonCategoryHit {
  readonly category: RequiredReasonCategory;
  /** The symbol or selector that matched, exactly as given (e.g. the raw `_statfs` mach-o name). */
  readonly referencingName: string;
}

/** Mach-O imports carry a single leading underscore by convention (e.g. `stat` → `_stat`); selectors don't. */
function stripMachOUnderscore(symbol: string): string {
  return symbol.startsWith('_') ? symbol.slice(1) : symbol;
}

/**
 * Classifies a binary's imported symbols (`xcrun nm -u -j`, underscore-prefixed) and
 * Objective-C selectors (`xcrun otool -v -s __TEXT __objc_methname`) against design D7's table.
 * One hit per matching category, naming the first referencing symbol or selector found.
 */
export function categoriesFor(symbols: readonly string[], selectors: readonly string[]): readonly RequiredReasonCategoryHit[] {
  const normalizedSymbols = symbols.map((s): [string, string] => [stripMachOUnderscore(s), s]);
  const named: readonly [string, string][] = [...normalizedSymbols, ...selectors.map((s): [string, string] => [s, s])];

  const hits: RequiredReasonCategoryHit[] = [];
  for (const rule of REQUIRED_REASON_TABLE) {
    const match = named.find(([normalized]) => rule.names.includes(normalized));
    if (match) hits.push({ category: rule.category, referencingName: match[1] });
  }
  return hits;
}

// ── auditFindings: pure, applying D7's main-binary and framework rules ─────────────────────

export const ROOT_MANIFEST_KEY = 'root';

export interface AuditManifest {
  /** `ROOT_MANIFEST_KEY` for the app's own manifest; otherwise the framework's own key (e.g. its directory name). */
  readonly key: string;
  readonly declaredCategories: readonly RequiredReasonCategory[];
}

export interface AuditBinaryFacts {
  /** App-relative path, for the finding message (e.g. `"Whim"` or `"Frameworks/op_sqlite.framework/op_sqlite"`). */
  readonly path: string;
  readonly isMainBinary: boolean;
  /** The `AuditManifest.key` this binary ships its own manifest under; `undefined` if it ships none. */
  readonly manifestKey: string | undefined;
  readonly hits: readonly RequiredReasonCategoryHit[];
}

export interface AuditFinding {
  readonly reason: string;
}

/**
 * The main binary is checked only against the root manifest; a framework is checked against
 * its own manifest OR the root (design D7: "a framework uses one that neither its own manifest
 * nor the root declares").
 */
export function auditFindings(binaries: readonly AuditBinaryFacts[], manifests: readonly AuditManifest[]): readonly AuditFinding[] {
  const byKey = new Map(manifests.map((m) => [m.key, m] as const));
  const rootCategories = new Set(byKey.get(ROOT_MANIFEST_KEY)?.declaredCategories ?? []);

  const findings: AuditFinding[] = [];
  for (const binary of binaries) {
    const ownCategories = new Set(
      binary.manifestKey !== undefined ? (byKey.get(binary.manifestKey)?.declaredCategories ?? []) : [],
    );
    for (const hit of binary.hits) {
      const declared = binary.isMainBinary ? rootCategories.has(hit.category) : ownCategories.has(hit.category) || rootCategories.has(hit.category);
      if (!declared) {
        findings.push({
          reason: `${binary.path} references ${hit.referencingName} (${hit.category}), which no bundled privacy manifest declares`,
        });
      }
    }
  }
  return findings;
}

// ── Impure gathering: Mach-O enumeration + xcrun shell-outs (never called by the suite) ─────

function readManifestCategories(manifestPath: string): readonly RequiredReasonCategory[] {
  if (!fs.existsSync(manifestPath)) return [];
  const plist = parseXmlPlist(fs.readFileSync(manifestPath, 'utf8'));
  const types = typeof plist === 'object' && plist !== null && !Array.isArray(plist) ? plist.NSPrivacyAccessedAPITypes : undefined;
  if (!Array.isArray(types)) return [];
  const raw = types
    .map((entry: PlistValue) => (typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry.NSPrivacyAccessedAPIType : undefined))
    .filter((v): v is string => typeof v === 'string');
  return declaredCategoriesFromManifest(raw);
}

function getUndefinedSymbols(binaryPath: string): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: privacy-audit runs inside the repo's own release toolchain, which always has a trustworthy `xcrun` on PATH (ships with Xcode)
  const out = execFileSync('xcrun', ['nm', '-u', '-j', binaryPath], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith(':'));
}

const HEX_ADDRESS = /^[0-9a-f]+$/;

/** `otool -v`'s per-line shape is a hex address, whitespace, then an optional string — parsed
 *  without an adjacent-unbounded-quantifier regex (both `\s+` and `.+` accept a space, which
 *  sonarjs's `super-linear-regex` rightly flags as backtracking-prone). */
function parseObjcMethNameLine(line: string): string | undefined {
  const trimmed = line.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1 || !HEX_ADDRESS.test(trimmed.slice(0, firstSpace))) return undefined;
  const rest = trimmed.slice(firstSpace).trim();
  return rest.length > 0 ? rest : undefined;
}

function getObjcSelectors(binaryPath: string): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: same toolchain assumption as getUndefinedSymbols above
  const out = execFileSync('xcrun', ['otool', '-v', '-s', '__TEXT', '__objc_methname', binaryPath], { encoding: 'utf8' });
  const selectors: string[] = [];
  for (const line of out.split('\n')) {
    const name = parseObjcMethNameLine(line);
    if (name) selectors.push(name);
  }
  return selectors;
}

function binaryFacts(appPath: string, binaryPath: string, isMainBinary: boolean, manifestKey: string | undefined): AuditBinaryFacts {
  return {
    path: path.relative(appPath, binaryPath),
    isMainBinary,
    manifestKey,
    hits: categoriesFor(getUndefinedSymbols(binaryPath), getObjcSelectors(binaryPath)),
  };
}

/**
 * Enumerates every Mach-O binary inside `appPath` (the main binary plus each `Frameworks/*.framework`),
 * classifies each one's required-reason API usage, and applies design D7's declaration rules.
 */
export function auditApp(appPath: string): readonly AuditFinding[] {
  const appName = path.basename(appPath).replace(/\.app$/, '');
  const manifests: AuditManifest[] = [{ key: ROOT_MANIFEST_KEY, declaredCategories: readManifestCategories(path.join(appPath, 'PrivacyInfo.xcprivacy')) }];
  const binaries: AuditBinaryFacts[] = [binaryFacts(appPath, path.join(appPath, appName), true, undefined)];

  const frameworksDir = path.join(appPath, 'Frameworks');
  if (fs.existsSync(frameworksDir)) {
    for (const entry of fs.readdirSync(frameworksDir)) {
      if (!entry.endsWith('.framework')) continue;
      const frameworkDir = path.join(frameworksDir, entry);
      const binaryPath = path.join(frameworkDir, entry.replace(/\.framework$/, ''));
      if (!fs.existsSync(binaryPath)) continue;
      const manifestPath = path.join(frameworkDir, 'PrivacyInfo.xcprivacy');
      const manifestKey = fs.existsSync(manifestPath) ? entry : undefined;
      if (manifestKey !== undefined) manifests.push({ key: manifestKey, declaredCategories: readManifestCategories(manifestPath) });
      binaries.push(binaryFacts(appPath, binaryPath, false, manifestKey));
    }
  }

  return auditFindings(binaries, manifests);
}
