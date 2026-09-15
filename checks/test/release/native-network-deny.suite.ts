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

function methodBody(source: string, signature: RegExp): string | undefined {
  const match = signature.exec(source);
  if (!match) return undefined;
  const start = source.indexOf('{', match.index);
  if (start < 0) return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start + 1, index);
  }
  return undefined;
}

function addFinding(findings: NativeNetworkDenyFinding[], file: string, message: string): void {
  findings.push({ file, message });
}

function checkApplicationWiring(application: string, findings: NativeNetworkDenyFinding[]): void {
  if (!/PackageList\(this\)\.packages\.apply\s*\{/.test(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'the autolinked package list is not updated in place');
  }
  if (!/if\s*\(this\[index]\s+is\s+RNCWebViewPackage\)/.test(application)
      || !/this\[index]\s*=\s*NetworkDeniedWebViewPackage\(\)/.test(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'RNCWebViewPackage is not replaced at its existing index');
  }
  if ((application.match(/NetworkDeniedWebViewPackage\s*\(\s*\)/g) ?? []).length !== 1
      || /\bRNCWebViewPackage\s*\(\s*\)/.test(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'the package list must contain one denied manager package and no stock instance');
  }
  if (!/check\s*\(replacedWebViewPackages\s*==\s*1\)/.test(application)
      || !/react-native-webview autolinking/.test(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'startup must check exactly one react-native-webview autolinked package');
  }
  if (!/add\([^\n]*WhimTonePackage\(\)\)/.test(application)) {
    addFinding(findings, ANDROID_MAIN_APPLICATION_PATH, 'WhimTonePackage must remain registered');
  }
}

export function checkAndroidNativeNetworkDeny(root: string): NativeNetworkDenyFinding[] {
  const findings: NativeNetworkDenyFinding[] = [];
  const application = readRequired(root, ANDROID_MAIN_APPLICATION_PATH, findings);
  const manager = readRequired(root, ANDROID_NETWORK_DENY_MANAGER_PATH, findings);
  const pkg = readRequired(root, ANDROID_NETWORK_DENY_PACKAGE_PATH, findings);

  checkApplicationWiring(application, findings);

  if (!/class\s+NetworkDeniedWebViewManager\s*:\s*RNCWebViewManager\(\)/.test(manager)) {
    addFinding(findings, ANDROID_NETWORK_DENY_MANAGER_PATH, 'manager must subclass RNCWebViewManager');
  }
  const createBody = methodBody(
    manager,
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
  if (/blockNetworkLoads\s*=\s*false/.test(manager)) {
    addFinding(findings, ANDROID_NETWORK_DENY_MANAGER_PATH, 'blockNetworkLoads must never be set to false');
  }

  if (!/class\s+NetworkDeniedWebViewPackage\s*:\s*RNCWebViewPackage\(\)/.test(pkg)) {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'package must subclass RNCWebViewPackage');
  }
  const packageBody = methodBody(pkg, /override\s+fun\s+createViewManagers\s*\([^)]*\)\s*:\s*List<ViewManager<\*,\s*\*>>\s*\{/);
  const compactPackageBody = packageBody?.replace(/\s+/g, ' ').trim();
  if (compactPackageBody !== 'return listOf(NetworkDeniedWebViewManager())') {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'createViewManagers must return only NetworkDeniedWebViewManager');
  }
  if (/\bRNCWebViewManager\s*\(\s*\)/.test(pkg)) {
    addFinding(findings, ANDROID_NETWORK_DENY_PACKAGE_PATH, 'the denied package must not return the stock RNCWebViewManager');
  }
  if (/override\s+fun\s+(getModule|getReactModuleInfoProvider)\b/.test(pkg)) {
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
}
