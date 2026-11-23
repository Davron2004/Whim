/**
 * Source checks for webview-bridge-provenance D1: the per-WebView-instance bridge token comes from the
 * `WhimRandom` TurboModule over the OS CSPRNG (Android `SecureRandom`, iOS `SecRandomCopyBytes`),
 * because Hermes has no `crypto`. A weaker generator (`java.util.Random`, `Math.random`,
 * `arc4random`) or an unchecked iOS status would still produce hex that looks random, so the
 * module sources are pinned here, along with the registration that makes the module reachable
 * and the JS spec that names it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, test } from '../harness';
import {
  ANDROID_MAIN_APPLICATION_PATH,
  IOS_PROJECT_PATH,
  lexKotlin,
  maskComments,
  methodBody,
  targetPhaseHasFile,
  type NativeNetworkDenyFinding,
} from './native-network-deny.suite';

export const ANDROID_RANDOM_MODULE_PATH = 'android/app/src/main/java/com/whim/random/WhimRandomModule.kt';
export const ANDROID_RANDOM_PACKAGE_PATH = 'android/app/src/main/java/com/whim/random/WhimRandomPackage.kt';
export const IOS_RANDOM_MODULE_PATH = 'ios/Whim/WhimRandomModule.mm';
export const RANDOM_SPEC_PATH = 'src/native/NativeWhimRandom.ts';
export const PACKAGE_JSON_PATH = 'package.json';

const MODULE_NAME = 'WhimRandom';
const MIN_BYTES = 1;
const MAX_BYTES = 64;

type Finding = NativeNetworkDenyFinding;

function readRequired(root: string, relPath: string, findings: Finding[]): string {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  // eslint-disable-next-line no-restricted-syntax -- unreadable required files become named findings below
  } catch {
    findings.push({ file: relPath, message: 'required secure-random source is missing or unreadable' });
    return '';
  }
}

function constantValue(code: string, declaration: RegExp): number | undefined {
  const match = declaration.exec(code);
  return match ? Number(match[1]) : undefined;
}

// ── Android ─────────────

/** Generators that are not the OS CSPRNG. Matched in code only: comments and literals are masked. */
const ANDROID_WEAK_SOURCES: readonly RegExp[] = [
  /\bjava\.util\.Random\b/,
  /\bjava\.util\.concurrent\.ThreadLocalRandom\b/,
  /\bThreadLocalRandom\b/,
  /\bMath\.random\b/,
  /\bkotlin\.random\b/,
  /\bimport\s+java\.util\.(?:\*|Random)\b/,
  /(?<![\w.])Random\s*[.(]/,
];

function checkAndroidModule(source: string, findings: Finding[]): void {
  const file = ANDROID_RANDOM_MODULE_PATH;
  const { code, strings } = lexKotlin(source);
  for (const weak of ANDROID_WEAK_SOURCES) {
    if (weak.test(code)) findings.push({ file, message: `the module must not use a non-CSPRNG source (${weak.source})` });
  }
  if (!/\bimport\s+java\.security\.SecureRandom\b/.test(code)) {
    findings.push({ file, message: 'the module must import java.security.SecureRandom' });
  }
  const declaration = /\bval\s+(\w+)\s*=\s*SecureRandom\s*\(\s*\)/.exec(code);
  if (!declaration) {
    findings.push({ file, message: 'the module must hold a java.security.SecureRandom instance' });
  }
  if (!strings.some((span) => span.text === `"${MODULE_NAME}"`)) {
    findings.push({ file, message: `the module name must be "${MODULE_NAME}"` });
  }
  const body = methodBody(code, /override\s+fun\s+randomHex\s*\(\s*byteCount\s*:\s*Double\s*\)\s*:\s*String\?\s*\{/);
  if (body === undefined) {
    findings.push({ file, message: 'the module must override randomHex(byteCount: Double): String?' });
    return;
  }
  checkAndroidRandomHex(body, code, declaration?.[1], findings);
}

/** The `randomHex` body: range guard first, bytes from the SecureRandom, failure as null. */
function checkAndroidRandomHex(body: string, code: string, generator: string | undefined, findings: Finding[]): void {
  const file = ANDROID_RANDOM_MODULE_PATH;
  const generated = generator ? new RegExp(`\\b${generator}\\.nextBytes\\s*\\(`).exec(body) : null;
  if (!generated) {
    findings.push({ file, message: 'randomHex must fill its bytes with the SecureRandom instance' });
  }
  const guard = /if\s*\([^{}]*\bbyteCount\b[^{}]*\)\s*return\s+null\b/.exec(body);
  if (!guard || (generated && guard.index > generated.index)) {
    findings.push({ file, message: 'randomHex must return null for an out-of-range byteCount before generating bytes' });
  }
  const catches = [...body.matchAll(/\bcatch\s*\([^)]*\)\s*\{/g)];
  for (const found of catches) {
    const start = body.indexOf('{', found.index);
    const end = body.indexOf('}', start);
    if (!/^\s*(?:return\s+)?null\s*$/.test(body.slice(start + 1, end))) {
      findings.push({ file, message: 'a failing random source must yield null, never a substitute value' });
    }
  }
  const min = constantValue(code, /\bMIN_BYTES\s*=\s*(\d+(?:\.\d+)?)/);
  const max = constantValue(code, /\bMAX_BYTES\s*=\s*(\d+(?:\.\d+)?)/);
  if (min !== MIN_BYTES || max !== MAX_BYTES) {
    findings.push({ file, message: `the accepted byteCount range must be ${MIN_BYTES}–${MAX_BYTES}` });
  }
  if (!/\bbyteCount\s*!=\s*Math\.floor\s*\(\s*byteCount\s*\)/.test(body)) {
    findings.push({ file, message: 'randomHex must reject a non-integer byteCount' });
  }
}

function checkAndroidRegistration(packageSource: string, application: string, findings: Finding[]): void {
  const packageCode = lexKotlin(packageSource).code;
  if (!/\bWhimRandomModule\s*\(\s*reactContext\s*\)/.test(packageCode)) {
    findings.push({ file: ANDROID_RANDOM_PACKAGE_PATH, message: 'the package must construct WhimRandomModule' });
  }
  if (!/true,\s*\/\/\s*isTurboModule/.test(packageSource)) {
    findings.push({ file: ANDROID_RANDOM_PACKAGE_PATH, message: 'the package must advertise WhimRandom as a TurboModule' });
  }
  if (!/\badd\s*\(\s*com\.whim\.random\.WhimRandomPackage\s*\(\s*\)\s*\)/.test(lexKotlin(application).code)) {
    findings.push({ file: ANDROID_MAIN_APPLICATION_PATH, message: 'MainApplication must add com.whim.random.WhimRandomPackage()' });
  }
}

// ── iOS ─────────────

const IOS_WEAK_SOURCES: readonly RegExp[] = [
  /\barc4random\w*/,
  /\b(?:rand|random|srandom|srand|drand48|lrand48|mrand48|rand_r)\s*\(/,
  /\bCCRandomGenerateBytes\b/,
  /\bSecRandomCopyBytes\s*\(\s*(?:NULL|nil|0)\b/,
];

function checkIosModule(source: string, findings: Finding[]): void {
  const file = IOS_RANDOM_MODULE_PATH;
  const code = maskComments(source);
  for (const weak of IOS_WEAK_SOURCES) {
    if (weak.test(code)) findings.push({ file, message: `the module must not use a non-CSPRNG source (${weak.source})` });
  }
  if (!/\+\s*\(\s*NSString\s*\*\s*\)\s*moduleName\s*\{\s*return\s+@"WhimRandom"\s*;\s*\}/.test(code)) {
    findings.push({ file, message: `the module name must be "${MODULE_NAME}"` });
  }
  if (!/std::make_shared<\s*NativeWhimRandomSpecJSI\s*>\s*\(\s*params\s*\)/.test(code)) {
    findings.push({ file, message: 'getTurboModule must return NativeWhimRandomSpecJSI' });
  }
  const body = methodBody(code, /-\s*\(\s*NSString\b[^)]*\)\s*randomHex:\s*\(double\)\s*byteCount/);
  if (body === undefined) {
    findings.push({ file, message: 'the module must implement -randomHex:(double)byteCount returning NSString' });
    return;
  }
  const call = /\b(?:int|OSStatus|int32_t)\s+(\w+)\s*=\s*SecRandomCopyBytes\s*\(\s*kSecRandomDefault\s*,/.exec(body);
  if (!call) {
    findings.push({ file, message: 'randomHex must call SecRandomCopyBytes(kSecRandomDefault, ...) and keep its status' });
    return;
  }
  const afterCall = body.slice(call.index + call[0].length);
  const statusGuard = new RegExp(`^[^;]*;\\s*if\\s*\\(\\s*${call[1]}\\s*!=\\s*errSecSuccess\\s*\\)\\s*\\{\\s*return\\s+nil\\s*;\\s*\\}`);
  if (!statusGuard.test(afterCall)) {
    findings.push({ file, message: 'randomHex must return nil unless the SecRandomCopyBytes status is errSecSuccess, before reading the bytes' });
  }
  const rangeGuard = /if\s*\([^{}]*\bbyteCount\b[^{}]*\)\s*\{\s*return\s+nil\s*;\s*\}/.exec(body);
  if (!rangeGuard || rangeGuard.index > call.index) {
    findings.push({ file, message: 'randomHex must return nil for an out-of-range byteCount before generating bytes' });
  }
  if (!/\bbyteCount\s*!=\s*floor\s*\(\s*byteCount\s*\)/.test(body)) {
    findings.push({ file, message: 'randomHex must reject a non-integer byteCount' });
  }
  const min = constantValue(code, /\bkMinBytes\s*=\s*(\d+(?:\.\d+)?)/);
  const max = constantValue(code, /\bkMaxBytes\s*=\s*(\d+(?:\.\d+)?)/);
  if (min !== MIN_BYTES || max !== MAX_BYTES) {
    findings.push({ file, message: `the accepted byteCount range must be ${MIN_BYTES}–${MAX_BYTES}` });
  }
  if (!/uint8_t\s+\w+\s*\[\s*\(\s*size_t\s*\)\s*kMaxBytes\s*\]/.test(body)) {
    findings.push({ file, message: 'the byte buffer must be sized by kMaxBytes so the range guard bounds it' });
  }
  if (!/%02x/.test(code)) {
    findings.push({ file, message: 'the bytes must be formatted as lowercase hex' });
  }
}

function checkIosRegistration(pbxproj: string, packageJson: string, findings: Finding[]): void {
  try {
    if (!targetPhaseHasFile(pbxproj, 'PBXSourcesBuildPhase', 'Whim/WhimRandomModule.mm')) {
      findings.push({ file: IOS_PROJECT_PATH, message: 'WhimRandomModule.mm must be in the Whim Sources phase' });
    }
  // eslint-disable-next-line no-restricted-syntax -- parse errors become the stable project-level finding below
  } catch {
    findings.push({ file: IOS_PROJECT_PATH, message: 'iOS project must parse and contain the WhimRandomModule.mm target membership' });
  }
  let provider: unknown;
  try {
    provider = (JSON.parse(packageJson) as { codegenConfig?: { ios?: { modulesProvider?: Record<string, unknown> } } })
      .codegenConfig?.ios?.modulesProvider?.[MODULE_NAME];
  // eslint-disable-next-line no-restricted-syntax -- an unparsable package.json becomes the finding below
  } catch {
    provider = undefined;
  }
  if (provider !== 'WhimRandomModule') {
    findings.push({ file: PACKAGE_JSON_PATH, message: 'codegenConfig.ios.modulesProvider must map WhimRandom to WhimRandomModule' });
  }
}

// ── JS spec ─────────────

function checkJsSpec(source: string, findings: Finding[]): void {
  const file = RANDOM_SPEC_PATH;
  const code = maskComments(source);
  if (!code.replace(/\s+/g, '').includes('randomHex(byteCount:number):string|null;')) {
    findings.push({ file, message: 'the spec must declare the synchronous randomHex(byteCount: number): string | null' });
  }
  if (/\bPromise\s*</.test(code)) {
    findings.push({ file, message: 'the spec must not be asynchronous: the token is minted synchronously' });
  }
  if (!/export\s+default\s+TurboModuleRegistry\.get\s*<\s*Spec\s*>\s*\(\s*'WhimRandom'\s*\)/.test(code)) {
    findings.push({ file, message: "the spec must export TurboModuleRegistry.get<Spec>('WhimRandom') so a missing module is null" });
  }
}

export function checkSecureRandom(root: string): Finding[] {
  const findings: Finding[] = [];
  const androidModule = readRequired(root, ANDROID_RANDOM_MODULE_PATH, findings);
  const pkg = readRequired(root, ANDROID_RANDOM_PACKAGE_PATH, findings);
  const application = readRequired(root, ANDROID_MAIN_APPLICATION_PATH, findings);
  const iosModule = readRequired(root, IOS_RANDOM_MODULE_PATH, findings);
  const pbxproj = readRequired(root, IOS_PROJECT_PATH, findings);
  const packageJson = readRequired(root, PACKAGE_JSON_PATH, findings);
  const spec = readRequired(root, RANDOM_SPEC_PATH, findings);
  checkAndroidModule(androidModule, findings);
  checkAndroidRegistration(pkg, application, findings);
  checkIosModule(iosModule, findings);
  checkIosRegistration(pbxproj, packageJson, findings);
  checkJsSpec(spec, findings);
  return findings;
}

// ── tests ─────────────

const FILES = [
  ANDROID_RANDOM_MODULE_PATH,
  ANDROID_RANDOM_PACKAGE_PATH,
  ANDROID_MAIN_APPLICATION_PATH,
  IOS_RANDOM_MODULE_PATH,
  IOS_PROJECT_PATH,
  PACKAGE_JSON_PATH,
  RANDOM_SPEC_PATH,
] as const;

interface MutationCase {
  readonly name: string;
  readonly file: (typeof FILES)[number];
  /** A fragment of the finding message that names the violated rule, so a case fails for its own reason. */
  readonly expected: string;
  readonly mutate: (valid: string) => string;
}

function withoutLine(valid: string, fragment: string): string {
  const lines = valid.split('\n');
  const kept = lines.filter((line) => !line.includes(fragment));
  if (kept.length === lines.length) throw new Error(`mutation anchor not found: ${fragment}`);
  return kept.join('\n');
}

function replaced(valid: string, from: string | RegExp, to: string): string {
  const found = typeof from === 'string' ? valid.includes(from) : from.test(valid);
  if (!found) throw new Error(`mutation anchor not found: ${String(from)}`);
  return valid.replace(from, to);
}

const MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'java.util.Random in place of SecureRandom fails (the SecureRandom doc comment stays)',
    expected: 'non-CSPRNG source',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(
      replaced(valid, 'import java.security.SecureRandom', 'import java.util.Random'),
      'SecureRandom()',
      'Random()',
    ),
  },
  {
    name: 'a fully-qualified java.util.Random next to an unused SecureRandom fails',
    expected: 'non-CSPRNG source',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'SECURE_RANDOM.nextBytes(bytes)', 'java.util.Random().nextBytes(bytes)'),
  },
  {
    name: 'Math.random bytes fail',
    expected: 'non-CSPRNG source',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'SECURE_RANDOM.nextBytes(bytes)', 'bytes.fill((Math.random() * 256).toInt().toByte())'),
  },
  {
    name: 'an Android module that never fills bytes from the SecureRandom fails',
    expected: 'fill its bytes with the SecureRandom',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'SECURE_RANDOM.nextBytes(bytes)', 'bytes.fill(7)'),
  },
  {
    name: 'an Android catch that substitutes a value instead of null fails',
    expected: 'never a substitute value',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, /catch \(_: RuntimeException\) \{\s*null\s*\}/, 'catch (_: RuntimeException) {\n      "00"\n    }'),
  },
  {
    name: 'an Android range widened to 65 bytes fails',
    expected: 'range must be',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'MAX_BYTES = 64.0', 'MAX_BYTES = 65.0'),
  },
  {
    name: 'an Android range admitting zero bytes fails',
    expected: 'range must be',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'MIN_BYTES = 1.0', 'MIN_BYTES = 0.0'),
  },
  {
    name: 'an Android module accepting fractional byteCount fails',
    expected: 'non-integer byteCount',
    file: ANDROID_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'byteCount != Math.floor(byteCount) || ', ''),
  },
  {
    name: 'a missing Android package registration fails',
    expected: 'must add com.whim.random.WhimRandomPackage',
    file: ANDROID_MAIN_APPLICATION_PATH,
    mutate: (valid) => replaced(valid, '          add(com.whim.random.WhimRandomPackage())\n', ''),
  },
  {
    name: 'a commented-out Android package registration fails',
    expected: 'must add com.whim.random.WhimRandomPackage',
    file: ANDROID_MAIN_APPLICATION_PATH,
    mutate: (valid) => replaced(valid, 'add(com.whim.random.WhimRandomPackage())', '// add(com.whim.random.WhimRandomPackage())'),
  },
  {
    name: 'an Android package that does not advertise a TurboModule fails',
    expected: 'as a TurboModule',
    file: ANDROID_RANDOM_PACKAGE_PATH,
    mutate: (valid) => replaced(valid, 'true, // isTurboModule', 'false, // isTurboModule'),
  },
  {
    name: 'an unchecked iOS SecRandomCopyBytes status fails',
    expected: 'errSecSuccess',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, '\n  if (status != errSecSuccess) {\n    return nil;\n  }', ''),
  },
  {
    name: 'an iOS status compared against the wrong value fails',
    expected: 'errSecSuccess',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'status != errSecSuccess', 'status == errSecSuccess'),
  },
  {
    name: 'an iOS status guard that does not return nil fails',
    expected: 'errSecSuccess',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, '{\n    return nil;\n  }\n  NSMutableString', '{\n  }\n  NSMutableString'),
  },
  {
    name: 'arc4random_buf in place of SecRandomCopyBytes fails',
    expected: 'non-CSPRNG source',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, /int status = SecRandomCopyBytes\(kSecRandomDefault, length, bytes\);/, 'arc4random_buf(bytes, length);\n  int status = errSecSuccess;'),
  },
  {
    name: 'an iOS range widened to 65 bytes fails',
    expected: 'range must be',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'kMaxBytes = 64', 'kMaxBytes = 65'),
  },
  {
    name: 'an iOS module accepting fractional byteCount fails',
    expected: 'non-integer byteCount',
    file: IOS_RANDOM_MODULE_PATH,
    mutate: (valid) => replaced(valid, 'byteCount != floor(byteCount) || ', ''),
  },
  {
    name: 'an iOS module missing from the Sources phase fails',
    expected: 'Sources phase',
    file: IOS_PROJECT_PATH,
    mutate: (valid) => withoutLine(valid, 'WhimRandomModule.mm in Sources */,'),
  },
  {
    name: 'a missing codegen modulesProvider entry fails',
    expected: 'modulesProvider',
    file: PACKAGE_JSON_PATH,
    mutate: (valid) => replaced(valid, /,\n\s*"WhimRandom": "WhimRandomModule"/, ''),
  },
  {
    name: 'an asynchronous JS spec fails',
    expected: 'synchronous',
    file: RANDOM_SPEC_PATH,
    mutate: (valid) => replaced(valid, 'randomHex(byteCount: number): string | null;', 'randomHex(byteCount: number): Promise<string | null>;'),
  },
  {
    name: 'a JS spec that throws when the module is missing fails',
    expected: 'is null',
    file: RANDOM_SPEC_PATH,
    mutate: (valid) => replaced(valid, "TurboModuleRegistry.get<Spec>('WhimRandom')", "TurboModuleRegistry.getEnforcing<Spec>('WhimRandom')"),
  },
  {
    name: 'a JS spec naming a different module fails',
    expected: 'is null',
    file: RANDOM_SPEC_PATH,
    mutate: (valid) => replaced(valid, "TurboModuleRegistry.get<Spec>('WhimRandom')", "TurboModuleRegistry.get<Spec>('WhimRandomness')"),
  },
];

function withFixture(override: MutationCase | undefined, fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-secure-random-'));
  try {
    for (const relPath of FILES) {
      const valid = fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
      const abs = path.join(root, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, override?.file === relPath ? override.mutate(valid) : valid, 'utf8');
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function run(): Promise<void> {
  await test('secure-random: the real WhimRandom module sources, registration and JS spec pass', () => {
    const findings = checkSecureRandom(process.cwd());
    assert(findings.length === 0, `expected no secure-random findings, got ${JSON.stringify(findings)}`);
  });

  await test('secure-random: a fixture copy of the real sources passes', () => {
    withFixture(undefined, (root) => {
      const findings = checkSecureRandom(root);
      assert(findings.length === 0, `expected no fixture findings, got ${JSON.stringify(findings)}`);
    });
  });

  for (const c of MUTATION_CASES) {
    await test(`secure-random: ${c.name}`, () => {
      withFixture(c, (root) => {
        const findings = checkSecureRandom(root);
        assert(
          findings.some((finding) => finding.file === c.file && finding.message.includes(c.expected)),
          `expected a ${c.file} finding mentioning "${c.expected}", got ${JSON.stringify(findings)}`,
        );
      });
    });
  }
}
