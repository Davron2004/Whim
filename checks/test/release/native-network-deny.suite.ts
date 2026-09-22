/**
 * Source checks for platform-release-readiness D17's native WebView network refusal.
 * Android runs these checks here; chain-17 extends this suite with the iOS wiring cases.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePbxproj, type PbxValue } from '../../../scripts/release/lib/ios-project';
import { assert, test } from '../harness';

export const ANDROID_NETWORK_DENY_MANAGER_PATH =
  'android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewManager.kt';
export const ANDROID_NETWORK_DENY_PACKAGE_PATH =
  'android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewPackage.kt';
export const ANDROID_MAIN_APPLICATION_PATH = 'android/app/src/main/java/com/whim/MainApplication.kt';
export const IOS_NETWORK_DENY_RULES_PATH = 'ios/Whim/WebViewNetworkDeny.json';
export const IOS_NETWORK_DENY_IMPLEMENTATION_PATH = 'ios/Whim/WhimWebViewNetworkDeny.m';
export const IOS_PROJECT_PATH = 'ios/Whim.xcodeproj/project.pbxproj';

export interface NativeNetworkDenyFinding {
  readonly file: string;
  readonly message: string;
}

export function writeNativeNetworkDenyFixture(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

export function makeNativeNetworkDenyFixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-native-network-deny-'));
}

function readRequired(root: string, relPath: string, findings: NativeNetworkDenyFinding[]): string {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  // eslint-disable-next-line no-restricted-syntax -- unreadable required files become named findings below
  } catch {
    findings.push({ file: relPath, message: 'required native network-deny source is missing or unreadable' });
    return '';
  }
}

function maskRange(chars: string[], source: string, start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (source[index] !== '\n' && source[index] !== '\r') chars[index] = ' ';
  }
}

function endOfQuotedLiteral(source: string, start: number, quote: '"' | "'"): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
    } else if (source[index] === quote) {
      return index + 1;
    } else {
      index++;
    }
  }
  return source.length;
}

function endOfBlockComment(source: string, start: number): number {
  let depth = 1;
  let index = start + 2;
  while (index < source.length && depth > 0) {
    if (source.startsWith('/*', index)) {
      depth++;
      index += 2;
    } else if (source.startsWith('*/', index)) {
      depth--;
      index += 2;
    } else {
      index++;
    }
  }
  return index;
}

interface KotlinLiteralSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface KotlinLexResult {
  readonly code: string;
  readonly strings: readonly KotlinLiteralSpan[];
}

interface KotlinMaskedSpan {
  readonly end: number;
  readonly isString: boolean;
}

function nonCodeSpanAt(source: string, index: number): KotlinMaskedSpan | undefined {
  if (source.startsWith('//', index)) {
    const newline = source.indexOf('\n', index + 2);
    return { end: newline < 0 ? source.length : newline, isString: false };
  }
  if (source.startsWith('/*', index)) {
    return { end: endOfBlockComment(source, index), isString: false };
  }
  if (source.startsWith('"""', index)) {
    const close = source.indexOf('"""', index + 3);
    return { end: close < 0 ? source.length : close + 3, isString: true };
  }
  if (source[index] === '"' || source[index] === "'") {
    return {
      end: endOfQuotedLiteral(source, index, source[index] as '"' | "'"),
      isString: source[index] === '"',
    };
  }
  return undefined;
}

/** Preserve Kotlin code positions while blanking comments and literal bodies. */
function lexKotlin(source: string): KotlinLexResult {
  const chars = source.split('');
  const strings: KotlinLiteralSpan[] = [];
  let index = 0;
  while (index < source.length) {
    const span = nonCodeSpanAt(source, index);
    if (span) {
      if (span.isString) strings.push({ start: index, end: span.end, text: source.slice(index, span.end) });
      maskRange(chars, source, index, span.end);
      index = span.end;
    } else {
      index++;
    }
  }
  return { code: chars.join(''), strings };
}

