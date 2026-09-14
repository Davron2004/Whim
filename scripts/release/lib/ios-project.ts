/**
 * Checks the iOS project's identity, hardening and link-delivery surface (design D1, D6, D7;
 * specs/native-release-config/spec.md "Both apps ship under one identity", "The iOS app
 * declares its export, device and permission surface", "The iOS privacy manifest covers linked
 * native code and collected data"; specs/app-links/spec.md "The iOS app delivers universal
 * links to the launcher"). Pure text/plist parsing — no shelling out, safe to run in the
 * Linux devcontainer gate.
 *
 * Two small parsers live here because `ios/Whim.xcodeproj/project.pbxproj` is an OpenStep
 * (NeXTSTEP) property list, not XML: `parsePbxproj` reads that grammar, `parseXmlPlist` reads
 * the real XML plists (`Info.plist`, `PrivacyInfo.xcprivacy`, `Whim.entitlements`). Both cover
 * only the value shapes this project's files use.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { NativeReleaseConfig } from './native-config';

// ── XML plist reader (dict, array, string, true/false, integer) ────────────────────────────

export type PlistValue = string | boolean | number | PlistValue[] | { [key: string]: PlistValue };

interface XmlTag {
  readonly closing: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
  readonly start: number;
  readonly end: number;
}

// Finds the next whole tag ("<key>", "</key>", "<true/>", `<plist version="1.0">`) via two
// `indexOf` calls (open "<", then the matching ">") rather than a regex — a linear scan with
// no quantifier-driven backtracking to reason about.
function nextXmlTag(text: string, from: number): XmlTag | undefined {
  const start = text.indexOf('<', from);
  if (start === -1) return undefined;
  const close = text.indexOf('>', start + 1);
  if (close === -1) return undefined;
  const raw = text.slice(start, close + 1);
  const closing = raw.startsWith('</');
  const selfClosing = raw.endsWith('/>');
  const inner = raw.slice(closing ? 2 : 1, raw.length - (selfClosing ? 2 : 1));
  const name = /^[a-zA-Z]+/.exec(inner)?.[0] ?? '';
  return { closing, name, selfClosing, start, end: close + 1 };
}

function decodeXmlEntities(raw: string): string {
  return raw.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => {
    const map: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return map[name];
  });
}

interface XmlCursor {
  pos: number;
}

function parseXmlSelfClosing(tag: XmlTag): PlistValue {
  if (tag.name === 'true') return true;
  if (tag.name === 'false') return false;
  if (tag.name === 'array') return [];
  if (tag.name === 'dict') return {};
  throw new Error(`malformed plist: unsupported self-closing tag <${tag.name}/>`);
}

function parseXmlLeaf(text: string, cursor: XmlCursor, tag: XmlTag): string | number {
  const close = nextXmlTag(text, cursor.pos);
  if (!close || !close.closing || close.name !== tag.name) {
    throw new Error(`malformed plist: expected </${tag.name}>`);
  }
  const raw = decodeXmlEntities(text.slice(tag.end, close.start));
  cursor.pos = close.end;
  return tag.name === 'integer' ? Number(raw) : raw;
}

function parseXmlValue(text: string, cursor: XmlCursor): PlistValue {
  const tag = nextXmlTag(text, cursor.pos);
  if (!tag) throw new Error('malformed plist: expected a value tag, found end of file');
  cursor.pos = tag.end;
  if (tag.selfClosing) return parseXmlSelfClosing(tag);
  if (tag.name === 'dict') return parseXmlDict(text, cursor);
  if (tag.name === 'array') return parseXmlArray(text, cursor);
  if (tag.name === 'string' || tag.name === 'integer') return parseXmlLeaf(text, cursor, tag);
  throw new Error(`malformed plist: unsupported tag <${tag.name}>`);
}

function parseXmlDict(text: string, cursor: XmlCursor): { [key: string]: PlistValue } {
  const result: { [key: string]: PlistValue } = {};
  for (;;) {
    const tag = nextXmlTag(text, cursor.pos);
    if (!tag) throw new Error('malformed plist: unterminated <dict>');
    if (tag.closing && tag.name === 'dict') {
      cursor.pos = tag.end;
      return result;
    }
    if (tag.closing || tag.name !== 'key') throw new Error('malformed plist: expected <key> inside <dict>');
    cursor.pos = tag.end;
    const closeKey = nextXmlTag(text, cursor.pos);
    if (!closeKey || !closeKey.closing || closeKey.name !== 'key') throw new Error('malformed plist: expected </key>');
    const key = decodeXmlEntities(text.slice(tag.end, closeKey.start));
    cursor.pos = closeKey.end;
    result[key] = parseXmlValue(text, cursor);
  }
}

function parseXmlArray(text: string, cursor: XmlCursor): PlistValue[] {
  const result: PlistValue[] = [];
  for (;;) {
    const tag = nextXmlTag(text, cursor.pos);
    if (!tag) throw new Error('malformed plist: unterminated <array>');
    if (tag.closing && tag.name === 'array') {
      cursor.pos = tag.end;
      return result;
    }
    result.push(parseXmlValue(text, cursor));
  }
}

/** Parses an XML property list (the `Info.plist` / `PrivacyInfo.xcprivacy` / `*.entitlements` subset: dict, array, string, true/false, integer). */
export function parseXmlPlist(text: string): PlistValue {
  const plistOpen = /<plist[^>]*>/.exec(text);
  if (!plistOpen) throw new Error('malformed plist: missing <plist> root element');
  const cursor: XmlCursor = { pos: plistOpen.index + plistOpen[0].length };
  return parseXmlValue(text, cursor);
}

