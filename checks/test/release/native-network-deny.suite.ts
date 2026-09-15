/**
 * Source checks for platform-release-readiness D17's native WebView network refusal.
 * Android runs these checks here; chain-17 extends this suite with the iOS wiring cases.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, test } from '../harness';

export const ANDROID_NETWORK_DENY_MANAGER_PATH =
  'android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewManager.kt';
export const ANDROID_NETWORK_DENY_PACKAGE_PATH =
  'android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewPackage.kt';
export const ANDROID_MAIN_APPLICATION_PATH = 'android/app/src/main/java/com/whim/MainApplication.kt';

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

function exactOneCheckNamesAutolinking(application: KotlinLexResult): boolean {
  const match = /check\s*\(replacedWebViewPackages\s*==\s*1\)\s*\{/.exec(application.code);
  if (!match) return false;
  const start = application.code.indexOf('{', match.index);
  const end = closingBraceIndex(application.code, start);
  if (end === undefined) return false;
  const attachedStrings = application.strings.filter((span) => span.start > start && span.end <= end);
  return application.code.slice(start + 1, end).trim() === ''
    && attachedStrings.length === 1
    && attachedStrings[0].text.includes('react-native-webview autolinking');
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
  if (!exactOneCheckNamesAutolinking(application)) {
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

function writeValidFixture(root: string): void {
  writeNativeNetworkDenyFixture(root, ANDROID_MAIN_APPLICATION_PATH, VALID_APPLICATION);
  writeNativeNetworkDenyFixture(root, ANDROID_NETWORK_DENY_MANAGER_PATH, VALID_MANAGER);
  writeNativeNetworkDenyFixture(root, ANDROID_NETWORK_DENY_PACKAGE_PATH, VALID_PACKAGE);
}

function assertFindingNamesFile(root: string, file: string): void {
  const findings = checkAndroidNativeNetworkDeny(root);
  assert(findings.some((finding) => finding.file === file), `expected a finding naming ${file}, got ${JSON.stringify(findings)}`);
}

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

  await test('native-network-deny: appending the denied package while retaining the stock package fails', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_MAIN_APPLICATION_PATH,
        VALID_APPLICATION.replace(
          'this[index] = NetworkDeniedWebViewPackage()',
          'add(NetworkDeniedWebViewPackage())\n      add(RNCWebViewPackage())',
        ),
      );
      assertFindingNamesFile(root, ANDROID_MAIN_APPLICATION_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: moving the setting to onAfterUpdateTransaction fails', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_NETWORK_DENY_MANAGER_PATH,
        VALID_MANAGER.replace(
          '    wrapper.webView.settings.blockNetworkLoads = true\n    return wrapper\n  }',
          '    return wrapper\n  }\n  override fun onAfterUpdateTransaction(wrapper: RNCWebViewWrapper) {\n    wrapper.webView.settings.blockNetworkLoads = true\n  }',
        ),
      );
      assertFindingNamesFile(root, ANDROID_NETWORK_DENY_MANAGER_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: setting blockNetworkLoads to false fails', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_NETWORK_DENY_MANAGER_PATH,
        VALID_MANAGER.replace('blockNetworkLoads = true', 'blockNetworkLoads = false'),
      );
      assertFindingNamesFile(root, ANDROID_NETWORK_DENY_MANAGER_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: returning the stock manager fails', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_NETWORK_DENY_PACKAGE_PATH,
        VALID_PACKAGE.replace('NetworkDeniedWebViewManager()', 'RNCWebViewManager()'),
      );
      assertFindingNamesFile(root, ANDROID_NETWORK_DENY_PACKAGE_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: a manager comment cannot impersonate the deny statement', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_NETWORK_DENY_MANAGER_PATH,
        VALID_MANAGER.replace(
          '    wrapper.webView.settings.blockNetworkLoads = true',
          '    /* wrapper.webView.settings.blockNetworkLoads = true */',
        ),
      );
      assertFindingNamesFile(root, ANDROID_NETWORK_DENY_MANAGER_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: a package raw string cannot impersonate createViewManagers', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_NETWORK_DENY_PACKAGE_PATH,
        `
package com.whim.webview
class NetworkDeniedWebViewPackage : RNCWebViewPackage() {
  val decoy = """
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
      return listOf(NetworkDeniedWebViewManager())
    }
  """
}
`,
      );
      assertFindingNamesFile(root, ANDROID_NETWORK_DENY_PACKAGE_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: an application comment cannot impersonate package replacement', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      writeNativeNetworkDenyFixture(
        root,
        ANDROID_MAIN_APPLICATION_PATH,
        `
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
      );
      assertFindingNamesFile(root, ANDROID_MAIN_APPLICATION_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('native-network-deny: the exact-one check must carry the autolinking message itself', () => {
    const root = makeNativeNetworkDenyFixture();
    try {
      writeValidFixture(root);
      const wrongMessage = VALID_APPLICATION
        .replace(
          'val packages = PackageList(this).packages.apply {',
          'val unrelated = "react-native-webview autolinking"\n// react-native-webview autolinking\nval packages = PackageList(this).packages.apply {',
        )
        .replace(
          '"react-native-webview autolinking must provide exactly one package"',
          '"expected one package"',
        );
      writeNativeNetworkDenyFixture(root, ANDROID_MAIN_APPLICATION_PATH, wrongMessage);
      assertFindingNamesFile(root, ANDROID_MAIN_APPLICATION_PATH);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
