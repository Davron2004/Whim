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

interface PbxConfigurationEntry {
  readonly buildSettings: { [key: string]: PbxValue };
  /** The resolved `path` of `baseConfigurationReference`'s `PBXFileReference`; `undefined` when
   *  the configuration sets none, or it doesn't resolve to a file reference with a `path`. */
  readonly baseConfigurationReferencePath: string | undefined;
}

function resolveFileReferencePath(objects: { [key: string]: PbxValue }, ref: PbxValue | undefined): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const fileRef = objects[ref];
  if (!isPbxDict(fileRef)) return undefined;
  const filePath = fileRef.path;
  return typeof filePath === 'string' ? filePath : undefined;
}

/** Every `XCBuildConfiguration` an `XCConfigurationList` (`configListId`) points at, by name. */
function extractConfigurationsByName(objects: { [key: string]: PbxValue }, configListId: PbxValue | undefined): { [configName: string]: PbxConfigurationEntry } {
  const configList = typeof configListId === 'string' ? objects[configListId] : undefined;
  if (!configList || !isPbxDict(configList)) throw new Error('pbxproj: build configuration list not found');

  const configIds = configList.buildConfigurations;
  if (!Array.isArray(configIds)) throw new Error('pbxproj: "buildConfigurations" is not an array');

  const result: { [configName: string]: PbxConfigurationEntry } = {};
  for (const idValue of configIds) {
    if (typeof idValue !== 'string') continue;
    const config = objects[idValue];
    if (!isPbxDict(config)) continue;
    const name = config.name;
    if (typeof name !== 'string') continue;
    const settings = config.buildSettings;
    result[name] = {
      buildSettings: isPbxDict(settings) ? settings : {},
      baseConfigurationReferencePath: resolveFileReferencePath(objects, config.baseConfigurationReference),
    };
  }
  return result;
}

/** The `Whim` target's `buildSettings` dict for each build configuration ("Debug", "Release"), by configuration name. */
export function extractWhimTargetBuildSettings(pbxprojText: string): { [configName: string]: { [key: string]: PbxValue } } {
  const root = parsePbxproj(pbxprojText);
  const objects = root.objects;
  if (!isPbxDict(objects)) throw new Error('malformed pbxproj: missing "objects" dict');

  const target = Object.values(objects).find((o) => isPbxDict(o) && o.isa === 'PBXNativeTarget' && o.name === 'Whim');
  if (!target || !isPbxDict(target)) throw new Error('pbxproj: PBXNativeTarget "Whim" not found');

  const result: { [configName: string]: { [key: string]: PbxValue } } = {};
  for (const [name, entry] of Object.entries(extractConfigurationsByName(objects, target.buildConfigurationList))) {
    result[name] = entry.buildSettings;
  }
  return result;
}

/**
 * The project-level (`PBXProject`) build configurations' `baseConfigurationReference`, resolved
 * to a path, by configuration name. This is where `release/whim-release.xcconfig` is wired in —
 * the `$(WHIM_...)` macros the target-level settings reference come from here, cascading down
 * regardless of the target's own `baseConfigurationReference` (the Pods xcconfig).
 */