function isPlistDict(v: PlistValue | undefined): v is { [key: string]: PlistValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── OpenStep plist reader, just enough of project.pbxproj's grammar ────────────────────────

export type PbxValue = string | PbxValue[] | { [key: string]: PbxValue };

type PbxToken =
  | { type: '{' | '}' | '(' | ')' | '=' | ';' | ',' }
  | { type: 'STR'; value: string };

const PBX_PUNCTUATION: ReadonlySet<string> = new Set(['{', '}', '(', ')', '=', ';', ',']);

/** Whitespace or a `/* ... *\/` / `// ...` comment starting at `i`; `-1` if `i` is neither. */
function skipPbxWhitespaceOrComment(text: string, i: number): number {
  const n = text.length;
  const c = text[i];
  if (c === ' ' || c === '\t' || c === '\n' || c === '\r') return i + 1;
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? n : end + 2;
  }
  if (c === '/' && text[i + 1] === '/') {
    const end = text.indexOf('\n', i + 2);
    return end === -1 ? n : end + 1;
  }
  return -1;
}

function readPbxQuotedString(text: string, i: number): { value: string; next: number } {
  const n = text.length;
  let j = i + 1;
  let out = '';
  while (j < n && text[j] !== '"') {
    if (text[j] === '\\' && j + 1 < n) {
      out += text[j + 1];
      j += 2;
      continue;
    }
    out += text[j];
    j++;
  }
  return { value: out, next: j + 1 };
}

function isPbxBarewordBreak(text: string, j: number): boolean {
  return ' \t\n\r{}()=;,"'.includes(text[j]) || (text[j] === '/' && (text[j + 1] === '*' || text[j + 1] === '/'));
}

function readPbxBareword(text: string, i: number): { value: string; next: number } {
  const n = text.length;
  let j = i;
  while (j < n && !isPbxBarewordBreak(text, j)) j++;
  return j === i ? { value: '', next: i + 1 } : { value: text.slice(i, j), next: j };
}

function tokenizePbxproj(text: string): PbxToken[] {
  const tokens: PbxToken[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const afterSkip = skipPbxWhitespaceOrComment(text, i);
    if (afterSkip !== -1) {
      i = afterSkip;
      continue;
    }
    const c = text[i];
    if (PBX_PUNCTUATION.has(c)) {
      tokens.push({ type: c as '{' | '}' | '(' | ')' | '=' | ';' | ',' });
      i++;
      continue;
    }
    const { value, next } = c === '"' ? readPbxQuotedString(text, i) : readPbxBareword(text, i);
    if (c === '"' || value.length > 0) tokens.push({ type: 'STR', value });
    i = next;
  }
  return tokens;
}

interface PbxCursor {
  i: number;
}

function parsePbxValue(tokens: PbxToken[], cursor: PbxCursor): PbxValue {
  const t = tokens[cursor.i];
  if (!t) throw new Error('malformed pbxproj: unexpected end of file');
  if (t.type === '{') {
    cursor.i++;
    return parsePbxDict(tokens, cursor);
  }
  if (t.type === '(') {
    cursor.i++;
    return parsePbxArray(tokens, cursor);
  }
  if (t.type === 'STR') {
    cursor.i++;
    return t.value;
  }
  throw new Error(`malformed pbxproj: unexpected token "${t.type}"`);
}