function closingBraceIndex(source: string, start: number): number | undefined {
  if (start < 0) return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) return index;
  }
  return undefined;
}

function methodBody(source: string, signature: RegExp): string | undefined {
  const match = signature.exec(source);
  if (!match) return undefined;
  const start = source.indexOf('{', match.index);
  if (start < 0) return undefined;
  const end = closingBraceIndex(source, start);
  return end === undefined ? undefined : source.slice(start + 1, end);
}

function addFinding(findings: NativeNetworkDenyFinding[], file: string, message: string): void {
  findings.push({ file, message });
}

/** The invariant is "exactly one package got replaced, checked before use" — the message text
 *  naming autolinking is a style choice, not something a weaker implementation would get wrong
 *  in a way this check should catch. */
function exactlyOnePackageIsChecked(application: KotlinLexResult): boolean {
  const match = /check\s*\(replacedWebViewPackages\s*==\s*1\)\s*\{/.exec(application.code);
  if (!match) return false;
  const start = application.code.indexOf('{', match.index);
  const end = closingBraceIndex(application.code, start);
  if (end === undefined) return false;
  const attachedStrings = application.strings.filter((span) => span.start > start && span.end <= end);
  return application.code.slice(start + 1, end).trim() === '' && attachedStrings.length === 1;
}

function checkApplicationWiring(application: KotlinLexResult, findings: NativeNetworkDenyFinding[]): void {
  const { code } = application;
  if (!/PackageList\(this\)\.packages\.apply\s*\{/.test(code)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'the autolinked package list is not updated in place');
  }
  if (!/if\s*\(this\[index]\s+is\s+RNCWebViewPackage\)/.test(code)
      || !/this\[index]\s*=\s*NetworkDeniedWebViewPackage\(\)/.test(code)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'RNCWebViewPackage is not replaced at its existing index');
  }
  if ((code.match(/NetworkDeniedWebViewPackage\s*\(\s*\)/g) ?? []).length !== 1
      || /\bRNCWebViewPackage\s*\(\s*\)/.test(code)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'the package list must contain one denied manager package and no stock instance');
  }
  if (!exactlyOnePackageIsChecked(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'startup must check exactly one react-native-webview autolinked package');
  }
  if (!/add\([^\n]*WhimTonePackage\(\)\)/.test(code)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'WhimTonePackage must remain registered');
  }
}