export function extractWhimProjectBaseConfigPaths(pbxprojText: string): { [configName: string]: string | undefined } {
  const root = parsePbxproj(pbxprojText);
  const objects = root.objects;
  if (!isPbxDict(objects)) throw new Error('malformed pbxproj: missing "objects" dict');

  const rootObjectId = root.rootObject;
  const project = typeof rootObjectId === 'string' ? objects[rootObjectId] : undefined;
  if (!project || !isPbxDict(project) || project.isa !== 'PBXProject') throw new Error('pbxproj: root PBXProject not found');

  const result: { [configName: string]: string | undefined } = {};
  for (const [name, entry] of Object.entries(extractConfigurationsByName(objects, project.buildConfigurationList))) {
    result[name] = entry.baseConfigurationReferencePath;
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
const APP_DELEGATE_PATH = `${IOS_DIR}/AppDelegate.swift`;
const SCENE_DELEGATE_PATH = `${IOS_DIR}/SceneDelegate.swift`;
const CODE_SIGN_ENTITLEMENTS_VALUE = 'Whim/Whim.entitlements';
const WHIM_RELEASE_XCCONFIG_SUFFIX = 'release/whim-release.xcconfig';
const SCENE_DELEGATE_PROJECT_PATH = 'Whim/SceneDelegate.swift';

function readRepoFile(repoRoot: string, relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

/** One `key` finding, distinguishing "the literal value" from any other wrong value, same shape as the bundle-id check below. */
function checkMacroSetting(findings: IosProjectFinding[], configName: string, settings: { [key: string]: PbxValue }, key: string, macro: string, literalValue: string): void {
  const value = settings[key];
  if (value === macro) return;
  const literalNote = value === literalValue ? ' (the literal value, not the macro)' : '';
  findings.push({
    file: PBXPROJ_PATH,
    message: `${configName} ${key} must be ${JSON.stringify(macro)}, got ${JSON.stringify(value)}${literalNote}`,
  });
}

function checkSceneDelegateSourceMembership(pbxprojText: string): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const root = parsePbxproj(pbxprojText);
  const objects = root.objects;
  if (!isPbxDict(objects)) throw new Error('malformed pbxproj: missing "objects" dict');
  const sceneDelegateFileRef = Object.entries(objects).find(
    ([, object]) => isPbxDict(object) && object.isa === 'PBXFileReference' && object.path === SCENE_DELEGATE_PROJECT_PATH,
  )?.[0];
  if (!sceneDelegateFileRef) {
    findings.push({
      file: PBXPROJ_PATH,
      message: `must include a PBXFileReference for ${JSON.stringify(SCENE_DELEGATE_PROJECT_PATH)}`,
    });
    return findings;
  }

  const target = Object.values(objects).find((object) => isPbxDict(object) && object.isa === 'PBXNativeTarget' && object.name === 'Whim');
  const sourceBuildPhaseIds = isPbxDict(target) && Array.isArray(target.buildPhases) ? target.buildPhases : [];
  const sceneDelegateIsInSources = sourceBuildPhaseIds.some((phaseId) => {
    const phase = typeof phaseId === 'string' ? objects[phaseId] : undefined;
    if (!isPbxDict(phase) || phase.isa !== 'PBXSourcesBuildPhase' || !Array.isArray(phase.files)) return false;
    return phase.files.some((buildFileId) => {
      const buildFile = typeof buildFileId === 'string' ? objects[buildFileId] : undefined;
      return isPbxDict(buildFile) && buildFile.isa === 'PBXBuildFile' && buildFile.fileRef === sceneDelegateFileRef;
    });
  });
  if (!sceneDelegateIsInSources) {
    findings.push({
      file: PBXPROJ_PATH,
      message: `${SCENE_DELEGATE_PROJECT_PATH} must be a member of the Whim target's Sources build phase`,
    });
  }
  return findings;
}

function checkPbxproj(repoRoot: string, config: NativeReleaseConfig): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const pbxprojText = readRepoFile(repoRoot, PBXPROJ_PATH);
  const settingsByConfig = extractWhimTargetBuildSettings(pbxprojText);
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
    checkMacroSetting(findings, configName, settings, 'DEVELOPMENT_TEAM', '$(WHIM_APPLE_TEAM_ID)', config.WHIM_APPLE_TEAM_ID);
    checkMacroSetting(findings, configName, settings, 'MARKETING_VERSION', '$(WHIM_MARKETING_VERSION)', config.WHIM_MARKETING_VERSION);
    checkMacroSetting(findings, configName, settings, 'CURRENT_PROJECT_VERSION', '$(WHIM_BUILD_NUMBER)', config.WHIM_BUILD_NUMBER);
    const entitlements = settings.CODE_SIGN_ENTITLEMENTS;
    if (entitlements !== CODE_SIGN_ENTITLEMENTS_VALUE) {
      findings.push({
        file: PBXPROJ_PATH,
        message: `${configName} CODE_SIGN_ENTITLEMENTS must be ${JSON.stringify(CODE_SIGN_ENTITLEMENTS_VALUE)}, got ${JSON.stringify(entitlements)}`,
      });
    }
  }

  // The project-level Debug and Release configurations must both wire in whim-release.xcconfig
  // — that's the ONE place the `$(WHIM_...)` macros above actually resolve from.
  for (const [configName, basePath] of Object.entries(extractWhimProjectBaseConfigPaths(pbxprojText))) {
    if (basePath === undefined || !basePath.endsWith(WHIM_RELEASE_XCCONFIG_SUFFIX)) {
      findings.push({
        file: PBXPROJ_PATH,
        message: `${configName} project-level baseConfigurationReference must resolve to a path ending "${WHIM_RELEASE_XCCONFIG_SUFFIX}", got ${JSON.stringify(basePath)}`,
      });
    }
  }

  findings.push(...checkSceneDelegateSourceMembership(pbxprojText));
  return findings;
}