function parsePbxDict(tokens: PbxToken[], cursor: PbxCursor): { [key: string]: PbxValue } {
  const result: { [key: string]: PbxValue } = {};
  for (;;) {
    const t = tokens[cursor.i];
    if (!t) throw new Error('malformed pbxproj: unterminated dict');
    if (t.type === '}') {
      cursor.i++;
      return result;
    }
    if (t.type !== 'STR') throw new Error(`malformed pbxproj: expected a key, got "${t.type}"`);
    const key = t.value;
    cursor.i++;
    const eq = tokens[cursor.i];
    if (!eq || eq.type !== '=') throw new Error(`malformed pbxproj: expected "=" after key "${key}"`);
    cursor.i++;
    result[key] = parsePbxValue(tokens, cursor);
    const semi = tokens[cursor.i];
    if (semi && semi.type === ';') cursor.i++;
  }
}

function parsePbxArray(tokens: PbxToken[], cursor: PbxCursor): PbxValue[] {
  const result: PbxValue[] = [];
  for (;;) {
    const t = tokens[cursor.i];
    if (!t) throw new Error('malformed pbxproj: unterminated array');
    if (t.type === ')') {
      cursor.i++;
      return result;
    }
    result.push(parsePbxValue(tokens, cursor));
    const comma = tokens[cursor.i];
    if (comma && comma.type === ',') cursor.i++;
  }
}

/** Parses `project.pbxproj`'s OpenStep-plist grammar into a plain JS structure. */
export function parsePbxproj(text: string): { [key: string]: PbxValue } {
  const cursor: PbxCursor = { i: 0 };
  const root = parsePbxValue(tokenizePbxproj(text), cursor);
  if (typeof root !== 'object' || Array.isArray(root)) throw new Error('malformed pbxproj: root is not a dict');
  return root;
}

function isPbxDict(v: PbxValue | undefined): v is { [key: string]: PbxValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The `Whim` target's `buildSettings` dict for each build configuration ("Debug", "Release"), by configuration name. */
export function extractWhimTargetBuildSettings(pbxprojText: string): { [configName: string]: { [key: string]: PbxValue } } {
  const root = parsePbxproj(pbxprojText);
  const objects = root.objects;
  if (!isPbxDict(objects)) throw new Error('malformed pbxproj: missing "objects" dict');

  const target = Object.values(objects).find((o) => isPbxDict(o) && o.isa === 'PBXNativeTarget' && o.name === 'Whim');
  if (!target || !isPbxDict(target)) throw new Error('pbxproj: PBXNativeTarget "Whim" not found');

  const configListId = target.buildConfigurationList;
  const configList = typeof configListId === 'string' ? objects[configListId] : undefined;
  if (!configList || !isPbxDict(configList)) throw new Error('pbxproj: build configuration list for target "Whim" not found');

  const configIds = configList.buildConfigurations;
  if (!Array.isArray(configIds)) throw new Error('pbxproj: "buildConfigurations" is not an array');

  const result: { [configName: string]: { [key: string]: PbxValue } } = {};
  for (const idValue of configIds) {
    if (typeof idValue !== 'string') continue;
    const config = objects[idValue];
    if (!isPbxDict(config)) continue;
    const name = config.name;
    const settings = config.buildSettings;
    if (typeof name !== 'string') continue;
    result[name] = isPbxDict(settings) ? settings : {};
  }
  return result;
}

// ── checkIosProject: the release-check findings ─────────────────────────────────────────────

export interface IosProjectFinding {
  /** Repo-relative path of the offending file. */
  readonly file: string;
  readonly message: string;
}

const IOS_DIR = 'ios/Whim';
const PBXPROJ_PATH = 'ios/Whim.xcodeproj/project.pbxproj';
const INFO_PLIST_PATH = `${IOS_DIR}/Info.plist`;
const ENTITLEMENTS_PATH = `${IOS_DIR}/Whim.entitlements`;
const PRIVACY_MANIFEST_PATH = `${IOS_DIR}/PrivacyInfo.xcprivacy`;

function readRepoFile(repoRoot: string, relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function checkPbxproj(repoRoot: string, config: NativeReleaseConfig): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const settingsByConfig = extractWhimTargetBuildSettings(readRepoFile(repoRoot, PBXPROJ_PATH));
  for (const [configName, settings] of Object.entries(settingsByConfig)) {
    const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER;
    if (bundleId !== '$(WHIM_APP_ID)') {
      const literalNote = bundleId === config.WHIM_APP_ID ? ' (the literal app id, not the macro)' : '';
      findings.push({
        file: PBXPROJ_PATH,
        message: `${configName} PRODUCT_BUNDLE_IDENTIFIER must be "$(WHIM_APP_ID)", got ${JSON.stringify(bundleId)}${literalNote}`,
      });
    }
    const deviceFamily = settings.TARGETED_DEVICE_FAMILY;
    if (deviceFamily !== '1') {
      findings.push({
        file: PBXPROJ_PATH,
        message: `${configName} TARGETED_DEVICE_FAMILY must be "1" (iPhone only), got ${JSON.stringify(deviceFamily)}`,
      });
    }
  }
  return findings;
}

function checkInfoPlist(repoRoot: string): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const plist = parseXmlPlist(readRepoFile(repoRoot, INFO_PLIST_PATH));
  if (!isPlistDict(plist)) throw new Error(`${INFO_PLIST_PATH}: root is not a dict`);

  for (const [key, value] of Object.entries(plist)) {
    if (key.endsWith('UsageDescription') && value === '') {
      findings.push({ file: INFO_PLIST_PATH, message: `"${key}" must not be an empty usage-description string` });
    }
  }

  if (plist.ITSAppUsesNonExemptEncryption !== false) {
    findings.push({
      file: INFO_PLIST_PATH,
      message: `"ITSAppUsesNonExemptEncryption" must be false, got ${JSON.stringify(plist.ITSAppUsesNonExemptEncryption)}`,
    });
  }

  return findings;
}