export function checkAndroidNativeNetworkDeny(root: string): NativeNetworkDenyFinding[] {
  const findings: NativeNetworkDenyFinding[] = [];
  const application = readRequired(root, ANDROID_MAIN_APPLICATION_PATH, findings);
  const manager = readRequired(root, ANDROID_NETWORK_DENY_MANAGER_PATH, findings);
  const pkg = readRequired(root, ANDROID_NETWORK_DENY_PACKAGE_PATH, findings);
  const applicationLex = lexKotlin(application);
  const managerCode = lexKotlin(manager).code;
  const packageCode = lexKotlin(pkg).code;

  checkApplicationWiring(applicationLex, findings);

  if (!/class\s+NetworkDeniedWebViewManager\s*:\s*RNCWebViewManager\(\)/.test(managerCode)) {
    addFinding(findings, ANDROID_NETWORK_DENY_MANAGER_PATH, 'manager must subclass RNCWebViewManager');
  }
  const createBody = methodBody(
    managerCode,
    /override\s+fun\s+createViewInstance\s*\([^)]*ThemedReactContext[^)]*\)\s*:\s*RNCWebViewWrapper\s*\{/,
  );
  if (!createBody) {
    addFinding(findings, ANDROID_NETWORK_DENY_MANAGER_PATH, 'createViewInstance override is missing');
  } else {
    const createIndex = createBody.indexOf('super.createViewInstance(context)');
    const denyIndex = createBody.indexOf('wrapper.webView.settings.blockNetworkLoads = true');
    const returnIndex = createBody.indexOf('return wrapper');
    if (!(createIndex >= 0 && denyIndex > createIndex && returnIndex > denyIndex)) {
      addFinding(
        findings,
        ANDROID_NETWORK_DENY_MANAGER_PATH,
        'createViewInstance must set blockNetworkLoads = true after creation and before return',
      );
    }
  }
  if (/blockNetworkLoads\s*=\s*false/.test(managerCode)) {
    addFinding(findings, ANDROID_NETWORK_DENY_MANAGER_PATH, 'blockNetworkLoads must never be set to false');
  }

  if (!/class\s+NetworkDeniedWebViewPackage\s*:\s*RNCWebViewPackage\(\)/.test(packageCode)) {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'package must subclass RNCWebViewPackage');
  }
  const packageBody = methodBody(packageCode, /override\s+fun\s+createViewManagers\s*\([^)]*\)\s*:\s*List<ViewManager<\*,\s*\*>>\s*\{/);
  const compactPackageBody = packageBody?.replace(/\s+/g, ' ').trim();
  if (compactPackageBody !== 'return listOf(NetworkDeniedWebViewManager())') {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'createViewManagers must return only NetworkDeniedWebViewManager');
  }
  if (/\bRNCWebViewManager\s*\(\s*\)/.test(packageCode)) {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'the denied package must not return the stock RNCWebViewManager');
  }
  if (/override\s+fun\s+(getModule|getReactModuleInfoProvider)\b/.test(packageCode)) {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'module providers must be inherited unchanged');
  }

  return findings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedKeys(value: Record<string, unknown>): string {
  return Object.keys(value).sort((left, right) => left.localeCompare(right)).join(',');
}

function ruleFilter(rule: unknown): string | undefined {
  if (!isRecord(rule) || sortedKeys(rule) !== 'action,trigger') return undefined;
  const { action, trigger } = rule;
  if (!isRecord(action) || sortedKeys(action) !== 'type' || action.type !== 'block') return undefined;
  if (!isRecord(trigger) || sortedKeys(trigger) !== 'url-filter') return undefined;
  return typeof trigger['url-filter'] === 'string' ? trigger['url-filter'] : undefined;
}

function checkRuleFile(source: string, findings: NativeNetworkDenyFinding[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  // eslint-disable-next-line no-restricted-syntax -- invalid JSON becomes the named rule-file finding below
  } catch {
    addFinding(findings, IOS_NETWORK_DENY_RULES_PATH, 'rule file must be valid JSON');
    return;
  }
  const filters = Array.isArray(parsed) ? parsed.map(ruleFilter) : [];
  if (filters.length !== 2 || filters.some((filter) => filter === undefined)
      || [...filters].sort((left, right) => (left ?? '').localeCompare(right ?? '')).join(',') !== '^https?:,^wss?:') {
    addFinding(
      findings,
      IOS_NETWORK_DENY_RULES_PATH,
      'rules must contain only blocking ^https?: and ^wss?: triggers with no trigger qualifiers',
    );
  }
}

function objectiveCCodeOnly(source: string): string {
  // Objective-C comments, quoted strings and character literals are a subset of this lexer.
  return lexKotlin(source).code;
}

function methodVariableForSelector(loadBody: string, selector: string): string | undefined {
  const selectorPattern = selector.replaceAll(':', '\\s*:\\s*');
  const assignment = new RegExp(
    `\\bMethod\\s+(\\w+)\\s*=\\s*class_getInstanceMethod\\s*\\(\\s*WKWebView\\.class\\s*,`
      + `\\s*@selector\\s*\\(\\s*${selectorPattern}\\s*\\)\\s*\\)\\s*;`,
  ).exec(loadBody);
  return assignment?.[1];
}