function checkSceneManifest(plist: { [key: string]: PlistValue }): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const sceneManifest = plist.UIApplicationSceneManifest;
  if (!isPlistDict(sceneManifest)) {
    findings.push({ file: INFO_PLIST_PATH, message: 'must declare UIApplicationSceneManifest' });
    return findings;
  }
  if (sceneManifest.UISupportsMultipleScenes !== false) {
    findings.push({
      file: INFO_PLIST_PATH,
      message: 'UIApplicationSceneManifest UISupportsMultipleScenes must be false',
    });
  }
  const configurations = sceneManifest.UISceneConfigurations;
  const applicationConfigurations = isPlistDict(configurations)
    ? configurations.UIWindowSceneSessionRoleApplication
    : undefined;
  if (!Array.isArray(applicationConfigurations) || applicationConfigurations.length !== 1) {
    findings.push({
      file: INFO_PLIST_PATH,
      message: 'UIApplicationSceneManifest must declare exactly one UIWindowSceneSessionRoleApplication configuration',
    });
    return findings;
  }
  const configuration = applicationConfigurations[0];
  if (!isPlistDict(configuration) || configuration.UISceneClassName !== 'UIWindowScene') {
    findings.push({
      file: INFO_PLIST_PATH,
      message: 'the UIWindowSceneSessionRoleApplication configuration must set UISceneClassName to "UIWindowScene"',
    });
  }
  if (!isPlistDict(configuration) || configuration.UISceneDelegateClassName !== '$(PRODUCT_MODULE_NAME).SceneDelegate') {
    findings.push({
      file: INFO_PLIST_PATH,
      message: 'the UIWindowSceneSessionRoleApplication configuration must set UISceneDelegateClassName to "$(PRODUCT_MODULE_NAME).SceneDelegate"',
    });
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

  findings.push(...checkSceneManifest(plist));
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

/**
 * Checks the source-level scene lifecycle wiring. This is intentionally separate from
 * `checkIosProject`: the release-project check reads only plist, entitlement, privacy and Xcode
 * project files. These string-level checks can catch disconnected native callbacks in the portable
 * suite, but cannot prove UIKit invokes them or that an associated domain is configured on a device.
 */
export function checkIosSceneLifecycleWiring(repoRoot: string): IosProjectFinding[] {
  const findings: IosProjectFinding[] = [];
  const appDelegate = readRepoFile(repoRoot, APP_DELEGATE_PATH);
  const sceneDelegate = readRepoFile(repoRoot, SCENE_DELEGATE_PATH);
  const sceneDelegateWithoutWhitespace = sceneDelegate.replace(/\s+/g, ' ').replace(/\(\s+/g, '(');
  const appDelegateRequirements: ReadonlyArray<readonly [string, string]> = [
    ['retain the React Native delegate', 'var reactNativeDelegate: ReactNativeDelegate?'],
    ['retain the React Native factory', 'var reactNativeFactory: RCTReactNativeFactory?'],
    ['reuse the retained React Native factory on scene reconnection', 'if let existingFactory = reactNativeFactory'],
    ['start React Native from the scene window', 'factory.startReactNative('],
    ['preserve the launch background', 'UIColor(named: "LaunchBackground")'],
    ['preserve application-delegate user-activity forwarding', 'RCTLinkingManager.application(application, continue: userActivity'],
    ['preserve application-delegate URL forwarding', 'RCTLinkingManager.application(app, open: url, options: options)'],
  ];
  for (const [description, fragment] of appDelegateRequirements) {
    if (!appDelegate.includes(fragment)) {
      findings.push({ file: APP_DELEGATE_PATH, message: `must ${description} (${JSON.stringify(fragment)})` });
    }
  }
  if (appDelegate.includes('UIWindow(frame:')) {
    findings.push({ file: APP_DELEGATE_PATH, message: 'must not create the application window outside the scene lifecycle' });
  }

  const sceneDelegateRequirements: ReadonlyArray<readonly [string, string]> = [
    ['create a UIWindow from the connected UIWindowScene', 'UIWindow(windowScene: windowScene)'],
    [
      'pass the connection-options conversion result to React Native startup',
      'let launchOptions = Self.launchOptions(from: connectionOptions) appDelegate.startReactNative(in: window, launchOptions: launchOptions)',
    ],
    [
      'translate a cold URL context into the URL launch option',
      'if let context = connectionOptions.urlContexts.first { return [UIApplication.LaunchOptionsKey.url: context.url] }',
    ],
    ['forward warm user activities', 'RCTLinkingManager.application(UIApplication.shared, continue: userActivity'],
    ['forward warm URL contexts', 'RCTLinkingManager.application(UIApplication.shared, open: context.url, options:'],
  ];
  for (const [description, fragment] of sceneDelegateRequirements) {
    if (!sceneDelegateWithoutWhitespace.includes(fragment)) {
      findings.push({ file: SCENE_DELEGATE_PATH, message: `must ${description} (${JSON.stringify(fragment)})` });
    }
  }
  const coldUserActivityLaunchOptions =
    /if let userActivity = connectionOptions\.userActivities\.first\(where: \{.*?\}\s*\)\s*\{\s*return \[\s*UIApplication\.LaunchOptionsKey\.userActivityDictionary:\s*\[\s*UIApplication\.LaunchOptionsKey\.userActivityType: userActivity\.activityType,\s*"UIApplicationLaunchOptionsUserActivityKey": userActivity,/.test(
      sceneDelegateWithoutWhitespace,
    );
  if (!coldUserActivityLaunchOptions) {
    findings.push({
      file: SCENE_DELEGATE_PATH,
      message: 'must translate a cold browsing activity into the user-activity launch option passed to React Native',
    });
  }
  return findings;
}