function checkEntitlements(repoRoot: string, config: NativeReleaseConfig): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const plist = parseXmlPlist(readRepoFile(repoRoot, ENTITLEMENTS_PATH));
  if (!isPlistDict(plist)) throw new Error(`${ENTITLEMENTS_PATH}: root is not a dict`);

  const domains = plist['com.apple.developer.associated-domains'];
  const want = 'applinks:whim.$(WHIM_DOMAIN)';
  const hasWantedHost = Array.isArray(domains) && domains.includes(want);
  if (!hasWantedHost) {
    const literalHost = `applinks:whim.${config.WHIM_DOMAIN}`;
    const literalNote = Array.isArray(domains) && domains.includes(literalHost) ? ' (the literal domain, not the macro)' : '';
    findings.push({
      file: ENTITLEMENTS_PATH,
      message: `"com.apple.developer.associated-domains" must include "${want}" (built from $(WHIM_DOMAIN), not a literal host), got ${JSON.stringify(domains)}${literalNote}`,
    });
  }
  return findings;
}

function checkPrivacyManifest(repoRoot: string): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const plist = parseXmlPlist(readRepoFile(repoRoot, PRIVACY_MANIFEST_PATH));
  if (!isPlistDict(plist)) throw new Error(`${PRIVACY_MANIFEST_PATH}: root is not a dict`);

  const accessedTypes = plist.NSPrivacyAccessedAPITypes;
  const hasDiskSpace =
    Array.isArray(accessedTypes) &&
    accessedTypes.some(
      (entry) =>
        isPlistDict(entry) &&
        entry.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryDiskSpace' &&
        Array.isArray(entry.NSPrivacyAccessedAPITypeReasons) &&
        (entry.NSPrivacyAccessedAPITypeReasons as PlistValue[]).includes('E174.1'),
    );
  if (!hasDiskSpace) {
    findings.push({
      file: PRIVACY_MANIFEST_PATH,
      message: 'must declare the DiskSpace accessed-API category with reason E174.1 (op-sqlite\'s statfs calls)',
    });
  }

  if (plist.NSPrivacyTracking !== false) {
    findings.push({
      file: PRIVACY_MANIFEST_PATH,
      message: `"NSPrivacyTracking" must be false, got ${JSON.stringify(plist.NSPrivacyTracking)}`,
    });
  }

  return findings;
}

/**
 * Checks the iOS project under `repoRoot` against `config` (the parsed native release file),
 * returning every finding: an empty array means the project passes.
 */
export function checkIosProject(repoRoot: string, config: NativeReleaseConfig): IosProjectFinding[] {
  return [
    ...checkPbxproj(repoRoot, config),
    ...checkInfoPlist(repoRoot),
    ...checkEntitlements(repoRoot, config),
    ...checkPrivacyManifest(repoRoot),
  ];
}