function exchangesMethods(loadBody: string, original: string, replacement: string): boolean {
  const call = new RegExp(
    `method_exchangeImplementations\\s*\\(\\s*${original}\\s*,\\s*${replacement}\\s*\\)`,
  );
  return call.test(loadBody);
}

function denyBranchBodies(body: string): { ready: string; unavailable: string } | undefined {
  const readyStart = /if\s*\(\s*ruleList(?:\s*!=\s*nil)?\s*\)\s*\{/.exec(body);
  if (!readyStart) return undefined;
  const readyBrace = body.indexOf('{', readyStart.index);
  const readyEnd = closingBraceIndex(body, readyBrace);
  if (readyEnd === undefined) return undefined;
  const elseStart = /^\s*else\s*\{/.exec(body.slice(readyEnd + 1));
  if (!elseStart) return undefined;
  const elseBrace = body.indexOf('{', readyEnd + 1 + elseStart.index);
  const elseEnd = closingBraceIndex(body, elseBrace);
  if (elseEnd === undefined) return undefined;
  return {
    ready: body.slice(readyBrace + 1, readyEnd),
    unavailable: body.slice(elseBrace + 1, elseEnd),
  };
}

function checkObjectiveCImplementation(source: string, findings: NativeNetworkDenyFinding[]): void {
  const code = objectiveCCodeOnly(source);
  const loadBody = methodBody(code, /\+\s*\(void\)\s*load\s*\{/);
  const replacement = /-\s*\([^)]*\)\s*(init[A-Z]\w*)\s*:[^{;]+\bconfiguration\s*:[^{;]+\{/.exec(code);
  const replacementSelector = replacement ? `${replacement[1]}:configuration:` : undefined;
  const originalMethod = loadBody
    ? methodVariableForSelector(loadBody, 'initWithFrame:configuration:')
    : undefined;
  const replacementMethod = loadBody && replacementSelector
    ? methodVariableForSelector(loadBody, replacementSelector)
    : undefined;
  if (!loadBody || !/dispatch_once\s*\(/.test(loadBody)
      || !originalMethod
      || !replacementMethod
      || !exchangesMethods(loadBody, originalMethod, replacementMethod)) {
    addFinding(findings, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, '+load must swap the WKWebView initializer once');
  }
  if (!replacement || !replacementSelector) {
    addFinding(findings, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, 'replacement selector must belong to the init family');
    return;
  }
  const start = code.indexOf('{', replacement.index);
  const end = closingBraceIndex(code, start);
  const body = end === undefined ? '' : code.slice(start + 1, end);
  const branches = denyBranchBodies(body);
  if (!branches || !/addContentRuleList\s*:/.test(branches.ready)) {
    addFinding(findings, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, 'replacement must attach the compiled content rule list');
  }
  if (!branches || !/allowsContentJavaScript\s*=\s*NO/.test(branches.unavailable)) {
    addFinding(findings, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, 'replacement must fail closed while the rule list is unavailable');
  }
  if (!body.includes(`[self ${replacementSelector.replace(':configuration:', ':frame configuration:configuration')}]`)) {
    addFinding(findings, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, 'replacement must call the swapped original initializer');
  }
}

function isPbxDict(value: PbxValue | undefined): value is { [key: string]: PbxValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pbxObject(objects: { [key: string]: PbxValue }, identifier: PbxValue): PbxValue | undefined {
  return typeof identifier === 'string' ? objects[identifier] : undefined;
}

function phaseHasFile(
  objects: { [key: string]: PbxValue },
  phase: { [key: string]: PbxValue },
  filePath: string,
): boolean {
  if (!Array.isArray(phase.files)) return false;
  return phase.files.some((identifier) => {
    const buildFile = pbxObject(objects, identifier);
    const fileRef = isPbxDict(buildFile) ? pbxObject(objects, buildFile.fileRef) : undefined;
    return isPbxDict(fileRef) && fileRef.path === filePath;
  });
}

function targetPhaseHasFile(pbxproj: string, phaseType: string, filePath: string): boolean {
  const root = parsePbxproj(pbxproj);
  const objects = root.objects;
  if (!isPbxDict(objects)) return false;
  const target = Object.values(objects).find(
    (value) => isPbxDict(value) && value.isa === 'PBXNativeTarget' && value.name === 'Whim',
  );
  if (!isPbxDict(target) || !Array.isArray(target.buildPhases)) return false;
  return target.buildPhases.some((identifier) => {
    const phase = pbxObject(objects, identifier);
    return isPbxDict(phase) && phase.isa === phaseType && phaseHasFile(objects, phase, filePath);
  });
}

function checkIosProjectWiring(pbxproj: string, findings: NativeNetworkDenyFinding[]): void {
  try {
    if (!targetPhaseHasFile(pbxproj, 'PBXSourcesBuildPhase', 'Whim/WhimWebViewNetworkDeny.m')) {
      addFinding(findings, IOS_PROJECT_PATH, 'WhimWebViewNetworkDeny.m must be in the Whim Sources phase');
    }
    if (!targetPhaseHasFile(pbxproj, 'PBXResourcesBuildPhase', 'Whim/WebViewNetworkDeny.json')) {
      addFinding(findings, IOS_PROJECT_PATH, 'WebViewNetworkDeny.json must be in the Whim Resources phase');
    }
  // eslint-disable-next-line no-restricted-syntax -- parse errors become the stable project-level finding below
  } catch {
    addFinding(findings, IOS_PROJECT_PATH, 'iOS project must parse and contain the network-deny target membership');
  }
}

export function checkIosNativeNetworkDeny(root: string): NativeNetworkDenyFinding[] {
  const findings: NativeNetworkDenyFinding[] = [];
  const rules = readRequired(root, IOS_NETWORK_DENY_RULES_PATH, findings);
  const implementation = readRequired(root, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, findings);
  const pbxproj = readRequired(root, IOS_PROJECT_PATH, findings);
  checkRuleFile(rules, findings);
  checkObjectiveCImplementation(implementation, findings);
  checkIosProjectWiring(pbxproj, findings);
  return findings;
}

const VALID_APPLICATION = `
package com.whim
import com.reactnativecommunity.webview.RNCWebViewPackage
import com.whim.webview.NetworkDeniedWebViewPackage
val packages = PackageList(this).packages.apply {
  var replacedWebViewPackages = 0
  for (index in indices) {
    if (this[index] is RNCWebViewPackage) {
      this[index] = NetworkDeniedWebViewPackage()
      replacedWebViewPackages++
    }
  }
  check(replacedWebViewPackages == 1) { "react-native-webview autolinking must provide exactly one package" }
  add(com.whim.tone.WhimTonePackage())
}
`;

const VALID_MANAGER = `
package com.whim.webview
class NetworkDeniedWebViewManager : RNCWebViewManager() {
  override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper {
    val wrapper = super.createViewInstance(context)
    val normal = "escaped quote: \\" and brace }"
    val raw = """braces { } and // text"""
    val brace = '{'
    /* nested braces { /* still a comment } */ } */
    wrapper.webView.settings.blockNetworkLoads = true
    return wrapper
  }
}
`;

const VALID_PACKAGE = `
package com.whim.webview
class NetworkDeniedWebViewPackage : RNCWebViewPackage() {
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(NetworkDeniedWebViewManager())
  }
}
`;

const VALID_IOS_RULES = `[
  {"trigger":{"url-filter":"^https?:"},"action":{"type":"block"}},
  {"trigger":{"url-filter":"^wss?:"},"action":{"type":"block"}}
]`;

const VALID_IOS_IMPLEMENTATION = `
@implementation WhimWebViewNetworkDeny
+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Method original = class_getInstanceMethod(WKWebView.class, @selector(initWithFrame:configuration:));
    Method replacement = class_getInstanceMethod(WKWebView.class, @selector(initWhimNetworkDeniedWithFrame:configuration:));
    method_exchangeImplementations(original, replacement);
  });
}
@end

@implementation WKWebView (WhimNetworkDeny)
- (instancetype)initWhimNetworkDeniedWithFrame:(CGRect)frame configuration:(WKWebViewConfiguration *)configuration {
  NSString *brace = @"escaped quote \\" and brace }";
  unichar openingBrace = '{';
  if (ruleList) {
    [configuration.userContentController addContentRuleList:ruleList];
  } else {
    configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
  }
  return [self initWhimNetworkDeniedWithFrame:frame configuration:configuration];
}
@end
`;

const VALID_IOS_PROJECT = `
{
  objects = {
    TARGET = { isa = PBXNativeTarget; name = Whim; buildPhases = ( SOURCES, RESOURCES, ); };
    SOURCES = { isa = PBXSourcesBuildPhase; files = ( SOURCE_BUILD, ); };
    RESOURCES = { isa = PBXResourcesBuildPhase; files = ( RULES_BUILD, ); };
    SOURCE_BUILD = { isa = PBXBuildFile; fileRef = SOURCE_REF; };
    RULES_BUILD = { isa = PBXBuildFile; fileRef = RULES_REF; };
    SOURCE_REF = { isa = PBXFileReference; path = Whim/WhimWebViewNetworkDeny.m; };
    RULES_REF = { isa = PBXFileReference; path = Whim/WebViewNetworkDeny.json; };
  };
  rootObject = PROJECT;
}
`;

function writeValidFixture(root: string): void {
  writeNativeNetworkDenyFixture(root, ANDROID_MAIN_APPLICATION_PATH, VALID_APPLICATION);
  writeNativeNetworkDenyFixture(root, ANDROID_NETWORK_DENY_MANAGER_PATH, VALID_MANAGER);
  writeNativeNetworkDenyFixture(root, ANDROID_NETWORK_DENY_PACKAGE_PATH, VALID_PACKAGE);
}

function writeValidIosFixture(root: string): void {
  writeNativeNetworkDenyFixture(root, IOS_NETWORK_DENY_RULES_PATH, VALID_IOS_RULES);
  writeNativeNetworkDenyFixture(root, IOS_NETWORK_DENY_IMPLEMENTATION_PATH, VALID_IOS_IMPLEMENTATION);
  writeNativeNetworkDenyFixture(root, IOS_PROJECT_PATH, VALID_IOS_PROJECT);
}

function assertFindingNamesFile(root: string, file: string): void {
  const findings = checkAndroidNativeNetworkDeny(root);
  assert(findings.some((finding) => finding.file === file), `expected a finding naming ${file}, got ${JSON.stringify(findings)}`);
}

function assertIosFindingNamesFile(root: string, file: string): void {
  const findings = checkIosNativeNetworkDeny(root);
  assert(findings.some((finding) => finding.file === file), `expected an iOS finding naming ${file}, got ${JSON.stringify(findings)}`);
}

interface MutationCase {
  readonly name: string;
  readonly file: string;
  readonly mutate: (valid: string) => string;
}

const ANDROID_MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'appending the denied package while retaining the stock package fails',
    file: ANDROID_MAIN_APPLICATION_PATH,
    mutate: (valid) => valid.replace(
      'this[index] = NetworkDeniedWebViewPackage()',
      'add(NetworkDeniedWebViewPackage())\n      add(RNCWebViewPackage())',
    ),
  },
  {
    name: 'moving the setting to onAfterUpdateTransaction fails',
    file: ANDROID_NETWORK_DENY_MANAGER_PATH,
    mutate: (valid) => valid.replace(
      '    wrapper.webView.settings.blockNetworkLoads = true\n    return wrapper\n  }',
      '    return wrapper\n  }\n  override fun onAfterUpdateTransaction(wrapper: RNCWebViewWrapper) {\n    wrapper.webView.settings.blockNetworkLoads = true\n  }',
    ),
  },
  {
    name: 'setting blockNetworkLoads to false fails',
    file: ANDROID_NETWORK_DENY_MANAGER_PATH,
    mutate: (valid) => valid.replace('blockNetworkLoads = true', 'blockNetworkLoads = false'),
  },
  {
    name: 'returning the stock manager fails',
    file: ANDROID_NETWORK_DENY_PACKAGE_PATH,
    mutate: (valid) => valid.replace('NetworkDeniedWebViewManager()', 'RNCWebViewManager()'),
  },
  {
    name: 'a manager comment cannot impersonate the deny statement',
    file: ANDROID_NETWORK_DENY_MANAGER_PATH,
    mutate: (valid) => valid.replace(
      '    wrapper.webView.settings.blockNetworkLoads = true',
      '    /* wrapper.webView.settings.blockNetworkLoads = true */',
    ),
  },
  {
    name: 'a package raw string cannot impersonate createViewManagers',
    file: ANDROID_NETWORK_DENY_PACKAGE_PATH,
    mutate: () => `
package com.whim.webview
class NetworkDeniedWebViewPackage : RNCWebViewPackage() {
  val decoy = """
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
      return listOf(NetworkDeniedWebViewManager())
    }
  """
}
`,
  },
  {
    name: 'an application comment cannot impersonate package replacement',
    file: ANDROID_MAIN_APPLICATION_PATH,
    mutate: () => `
package com.whim
val packages = PackageList(this).packages.apply {
  /*
  if (this[index] is RNCWebViewPackage) {
    this[index] = NetworkDeniedWebViewPackage()
  }
  */
  check(replacedWebViewPackages == 1) { "react-native-webview autolinking" }
  add(com.whim.tone.WhimTonePackage())
}
`,
  },
];

const IOS_MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'an iOS resource-type qualifier fails',
    file: IOS_NETWORK_DENY_RULES_PATH,
    mutate: (valid) => valid.replace('"url-filter":"^https?:"', '"url-filter":"^https?:","resource-type":["document"]'),
  },
  {
    name: 'dropping the iOS WebSocket rule fails',
    file: IOS_NETWORK_DENY_RULES_PATH,
    mutate: (valid) => JSON.stringify((JSON.parse(valid) as unknown[]).slice(0, 1)),
  },
  {
    name: 'a referenced rule file missing from Resources fails',
    file: IOS_PROJECT_PATH,
    mutate: (valid) => valid.replace('files = ( RULES_BUILD, );', 'files = ();'),
  },
  {
    name: 'a replacement selector outside the init family fails',
    file: IOS_NETWORK_DENY_IMPLEMENTATION_PATH,
    mutate: (valid) => valid.replaceAll('initWhimNetworkDeniedWithFrame', 'whim_initWithFrame'),
  },
  {
    name: 'the exchange must use the two resolved initializer methods',
    file: IOS_NETWORK_DENY_IMPLEMENTATION_PATH,
    mutate: (valid) => valid.replace(
      'method_exchangeImplementations(original, replacement);',
      'Method wrong = class_getInstanceMethod(WKWebView.class, @selector(loadHTMLString:baseURL:));\n'
        + '    method_exchangeImplementations(wrong, replacement);',
    ),
  },
  {
    name: 'removing the iOS fail-closed branch fails',
    file: IOS_NETWORK_DENY_IMPLEMENTATION_PATH,
    mutate: (valid) => valid.replace(
      '  } else {\n    configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;\n',
      '',
    ),
  },
  {
    name: 'fail-closed JavaScript disabling belongs in the unavailable branch',
    file: IOS_NETWORK_DENY_IMPLEMENTATION_PATH,
    mutate: (valid) => valid.replace(
      `  if (ruleList) {
    [configuration.userContentController addContentRuleList:ruleList];
  } else {
    configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
  }`,
      `  configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
  if (ruleList) {
    [configuration.userContentController addContentRuleList:ruleList];
  } else {
    (void)ruleList;
  }`,
    ),
  },
  {
    name: 'Objective-C comments and strings cannot impersonate the hook',
    file: IOS_NETWORK_DENY_IMPLEMENTATION_PATH,
    mutate: () => `
@implementation WhimWebViewNetworkDeny
+ (void)load {
  NSString *decoy = @"@selector(initWithFrame:configuration:) method_exchangeImplementations";
  /* dispatch_once(&onceToken, ^{ @selector(initWhimNetworkDeniedWithFrame:configuration:); }); */
}
@end
@implementation WKWebView (WhimNetworkDeny)
- (instancetype)initWhimNetworkDeniedWithFrame:(CGRect)frame configuration:(WKWebViewConfiguration *)configuration {
  NSString *decoy = @"addContentRuleList: allowsContentJavaScript = NO";
  /* [configuration.userContentController addContentRuleList:ruleList]; */
  return [self initWhimNetworkDeniedWithFrame:frame configuration:configuration];
}
@end
`,
  },
];

const ANDROID_VALID_BY_FILE: Readonly<Record<string, string>> = {
  [ANDROID_MAIN_APPLICATION_PATH]: VALID_APPLICATION,
  [ANDROID_NETWORK_DENY_MANAGER_PATH]: VALID_MANAGER,
  [ANDROID_NETWORK_DENY_PACKAGE_PATH]: VALID_PACKAGE,
};

const IOS_VALID_BY_FILE: Readonly<Record<string, string>> = {
  [IOS_NETWORK_DENY_RULES_PATH]: VALID_IOS_RULES,
  [IOS_NETWORK_DENY_IMPLEMENTATION_PATH]: VALID_IOS_IMPLEMENTATION,
  [IOS_PROJECT_PATH]: VALID_IOS_PROJECT,
};

export async function run(): Promise<void> {
  await test('native-network-deny: the real Android wiring refuses every WebView network load', () => {
    const findings = checkAndroidNativeNetworkDeny(process.cwd());
    assert(findings.length === 0, `expected no Android native network-deny findings, got ${JSON.stringify(findings)}`);
  });

  await test('native-network-deny: a complete Android fixture passes', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      const findings = checkAndroidNativeNetworkDeny(root);
      assert(findings.length === 0, `expected no fixture findings, got ${JSON.stringify(findings)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const c of ANDROID_MUTATION_CASES) {
    await test(`native-network-deny: ${c.name}`, () => {
      const root = makeNativeNetworkDenyFixture();
      try {
        writeValidFixture(root);
        writeNativeNetworkDenyFixture(root, c.file, c.mutate(ANDROID_VALID_BY_FILE[c.file] as string));
        assertFindingNamesFile(root, c.file);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  await test('native-network-deny: the real iOS wiring refuses HTTP and WebSocket loads', () => {
    const findings = checkIosNativeNetworkDeny(process.cwd());
    assert(findings.length === 0, `expected no iOS native network-deny findings, got ${JSON.stringify(findings)}`);
  });

  await test('native-network-deny: a complete iOS fixture passes', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidIosFixture(root);
      const findings = checkIosNativeNetworkDeny(root);
      assert(findings.length === 0, `expected no iOS fixture findings, got ${JSON.stringify(findings)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const c of IOS_MUTATION_CASES) {
    await test(`native-network-deny: ${c.name}`, () => {
      const root = makeNativeNetworkDenyFixture();
      try {
        writeValidIosFixture(root);
        writeNativeNetworkDenyFixture(root, c.file, c.mutate(IOS_VALID_BY_FILE[c.file] as string));
        assertIosFindingNamesFile(root, c.file);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
